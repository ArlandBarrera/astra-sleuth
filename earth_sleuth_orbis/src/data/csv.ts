// Importación de CSV: series exportadas de NASA Giovanni ("Time Series, Area-Averaged")
// o cualquier archivo con columnas fecha, valor. Datos diarios se promedian por mes.
import { clean, monthKey, toGrid, type MonthlySeries } from "./series";

const DATE_RE = [
  /^"?(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[ T].*)?"?$/, // 2002-07, 2002-07-01, 2002-07-01 00:00:00
  /^"?(\d{4})\/(\d{1,2})(?:\/\d{1,2})?"?$/, // 2002/07/01
  /^"?(\d{4})(\d{2})(?:\d{2})?"?$/, // 200207, 20020701
];

function parseDate(cell: string): [number, number] | null {
  const c = cell.trim();
  for (const re of DATE_RE) {
    const m = c.match(re);
    if (m) {
      const y = +m[1];
      const mo = +m[2];
      if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12) return [y, mo];
    }
  }
  return null;
}

export function parseCsv(text: string, label: string): MonthlySeries {
  const acc = new Map<number, [number, number]>();
  let units = "";
  let rows = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Excel en español exporta "2002-07-01;0,153": punto y coma como separador y coma
    // decimal. Antes la coma decimal hacía elegir "," como separador y el archivo fallaba.
    const delim = line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",";
    const cells = line.split(delim).map((c) => (delim !== "," && /^\s*"?-?\d+,\d+(?:[eE][-+]?\d+)?"?\s*$/.test(c) ? c.replace(",", ".") : c));
    const u = line.match(/units?\s*[:=]\s*([^,;\t]+)/i);
    if (u && !units) units = u[1].trim();
    const di = cells.findIndex((c) => parseDate(c) !== null);
    if (di < 0) continue;
    const date = parseDate(cells[di])!;
    const num = (c: string) => parseFloat(c.trim().replace(/^"|"$/g, ""));
    const valCell = cells.slice(di + 1).find((c) => c.trim() !== "" && Number.isFinite(num(c)));
    if (valCell === undefined) continue;
    const v = clean(num(valCell));
    rows++;
    if (v === null) continue;
    const key = monthKey(date[0], date[1]);
    const a = acc.get(key) ?? [0, 0];
    a[0] += v;
    a[1] += 1;
    acc.set(key, a);
  }
  if (acc.size < 4) {
    throw new Error("No se encontraron suficientes filas con fecha y valor. El CSV debe tener una columna de fecha (AAAA-MM o AAAA-MM-DD) y otra numérica.");
  }
  const map = new Map([...acc].map(([k, [s, n]]) => [k, s / n]));
  const years = [...map.keys()].map((k) => Math.floor(k / 12));
  return toGrid(map, Math.min(...years), Math.max(...years), {
    units,
    sourceLabel: label,
    urls: [],
    notes: [`Importado desde CSV: ${rows} filas leídas, ${map.size} meses con dato.`],
  });
}
