// Serie mensual sobre una rejilla continua (un valor por mes, null = sin dato).

export interface MonthlySeries {
  years: number[];
  months: number[]; // 1..12
  values: (number | null)[];
  units: string;
  sourceLabel: string;
  /** URL exacta usada para descargar (se cita en el dossier). */
  urls: string[];
  /** Download notes such as adjusted boxes and sentinel values. */
  notes: string[];
  /**
   * Retrieval time (ISO 8601). Persistent cache entries can be days old, so
   * dossiers should cite this timestamp instead of the current date.
   */
  retrievedAt?: string;
}

export const monthKey = (y: number, m: number): number => y * 12 + (m - 1);
export const keyYear = (k: number): number => Math.floor(k / 12);
export const keyMonth = (k: number): number => (k % 12) + 1;

// ---------- Value cleaning ----------

/** Values at or below this threshold are treated as NASA sentinels (-999, -9999, ...). */
export const SENTINEL_FLOOR = -999;
/** Positive netCDF _FillValue values (9.96921e36, 1e35, ...) exceed this magnitude. */
const FILL_MAGNITUDE = 1e30;
const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Sentinel and non-finite values become null.
 * Text values are parsed strictly: "12abc" and "" both become null.
 */
export function clean(v: unknown): number | null {
  let x = NaN;
  if (typeof v === "number") x = v;
  else if (typeof v === "string") {
    const t = v.trim();
    if (NUM_RE.test(t)) x = Number(t);
  }
  if (!Number.isFinite(x) || x <= SENTINEL_FLOOR || Math.abs(x) >= FILL_MAGNITUDE) return null;
  return x;
}

// ---------- Accumulation ----------

/**
 * Optional weighted monthly average. Replaces the repeated
 * Map<key, [sum, weight]> pattern previously used by csv.ts and power.ts.
 */
export class MonthAccumulator {
  private acc = new Map<number, [number, number]>();

  add(year: number, month: number, value: number, weight = 1): void {
    if (!Number.isFinite(value) || !(weight > 0)) return;
    const k = monthKey(year, month);
    const a = this.acc.get(k) ?? [0, 0];
    a[0] += value * weight;
    a[1] += weight;
    this.acc.set(k, a);
  }

  /** Number of months with at least one value. */
  get size(): number {
    return this.acc.size;
  }

  /** Monthly-key to average-value map ready for toGrid. */
  means(): Map<number, number> {
    return new Map([...this.acc].map(([k, [s, w]]) => [k, s / w]));
  }
}

// ---------- Grid ----------

/**
 * Convert a monthly-key map into a continuous grid between y0 and y1,
 * trimming empty months at both ends. Metadata arrays are copied so cached
 * series do not share mutable arrays with their creator.
 */
export function toGrid(
  map: Map<number, number>,
  y0: number,
  y1: number,
  meta: Pick<MonthlySeries, "units" | "sourceLabel" | "urls" | "notes">,
): MonthlySeries {
  const base = {
    units: meta.units,
    sourceLabel: meta.sourceLabel,
    urls: [...meta.urls],
    notes: [...meta.notes],
    retrievedAt: new Date().toISOString(),
  };
  const keys = [...map.keys()].filter((k) => keyYear(k) >= y0 && keyYear(k) <= y1).sort((a, b) => a - b);
  if (keys.length === 0) {
    return { years: [], months: [], values: [], ...base };
  }
  const years: number[] = [];
  const months: number[] = [];
  const values: (number | null)[] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k++) {
    years.push(keyYear(k));
    months.push(keyMonth(k));
    const v = map.get(k);
    values.push(v !== undefined && Number.isFinite(v) ? v : null);
  }
  return { years, months, values, ...base };
}

/**
 * Trim to the inclusive [y0, y1] year range, then remove empty months from both ends.
 * The order matters: trimming nulls before applying y1 could leave trailing empty months.
 */
export function sliceYears(s: MonthlySeries, y0: number, y1: number): MonthlySeries {
  let i = 0;
  while (i < s.years.length && s.years[i] < y0) i++;
  let j = s.years.length;
  while (j > i && s.years[j - 1] > y1) j--;
  while (i < j && s.values[i] === null) i++;
  while (j > i && s.values[j - 1] === null) j--;
  return {
    ...s,
    years: s.years.slice(i, j),
    months: s.months.slice(i, j),
    values: s.values.slice(i, j),
    urls: [...s.urls],
    notes: [...s.notes],
  };
}

// ---------- Validation ----------

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((e) => typeof e === "string");
}

/**
 * Type guard for external data such as persistent cache entries and imports.
 * Validates the shape and ensures the grid is contiguous month by month.
 */
export function isMonthlySeries(x: unknown): x is MonthlySeries {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  const { years, months, values } = s;
  if (!Array.isArray(years) || !Array.isArray(months) || !Array.isArray(values)) return false;
  if (years.length !== months.length || months.length !== values.length) return false;
  if (typeof s.units !== "string" || typeof s.sourceLabel !== "string") return false;
  if (!isStringArray(s.urls) || !isStringArray(s.notes)) return false;
  if (s.retrievedAt !== undefined && typeof s.retrievedAt !== "string") return false;

  let prev = NaN;
  for (let i = 0; i < years.length; i++) {
    const y: unknown = years[i];
    const m: unknown = months[i];
    const v: unknown = values[i];
    if (typeof y !== "number" || typeof m !== "number" || !Number.isInteger(y) || !Number.isInteger(m)) return false;
    if (m < 1 || m > 12) return false;
    if (v !== null && !(typeof v === "number" && Number.isFinite(v))) return false;
    const k = monthKey(y, m);
    if (i > 0 && k !== prev + 1) return false;
    prev = k;
  }
  return true;
}

// ---------- Summary ----------

export function validCount(s: MonthlySeries): number {
  return s.values.reduce<number>((n, v) => n + (v === null ? 0 : 1), 0);
}

export function firstLast(s: MonthlySeries): { first: string; last: string } | null {
  if (!s.years.length) return null;
  const f = (i: number) => `${s.years[i]}-${String(s.months[i]).padStart(2, "0")}`;
  return { first: f(0), last: f(s.years.length - 1) };
}
