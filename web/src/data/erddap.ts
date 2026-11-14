// NOAA / NASA ERDDAP (griddap, JSON, sin API key).
// Las dimensiones, el nombre de la variable y la resolución se descubren en tiempo de
// ejecución desde /info/<dataset>/index.json, como pide variables.json.
import type { Region } from "../geo";
import { clampLat, normLon, round } from "../geo";
import { clean, monthKey, toGrid, type MonthlySeries } from "./series";

interface ErddapTable {
  table: { columnNames: string[]; columnUnits?: (string | null)[]; rows: unknown[][] };
}

interface DatasetInfo {
  dims: string[];
  variable: string;
  units: string;
  timeMin: number | null; // epoch s
  timeMax: number | null;
  latRes: number;
  lonRes: number;
}

const infoCache = new Map<string, Promise<DatasetInfo>>();

function hostName(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
}

async function getTable(url: string, host: string, signal?: AbortSignal): Promise<ErddapTable> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(
      `No se pudo conectar con el servidor ERDDAP (${hostName(host)}). Puede estar caído o bloqueado en tu red. ` +
        `Intenta más tarde o carga un CSV propio en el paso 2 (opción bajo la tarjeta de la región).`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    const m = text.match(/message="([^"]+)"/) ?? text.match(/Error[^\n]{0,300}/);
    const err = new Error(`ERDDAP respondió ${res.status}: ${m ? m[1] ?? m[0] : "error"}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return JSON.parse(text) as ErddapTable;
}

async function datasetInfo(host: string, dataset: string, wanted: string, signal?: AbortSignal): Promise<DatasetInfo> {
  const key = `${host}|${dataset}|${wanted}`;
  let p = infoCache.get(key);
  if (!p) {
    p = (async () => {
      const t = await getTable(`${host}/info/${dataset}/index.json`, host, signal);
      const rows = t.table.rows as string[][];
      const dims = rows.filter((r) => r[0] === "dimension").map((r) => r[1]);
      const vars = rows.filter((r) => r[0] === "variable").map((r) => r[1]);
      const stem = wanted.slice(0, 4).toLowerCase();
      const variable = vars.includes(wanted) ? wanted : (vars.find((v) => v.toLowerCase().includes(stem)) ?? wanted);
      const attr = (v: string, a: string) => rows.find((r) => r[0] === "attribute" && r[1] === v && r[2] === a)?.[4];
      const range = (attr("time", "actual_range") ?? "").split(",").map((x) => parseFloat(x));
      const res = (v: string, fallback: number) => {
        const g = parseFloat(attr("NC_GLOBAL", v) ?? "");
        return Number.isFinite(g) && g > 0 ? g : fallback;
      };
      return {
        dims: dims.length ? dims : ["time", "latitude", "longitude"],
        variable,
        units: attr(variable, "units") ?? "",
        timeMin: Number.isFinite(range[0]) ? range[0] : null,
        timeMax: Number.isFinite(range[1]) ? range[1] : null,
        latRes: res("geospatial_lat_resolution", 0.04),
        lonRes: res("geospatial_lon_resolution", 0.04),
      };
    })();
    infoCache.set(key, p);
    p.catch(() => infoCache.delete(key));
  }
  return p;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 19) + "Z";

export async function fetchErddap(
  opt: { host: string; dataset: string; variable: string; startYm: string; endYm?: string },
  region: Region,
  y0: number,
  y1: number,
  label: string,
  signal?: AbortSignal,
): Promise<MonthlySeries> {
  const info = await datasetInfo(opt.host, opt.dataset, opt.variable, signal);

  // ventana de tiempo, recortada al rango real del dataset
  const [sy, sm] = opt.startYm.split("-").map(Number);
  let t0 = Math.max(Date.UTC(y0, 0, 1), Date.UTC(sy, sm - 1, 1)) / 1000;
  let t1 = Date.UTC(y1, 11, 31) / 1000;
  if (opt.endYm) {
    const [ey, em] = opt.endYm.split("-").map(Number);
    t1 = Math.min(t1, Date.UTC(ey, em, 0) / 1000);
  }
  if (info.timeMin !== null) t0 = Math.max(t0, info.timeMin);
  if (info.timeMax !== null) t1 = Math.min(t1, info.timeMax);
  if (t1 <= t0) throw new Error("El periodo elegido queda fuera del rango del dataset.");

  // espacio: punto o caja con salto (stride) para ~6×6 muestras por mes
  let s: number, n: number, w: number, e: number, latStride = 1, lonStride = 1;
  if (region.kind === "point") {
    s = n = round(clampLat(region.lat), 4);
    w = e = round(normLon(region.lon), 4);
  } else {
    [w, s, e, n] = region.bbox!;
    latStride = Math.max(1, Math.ceil((n - s) / info.latRes / 6));
    lonStride = Math.max(1, Math.ceil((e - w) / info.lonRes / 6));
  }

  const build = (latAsc: boolean) => {
    const parts = info.dims.map((d) => {
      if (d === "time") return `[(${iso(t0)}):1:(${iso(t1)})]`;
      if (d === "latitude") return latAsc ? `[(${s}):${latStride}:(${n})]` : `[(${n}):${latStride}:(${s})]`;
      if (d === "longitude") return `[(${w}):${lonStride}:(${e})]`;
      return "[0]"; // altitud / profundidad: primer nivel (superficie)
    });
    return `${opt.host}/griddap/${opt.dataset}.json?${encodeURIComponent(info.variable + parts.join(""))}`;
  };

  let url = build(true);
  let table: ErddapTable;
  try {
    table = await getTable(url, opt.host, signal);
  } catch (err) {
    // algunos datasets guardan la latitud de norte a sur: reintenta invertida
    if ((err as { status?: number }).status && s !== n) {
      url = build(false);
      table = await getTable(url, opt.host, signal);
    } else throw err;
  }

  const cols = table.table.columnNames;
  const ti = cols.indexOf("time");
  const vi = cols.indexOf(info.variable);
  const li = cols.indexOf("latitude");
  const acc = new Map<number, [number, number]>();
  let cells = 0;
  for (const row of table.table.rows) {
    const v = clean(row[vi]);
    if (v === null) continue;
    cells++;
    const d = String(row[ti]);
    const key = monthKey(+d.slice(0, 4), +d.slice(5, 7));
    const lat = li >= 0 ? Number(row[li]) : 0;
    const wgt = Math.cos((lat * Math.PI) / 180);
    const a = acc.get(key) ?? [0, 0];
    a[0] += v * wgt;
    a[1] += wgt;
    acc.set(key, a);
  }
  if (cells === 0) {
    throw new Error(
      region.kind === "point"
        ? "El servidor no tiene datos en ese punto (puede caer sobre tierra o bajo nubes permanentes). Prueba un punto mar adentro o un área."
        : "El servidor no devolvió datos válidos en esa área para el periodo elegido.",
    );
  }
  const map = new Map([...acc].map(([k, [sum, wgt]]) => [k, sum / wgt]));
  const units = table.table.columnUnits?.[vi] ?? info.units;
  return toGrid(map, y0, y1, {
    units: units ?? "",
    sourceLabel: label,
    urls: [url],
    notes: region.kind === "bbox" ? [`Promedio espacial de muestras cada ${latStride}×${lonStride} celdas del dataset ${opt.dataset}.`] : [],
  });
}
