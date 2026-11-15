// Dispatch each variable to POWER, ERDDAP, or CSV and cache the result.
import { getVar, sourceLabel, startYearOf, tx, varName, type Mirror, type Variable } from "../catalog";
import type { Region } from "../geo";
import { L } from "../i18n";
import { fetchErddap, type ErddapSource, type Progress } from "./erddap";
import { fetchPower } from "./power";
import type { MonthlySeries } from "./series";

export interface FetchOpts {
  y0: number;
  y1: number;
  chlSensor: "viirs" | "modis";
  aodSource: "power" | "csv";
}

const cache = new Map<string, Promise<MonthlySeries>>();

function regionKey(r: Region): string {
  return r.kind === "point" ? `p${r.lat.toFixed(3)},${r.lon.toFixed(3)}` : `b${r.bbox!.map((x) => x.toFixed(3)).join(",")}`;
}

/** Código POWER efectivo de una variable (AOD usa el respaldo MERRA-2). */
function powerCode(v: Variable, o: FetchOpts): string | null {
  if (v.source === "power") return v.api_code ?? v.id;
  if (v.id === "AOD" && o.aodSource === "power" && v.fallback) return v.fallback.api_code;
  return null;
}

/** Fuente principal + espejos/alternas de una variable ERDDAP, en orden de preferencia. */
function erddapSources(v: Variable, o: FetchOpts): ErddapSource[] {
  const mk = (m: Mirror, label: string, start?: string, end?: string): ErddapSource => ({
    host: m.erddap_host,
    dataset: m.dataset_id,
    variable: m.api_code,
    label: m.label ? `NOAA ERDDAP · ${m.label}` : label,
    start: m.start ?? start,
    end: m.end ?? end,
  });
  if (v.id === "CHLOR_A" && v.sensors) {
    const s = v.sensors[o.chlSensor];
    const label = `NOAA ERDDAP · ${tx(s.label, s.label_en)}`;
    return [s, ...(s.mirrors ?? [])].map((m) => mk(m, label, s.start, s.end));
  }
  const label = sourceLabel(v, o);
  const primary: Mirror = { erddap_host: v.erddap_host!, dataset_id: v.dataset_id!, api_code: v.api_code! };
  return [mk(primary, label, v.start ?? "1981-01"), ...(v.mirrors ?? []).map((m) => mk(m, label))];
}

/** Variables that require a user-provided CSV because no REST API is available. */
export function needsCsv(id: string, o: Pick<FetchOpts, "aodSource">): boolean {
  const v = getVar(id);
  return v.source === "giovanni" && !(v.id === "AOD" && o.aodSource === "power");
}

export async function getSeries(
  ids: string[],
  region: Region,
  o: FetchOpts,
  csv: Record<string, MonthlySeries | undefined>,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<Record<string, MonthlySeries>> {
  const out: Record<string, MonthlySeries> = {};
  const powerBatch: { id: string; code: string }[] = [];

  for (const id of ids) {
    const v = getVar(id);
    const y0 = Math.max(o.y0, startYearOf(v, o));
    const key = `${id}|${regionKey(region)}|${y0}|${o.y1}|${o.chlSensor}|${o.aodSource}`;
    if (csv[id] && !needsCsv(id, o)) {
      // A user-provided CSV can replace the remote source, for example when ERDDAP is unavailable.
      out[id] = sliceYears(csv[id]!, y0, o.y1);
      continue;
    }
    if (needsCsv(id, o)) {
      const s = csv[id];
      if (!s)
        throw new Error(
          L(
            `${varName(v)}: NASA Giovanni no tiene API directa. Carga el CSV exportado de Giovanni o elige la fuente MERRA-2.`,
            `${varName(v)}: NASA Giovanni has no direct API. Load the CSV exported from Giovanni or choose the MERRA-2 source.`,
          ),
        );
      out[id] = sliceYears(s, y0, o.y1);
      continue;
    }
    const hit = cache.get(key);
    if (hit) {
      out[id] = await hit;
      continue;
    }
    const code = powerCode(v, o);
    if (code) {
      powerBatch.push({ id, code });
      continue;
    }
    // ERDDAP (en tramos, con espejos)
    const p = fetchErddap(erddapSources(v, o), region, y0, o.y1, signal, onProgress);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    out[id] = await p;
  }

  if (powerBatch.length) {
    // en modo punto POWER entrega todas las variables en un solo GET
    const y0 = Math.min(...powerBatch.map(({ id }) => Math.max(o.y0, startYearOf(getVar(id), o))));
    const label = (id: string) => sourceLabel(getVar(id), o);
    const res = await fetchPower(powerBatch.map((b) => b.code), region, y0, o.y1, label(powerBatch[0].id), signal);
    for (const { id, code } of powerBatch) {
      const v = getVar(id);
      const own0 = Math.max(o.y0, startYearOf(v, o));
      const s = trimStart(res[code], own0);
      s.sourceLabel = label(id);
      const key = `${id}|${regionKey(region)}|${own0}|${o.y1}|${o.chlSensor}|${o.aodSource}`;
      cache.set(key, Promise.resolve(s));
      out[id] = s;
    }
  }
  return out;
}

function trimStart(s: MonthlySeries, y0: number): MonthlySeries {
  let i = s.years.findIndex((y) => y >= y0);
  if (i < 0) i = s.years.length;
  // recorta también meses vacíos iniciales (p. ej. radiación empieza en 1984)
  while (i < s.values.length && s.values[i] === null) i++;
  let j = s.values.length;
  while (j > i && s.values[j - 1] === null) j--;
  return { ...s, years: s.years.slice(i, j), months: s.months.slice(i, j), values: s.values.slice(i, j) };
}

function sliceYears(s: MonthlySeries, y0: number, y1: number): MonthlySeries {
  const t = trimStart(s, y0);
  let j = t.years.length;
  while (j > 0 && t.years[j - 1] > y1) j--;
  return { ...t, years: t.years.slice(0, j), months: t.months.slice(0, j), values: t.values.slice(0, j) };
}
