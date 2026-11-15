// NASA POWER monthly API (no API key, open CORS).
// Point: multiple variables per GET. Region: one variable per GET and a 2°–10° box.
// Requests pass through ./https.ts for timeouts, retries, and per-host limits;
// every response is validated before use.
import type { Region } from "../geo";
import { clampLat, normLon, round } from "../geo";
import { fetchJson } from "./https";
import { clean, MonthAccumulator, toGrid, type MonthlySeries } from "./series";

const BASE = "https://power.larc.nasa.gov/api/temporal/monthly";
const SERVICE = "NASA POWER";
export const POWER_MIN_YEAR = 1981;
/** Maximum point parameters per GET; larger requests are split into chunks. */
const MAX_POINT_PARAMS = 20;
/** Valid monthly keys: YYYYMM with MM 01–12; 13 is the annual average and is ignored. */
const MONTH_KEY = /^\d{4}(0[1-9]|1[0-3])$/;

// ---------- Validation ----------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function badFormat(what: string): Error {
  return new Error(`${SERVICE} returned ${what} in an unexpected format.`);
}

async function getJson(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const body = await fetchJson(url, { service: SERVICE, signal });
  if (!isRecord(body)) throw badFormat("una respuesta");
  return body;
}

function unitsOf(root: Record<string, unknown>, code: string): string {
  const params = root.parameters;
  if (!isRecord(params)) return "";
  const p = params[code];
  return isRecord(p) && typeof p.units === "string" ? p.units : "";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Accumulate valid months from a {YYYYMM: value} block and return the number added. */
function parseMonthly(code: string, raw: unknown, into: MonthAccumulator, weight: number): number {
  if (!isRecord(raw)) throw badFormat(`los datos de ${code}`);
  let added = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!MONTH_KEY.test(k)) continue;
    const m = +k.slice(4);
    if (m > 12) continue; // "13" = promedio anual
    if (v !== null && typeof v !== "number") throw badFormat(`non-numeric values for ${code}`);
    const val = v === null ? null : clean(v);
    if (val === null) continue;
    into.add(+k.slice(0, 4), m, val, weight);
    added++;
  }
  return added;
}

interface Cell {
  lat: number;
  parameter: Record<string, unknown>;
}

function readCell(f: unknown): Cell | null {
  if (!isRecord(f) || !isRecord(f.geometry) || !isRecord(f.properties)) return null;
  const c = f.geometry.coordinates;
  if (!Array.isArray(c) || typeof c[1] !== "number" || !Number.isFinite(c[1])) return null;
  const parameter = f.properties.parameter;
  return isRecord(parameter) ? { lat: c[1], parameter } : null;
}

// ---------- Geometry ----------

/** Fit a box to the regional API limits (2° minimum and 10° maximum per side). */
export function fitPowerBox(b: [number, number, number, number]): { box: [number, number, number, number]; note: string | null } {
  let [w, s, e, n] = b;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  let changed = false;
  const fit = (lo: number, hi: number, c: number): [number, number] => {
    const span = hi - lo;
    if (span < 2) {
      changed = true;
      return [c - 1, c + 1];
    }
    if (span > 10) {
      changed = true;
      return [c - 5, c + 5];
    }
    return [lo, hi];
  };
  [w, e] = fit(w, e, cx);
  [s, n] = fit(s, n, cy);
  s = clampLat(s);
  n = clampLat(n);
  w = Math.max(-180, w);
  e = Math.min(180, e);
  const box: [number, number, number, number] = [round(w, 3), round(s, 3), round(e, 3), round(n, 3)];
  return {
    box,
    note: changed
      ? `NASA POWER accepts areas from 2° to 10° per side; the area was adjusted to ${(box[2] - box[0]).toFixed(1)}° × ${(box[3] - box[1]).toFixed(1)}° around the same center.`
      : null,
  };
}

// ---------- Download ----------

/** Download one or more POWER variables for a region and return one series per code. */
export async function fetchPower(
  codes: string[],
  region: Region,
  y0: number,
  y1: number,
  label: string,
  signal?: AbortSignal,
): Promise<Record<string, MonthlySeries>> {
  const start = Math.max(POWER_MIN_YEAR, y0);
  const end = Math.max(start, y1);
  const unique = [...new Set(codes)];
  const out: Record<string, MonthlySeries> = {};

  if (region.kind === "point") {
    const lat = round(clampLat(region.lat), 4);
    const lon = round(normLon(region.lon), 4);
    await Promise.all(
      chunk(unique, MAX_POINT_PARAMS).map(async (group) => {
        const url =
          `${BASE}/point?parameters=${group.join(",")}&community=AG` +
          `&latitude=${lat}&longitude=${lon}&start=${start}&end=${end}&format=JSON`;
        const json = await getJson(url, signal);
        const props = json.properties;
        const parameter = isRecord(props) ? props.parameter : undefined;
        if (!isRecord(parameter)) throw badFormat("the point response");
        for (const code of group) {
          if (!(code in parameter)) throw new Error(`${SERVICE} did not return ${code}.`);
          const acc = new MonthAccumulator();
          if (parseMonthly(code, parameter[code], acc, 1) === 0) {
            throw new Error(`${SERVICE} returned no valid data for ${code} in the requested year range.`);
          }
          const map = acc.means();
          out[code] = toGrid(map, start, end, { units: unitsOf(json, code), sourceLabel: label, urls: [url], notes: [] });
        }
      }),
    );
    return out;
  }

  const { box, note } = fitPowerBox(region.bbox!);
  await Promise.all(
    unique.map(async (code) => {
      const url =
        `${BASE}/regional?parameters=${code}&community=AG` +
        `&latitude-min=${box[1]}&latitude-max=${box[3]}&longitude-min=${box[0]}&longitude-max=${box[2]}` +
        `&start=${start}&end=${end}&format=JSON`;
      const json = await getJson(url, signal);
      const rawFeats = Array.isArray(json.features) ? json.features : [];
      if (!rawFeats.length) throw new Error(`${SERVICE} returned no cells for ${code} in that area.`);

      const acc = new MonthAccumulator();
      let used = 0;
      for (const f of rawFeats) {
        const cell = readCell(f);
        if (!cell || !(code in cell.parameter)) continue;
        // Area-weighted average using cos(latitude); the floor avoids zero weight at the poles.
        const w = Math.max(Math.cos((cell.lat * Math.PI) / 180), 1e-3);
        if (parseMonthly(code, cell.parameter[code], acc, w) > 0) used++;
      }
      if (!used) throw new Error(`${SERVICE} returned no valid data for ${code} in that area.`);

      const map = acc.means();
      const skipped = rawFeats.length - used;
      out[code] = toGrid(map, start, end, {
        units: unitsOf(json, code),
        sourceLabel: label,
        urls: [url],
        notes: [
          `Area-weighted average of ${used} cells from the POWER grid.`,
          ...(skipped > 0 ? [`${skipped} cells without valid data were skipped.`] : []),
          ...(note ? [note] : []),
        ],
      });
    }),
  );
  return out;
}
