// NASA POWER, API mensual (sin API key, CORS abierto).
// Punto: varias variables en un solo GET. Región: 1 variable por GET y caja de 2° a 10°.
import type { Region } from "../geo";
import { clampLat, normLon, round } from "../geo";
import { clean, monthKey, toGrid, type MonthlySeries } from "./series";

const BASE = "https://power.larc.nasa.gov/api/temporal/monthly";
export const POWER_MIN_YEAR = 1981;

interface PowerParam {
  units?: string;
  longname?: string;
}
interface PowerPoint {
  properties?: { parameter?: Record<string, Record<string, number>> };
  parameters?: Record<string, PowerParam>;
  messages?: string[];
}
interface PowerRegional {
  features?: { geometry: { coordinates: number[] }; properties: { parameter: Record<string, Record<string, number>> } }[];
  parameters?: Record<string, PowerParam>;
  messages?: string[];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("No se pudo conectar con NASA POWER. Revisa tu conexión a internet.");
  }
  const body = (await res.json().catch(() => ({}))) as { messages?: string[]; header?: string };
  if (!res.ok) {
    const msg = body.messages?.join(" ") || body.header || `HTTP ${res.status}`;
    throw new Error(`NASA POWER rechazó la consulta: ${msg}`);
  }
  return body as T;
}

/** Ajusta una caja a los límites de la API regional (mínimo 2°, máximo 10° por lado). */
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
      ? `NASA POWER solo acepta áreas de 2° a 10° por lado: el área se ajustó a ${(box[2] - box[0]).toFixed(1)}° × ${(box[3] - box[1]).toFixed(1)}° con el mismo centro.`
      : null,
  };
}

function parseMonthly(param: Record<string, number>, into: Map<number, [number, number]>, weight: number): void {
  for (const [k, v] of Object.entries(param)) {
    const m = +k.slice(4);
    if (m < 1 || m > 12) continue; // "13" = promedio anual
    const val = clean(v);
    if (val === null) continue;
    const key = monthKey(+k.slice(0, 4), m);
    const acc = into.get(key) ?? [0, 0];
    acc[0] += val * weight;
    acc[1] += weight;
    into.set(key, acc);
  }
}

/** Descarga una o varias variables POWER para una región. Devuelve una serie por código. */
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
  const out: Record<string, MonthlySeries> = {};

  if (region.kind === "point") {
    const url =
      `${BASE}/point?parameters=${codes.join(",")}&community=AG` +
      `&latitude=${round(clampLat(region.lat), 4)}&longitude=${round(normLon(region.lon), 4)}` +
      `&start=${start}&end=${end}&format=JSON`;
    const json = await getJson<PowerPoint>(url, signal);
    for (const code of codes) {
      const param = json.properties?.parameter?.[code];
      if (!param) throw new Error(`NASA POWER no devolvió ${code}.`);
      const acc = new Map<number, [number, number]>();
      parseMonthly(param, acc, 1);
      const map = new Map([...acc].map(([k, [s, w]]) => [k, s / w]));
      out[code] = toGrid(map, start, end, {
        units: json.parameters?.[code]?.units ?? "",
        sourceLabel: label,
        urls: [url],
        notes: [],
      });
    }
    return out;
  }

  const { box, note } = fitPowerBox(region.bbox!);
  for (const code of codes) {
    const url =
      `${BASE}/regional?parameters=${code}&community=AG` +
      `&latitude-min=${box[1]}&latitude-max=${box[3]}&longitude-min=${box[0]}&longitude-max=${box[2]}` +
      `&start=${start}&end=${end}&format=JSON`;
    const json = await getJson<PowerRegional>(url, signal);
    const feats = json.features ?? [];
    if (!feats.length) throw new Error(`NASA POWER no devolvió celdas para ${code} en esa área.`);
    const acc = new Map<number, [number, number]>();
    for (const f of feats) {
      const lat = f.geometry.coordinates[1];
      // promedio ponderado por área de celda (cos de la latitud)
      parseMonthly(f.properties.parameter[code] ?? {}, acc, Math.cos((lat * Math.PI) / 180));
    }
    const map = new Map([...acc].map(([k, [s, w]]) => [k, s / w]));
    out[code] = toGrid(map, start, end, {
      units: json.parameters?.[code]?.units ?? "",
      sourceLabel: label,
      urls: [url],
      notes: [`Promedio de ${feats.length} celdas de la rejilla POWER, ponderado por área.`, ...(note ? [note] : [])],
    });
  }
  return out;
}
