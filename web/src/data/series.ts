// Serie mensual sobre una rejilla continua (un valor por mes, null = sin dato).

export interface MonthlySeries {
  years: number[];
  months: number[]; // 1..12
  values: (number | null)[];
  units: string;
  sourceLabel: string;
  /** URL exacta usada para descargar (se cita en el dossier). */
  urls: string[];
  /** Avisos de la descarga (cajas ajustadas, valores centinela, etc.). */
  notes: string[];
}

export const monthKey = (y: number, m: number): number => y * 12 + (m - 1);
export const keyYear = (k: number): number => Math.floor(k / 12);
export const keyMonth = (k: number): number => (k % 12) + 1;

/** Valores centinela de NASA (-999, -9999, ...) y no finitos → null. */
export function clean(v: unknown): number | null {
  const x = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(x) || x <= -999) return null;
  return x;
}

/**
 * Convierte un mapa clave-mensual → valor en una rejilla continua entre y0 y y1,
 * recortando los meses vacíos al principio y al final.
 */
export function toGrid(
  map: Map<number, number>,
  y0: number,
  y1: number,
  meta: Pick<MonthlySeries, "units" | "sourceLabel" | "urls" | "notes">,
): MonthlySeries {
  const keys = [...map.keys()].filter((k) => keyYear(k) >= y0 && keyYear(k) <= y1).sort((a, b) => a - b);
  if (keys.length === 0) {
    return { years: [], months: [], values: [], ...meta };
  }
  const years: number[] = [];
  const months: number[] = [];
  const values: (number | null)[] = [];
  for (let k = keys[0]; k <= keys[keys.length - 1]; k++) {
    years.push(keyYear(k));
    months.push(keyMonth(k));
    const v = map.get(k);
    values.push(v === undefined ? null : v);
  }
  return { years, months, values, ...meta };
}

export function validCount(s: MonthlySeries): number {
  return s.values.reduce<number>((n, v) => n + (v === null ? 0 : 1), 0);
}

export function firstLast(s: MonthlySeries): { first: string; last: string } | null {
  if (!s.years.length) return null;
  const f = (i: number) => `${s.years[i]}-${String(s.months[i]).padStart(2, "0")}`;
  return { first: f(0), last: f(s.years.length - 1) };
}
