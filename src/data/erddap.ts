// NOAA / NASA ERDDAP (griddap, JSON, sin API key).
// Las dimensiones, el nombre de la variable, la resolución, el orden de la latitud y la
// convención de longitud (−180…180 o 0…360) se descubren en tiempo de ejecución desde
// /info/<dataset>/index.json.
//
// Robustez: los servidores ERDDAP cortan (502/504) las consultas largas, así que la serie
// se pide en tramos de pocos años, en paralelo, con tiempo límite y reintentos. Si una
// fuente falla por completo se prueba la siguiente (servidor espejo o dataset alterno).
import type { Region } from "../geo";
import { clampLat, normLon, round } from "../geo";
import { L } from "../i18n";
import { clean, monthKey, toGrid, type MonthlySeries } from "./series";

export interface ErddapSource {
  host: string;
  dataset: string;
  variable: string;
  /** Nombre legible de la fuente (se muestra en la ficha de la serie). */
  label: string;
  /** "YYYY-MM" opcionales: recorte conocido del dataset. */
  start?: string;
  end?: string;
}

export type Progress = (done: number, total: number, host: string) => void;

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
  latDesc: boolean;
  latRange: [number, number];
  lonRange: [number, number];
}

const INFO_TIMEOUT = 15_000;
const CHUNK_TIMEOUT = 50_000;
const CHUNK_YEARS = 5;
const CONCURRENCY = 3; // con 5, OceanWatch empieza a rechazar conexiones
const RETRIES = 3;

const infoCache = new Map<string, Promise<DatasetInfo>>();

function hostName(host: string): string {
  try {
    return new URL(host).host;
  } catch {
    return host;
  }
}

class HttpError extends Error {
  constructor(
    msg: string,
    readonly status: number,
    /** true = el problema es del lugar/periodo, no del servidor: otra fuente no ayudaría. */
    readonly final = false,
  ) {
    super(msg);
  }
}

/** Señal que se cancela con la del usuario o al vencer el tiempo límite. */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctl = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    ctl.abort();
  }, ms);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctl.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function getTable(url: string, host: string, ms: number, signal?: AbortSignal): Promise<ErddapTable> {
  const t = withTimeout(signal, ms);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: t.signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (t.timedOut()) throw new HttpError(L(`${hostName(host)} no respondió a tiempo`, `${hostName(host)} did not respond in time`), 504);
      throw new HttpError(L(`no se pudo conectar con ${hostName(host)}`, `could not connect to ${hostName(host)}`), 0);
    }
    const text = await res.text();
    if (!res.ok) {
      const m = text.match(/message="([^"]+)"/) ?? text.match(/Error[^\n<]{0,300}/);
      throw new HttpError(`${hostName(host)} ${L("respondió", "responded")} ${res.status}: ${m ? (m[1] ?? m[0]) : "error"}`, res.status);
    }
    try {
      return JSON.parse(text) as ErddapTable;
    } catch {
      throw new HttpError(L(`${hostName(host)} devolvió una respuesta no válida`, `${hostName(host)} returned an invalid response`), 502);
    }
  } catch (e) {
    if (t.timedOut() && !(e instanceof HttpError)) throw new HttpError(L(`${hostName(host)} no respondió a tiempo`, `${hostName(host)} did not respond in time`), 504);
    throw e;
  } finally {
    t.done();
  }
}

/** Errores transitorios: red, tiempo límite, 429 y 5xx. Un 4xx de sintaxis no se reintenta. */
const transient = (e: unknown) => e instanceof HttpError && (e.status === 0 || e.status === 429 || e.status >= 500);

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

async function getWithRetry(url: string, host: string, signal?: AbortSignal): Promise<ErddapTable> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getTable(url, host, CHUNK_TIMEOUT, signal);
    } catch (e) {
      if (signal?.aborted || attempt >= RETRIES || !transient(e)) throw e;
      await sleep(1000 * 2 ** attempt, signal);
    }
  }
}

async function datasetInfo(src: ErddapSource, signal?: AbortSignal): Promise<DatasetInfo> {
  const key = `${src.host}|${src.dataset}|${src.variable}`;
  let p = infoCache.get(key);
  if (!p) {
    p = (async () => {
      const t = await getTable(`${src.host}/info/${src.dataset}/index.json`, src.host, INFO_TIMEOUT, signal);
      const rows = t.table.rows as string[][];
      const dimRows = rows.filter((r) => r[0] === "dimension");
      const dims = dimRows.map((r) => r[1]);
      const vars = rows.filter((r) => r[0] === "variable").map((r) => r[1]);
      const stem = src.variable.slice(0, 4).toLowerCase();
      const variable = vars.includes(src.variable) ? src.variable : (vars.find((v) => v.toLowerCase().includes(stem)) ?? src.variable);
      const attr = (v: string, a: string) => rows.find((r) => r[0] === "attribute" && r[1] === v && r[2] === a)?.[4];
      const range = (v: string) => (attr(v, "actual_range") ?? "").split(",").map((x) => parseFloat(x));
      const spacing = (d: string) => parseFloat(dimRows.find((r) => r[1] === d)?.[4]?.match(/averageSpacing=([-\d.eE]+)/)?.[1] ?? "NaN");
      const res = (g: string, d: string) => {
        const a = parseFloat(attr("NC_GLOBAL", g) ?? "");
        if (Number.isFinite(a) && a > 0) return a;
        const s = Math.abs(spacing(d));
        return Number.isFinite(s) && s > 0 ? s : 0.04;
      };
      const tr = range("time");
      const la = range("latitude");
      const lo = range("longitude");
      const pair = (x: number[], fb: [number, number]): [number, number] =>
        Number.isFinite(x[0]) && Number.isFinite(x[1]) ? [Math.min(x[0], x[1]), Math.max(x[0], x[1])] : fb;
      return {
        dims: dims.length ? dims : ["time", "latitude", "longitude"],
        variable,
        units: attr(variable, "units") ?? "",
        timeMin: Number.isFinite(tr[0]) ? tr[0] : null,
        timeMax: Number.isFinite(tr[1]) ? tr[1] : null,
        latRes: res("geospatial_lat_resolution", "latitude"),
        lonRes: res("geospatial_lon_resolution", "longitude"),
        latDesc: spacing("latitude") < 0,
        latRange: pair(la, [-90, 90]),
        lonRange: pair(lo, [-180, 180]),
      };
    })();
    infoCache.set(key, p);
    p.catch(() => infoCache.delete(key));
  }
  return p;
}

const iso = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 19) + "Z";
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Ejecuta tareas con un máximo de `n` en paralelo; falla en cuanto una falla. */
async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      const i = next++;
      try {
        out[i] = await tasks[i]();
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

async function fetchFrom(
  src: ErddapSource,
  region: Region,
  y0: number,
  y1: number,
  signal: AbortSignal | undefined,
  onProgress: Progress | undefined,
): Promise<MonthlySeries> {
  const info = await datasetInfo(src, signal);

  // ventana de tiempo, recortada al rango real del dataset
  let t0 = Date.UTC(y0, 0, 1) / 1000;
  let t1 = Date.UTC(y1, 11, 31) / 1000;
  if (src.start) {
    const [sy, sm] = src.start.split("-").map(Number);
    t0 = Math.max(t0, Date.UTC(sy, sm - 1, 1) / 1000);
  }
  if (src.end) {
    const [ey, em] = src.end.split("-").map(Number);
    t1 = Math.min(t1, Date.UTC(ey, em, 0) / 1000);
  }
  if (info.timeMin !== null) t0 = Math.max(t0, info.timeMin);
  if (info.timeMax !== null) t1 = Math.min(t1, info.timeMax);
  if (t1 < t0) throw new HttpError(L("El periodo elegido queda fuera del rango del dataset.", "The chosen period is outside the dataset's time range."), 400, true);

  // longitud en la convención del dataset (0…360 si su rango pasa de 180)
  const to360 = info.lonRange[1] > 180;
  const lonConv = (x: number) => (to360 ? ((x % 360) + 360) % 360 : normLon(x));
  const [laMin, laMax] = info.latRange;
  const [loMin, loMax] = info.lonRange;

  // espacio: punto o caja con salto (stride) para ~6×6 muestras por mes
  let s: number, n: number, latStride = 1, lonStride = 1;
  let lonSegs: [number, number][];
  if (region.kind === "point") {
    s = n = round(clamp(clampLat(region.lat), laMin, laMax), 4);
    const x = round(clamp(lonConv(region.lon), loMin, loMax), 4);
    lonSegs = [[x, x]];
  } else {
    const [w, ss, e, nn] = region.bbox!;
    s = round(clamp(ss, laMin, laMax), 4);
    n = round(clamp(nn, laMin, laMax), 4);
    latStride = Math.max(1, Math.ceil((n - s) / info.latRes / 6));
    lonStride = Math.max(1, Math.ceil((e - w) / info.lonRes / 6));
    const cw = lonConv(w);
    const ce = lonConv(e);
    // una caja que cruza 0° en un dataset 0…360 se parte en dos tramos de longitud
    lonSegs = cw <= ce ? [[cw, ce]] : [[cw, loMax], [loMin, ce]];
    lonSegs = lonSegs.map(([a, b]) => [round(clamp(a, loMin, loMax), 4), round(clamp(b, loMin, loMax), 4)]);
  }

  // tramos de tiempo de CHUNK_YEARS años
  const chunks: [number, number][] = [];
  for (let a = t0; a <= t1; ) {
    const d = new Date(a * 1000);
    const b = Math.min(t1, Date.UTC(d.getUTCFullYear() + CHUNK_YEARS, d.getUTCMonth(), d.getUTCDate()) / 1000 - 1);
    chunks.push([a, b]);
    a = b + 1;
  }

  const build = (c0: number, c1: number, [w, e]: [number, number]) => {
    const parts = info.dims.map((d) => {
      if (d === "time") return `[(${iso(c0)}):1:(${iso(c1)})]`;
      if (d === "latitude") return info.latDesc ? `[(${n}):${latStride}:(${s})]` : `[(${s}):${latStride}:(${n})]`;
      if (d === "longitude") return `[(${w}):${lonStride}:(${e})]`;
      return "[0]"; // altitud / profundidad: primer nivel (superficie)
    });
    return `${src.host}/griddap/${src.dataset}.json?${encodeURIComponent(info.variable + parts.join(""))}`;
  };

  const urls = chunks.flatMap(([c0, c1]) => lonSegs.map((seg) => build(c0, c1, seg)));
  let done = 0;
  onProgress?.(0, urls.length, src.host);
  // si un tramo falla del todo, cancela los demás en vuelo
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  signal?.addEventListener("abort", relay, { once: true });
  let tables: ErddapTable[];
  try {
    tables = await pool(
      urls.map((u) => async () => {
        const t = await getWithRetry(u, src.host, ctl.signal);
        onProgress?.(++done, urls.length, src.host);
        return t;
      }),
      CONCURRENCY,
    );
  } catch (e) {
    ctl.abort();
    throw e;
  } finally {
    signal?.removeEventListener("abort", relay);
  }

  const acc = new Map<number, [number, number]>();
  const seen = new Set<string>(); // los tramos pueden solaparse en el mes frontera
  let cells = 0;
  let units = info.units;
  for (const table of tables) {
    const cols = table.table.columnNames;
    const ti = cols.indexOf("time");
    const vi = cols.indexOf(info.variable);
    const li = cols.indexOf("latitude");
    const oi = cols.indexOf("longitude");
    units = table.table.columnUnits?.[vi] ?? units;
    for (const row of table.table.rows) {
      const d = String(row[ti]);
      const id = `${d}|${row[li]}|${row[oi]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const v = clean(row[vi]);
      if (v === null) continue;
      cells++;
      const key = monthKey(+d.slice(0, 4), +d.slice(5, 7));
      const lat = li >= 0 ? Number(row[li]) : 0;
      const wgt = Math.cos((lat * Math.PI) / 180);
      const a = acc.get(key) ?? [0, 0];
      a[0] += v * wgt;
      a[1] += wgt;
      acc.set(key, a);
    }
  }
  if (cells === 0) {
    throw new HttpError(
      region.kind === "point"
        ? L(
            "El servidor no tiene datos en ese punto (puede caer sobre tierra o bajo nubes permanentes). Prueba un punto mar adentro o un área.",
            "The server has no data at that point (it may be on land or under persistent clouds). Try a point farther offshore or an area.",
          )
        : L("El servidor no devolvió datos válidos en esa área para el periodo elegido.", "The server returned no valid data in that area for the chosen period."),
      404,
      true,
    );
  }
  const map = new Map([...acc].map(([k, [sum, wgt]]) => [k, sum / wgt]));
  return toGrid(map, y0, y1, {
    units: units ?? "",
    sourceLabel: src.label,
    urls,
    notes:
      region.kind === "bbox"
        ? [L(`Promedio espacial de muestras cada ${latStride}×${lonStride} celdas del dataset ${src.dataset}.`, `Spatial mean of samples every ${latStride}×${lonStride} cells of dataset ${src.dataset}.`)]
        : [],
  });
}

/**
 * Descarga la serie mensual probando las fuentes en orden. Una fuente se descarta si su
 * servidor no responde o falla tras los reintentos; "sin datos en ese lugar" no se reintenta
 * en otra fuente porque el resultado sería el mismo.
 */
export async function fetchErddap(
  sources: ErddapSource[],
  region: Region,
  y0: number,
  y1: number,
  signal?: AbortSignal,
  onProgress?: Progress,
): Promise<MonthlySeries> {
  const errors: string[] = [];
  for (const src of sources) {
    try {
      const out = await fetchFrom(src, region, y0, y1, signal, onProgress);
      if (errors.length) out.notes.push(L(`Fuente alterna usada: ${src.label} (la principal falló).`, `Fallback source used: ${src.label} (the primary failed).`));
      return out;
    } catch (e) {
      if (signal?.aborted || (e as Error).name === "AbortError") throw e;
      if (e instanceof HttpError && e.final) throw e;
      errors.push((e as Error).message);
    }
  }
  throw new Error(
    L(
      `No se pudo descargar desde ERDDAP (${errors.join("; ")}). Los servidores pueden estar caídos o bloqueados en tu red. Intenta más tarde o carga un CSV propio en el paso 2 (opción bajo la tarjeta de la región).`,
      `Could not download from ERDDAP (${errors.join("; ")}). The servers may be down or blocked on your network. Try again later or load your own CSV in step 2 (option under the region card).`,
    ),
  );
}
