// CSV import: time series exported from NASA Giovanni ("Time Series, Area-Averaged")
// or any file with date and value columns. Daily data are averaged by month.
//
// Design: (1) RFC 4180 tokenizer for quoted fields, internal delimiters, and
// line breaks, (2) delimiter detected once per file, (3) date and value columns
// selected once per file, and (4) discarded data tracked in `notes`.
import { clean, keyYear, MonthAccumulator, toGrid, type MonthlySeries } from "./series";

export interface CsvOptions {
  /** Zero-based date column. The parser detects it when omitted. */
  dateColumn?: number;
  /** Zero-based value column or a fragment contained in its header. */
  valueColumn?: number | string;
}

// ---------- Dates ----------

type DatePattern = [re: RegExp, yearGroup: number, monthGroup: number];

const DATE_PATTERNS: DatePattern[] = [
  [/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[ T].*)?$/, 1, 2], // 2002-07, 2002-07-01, 2002-07-01T00:00:00Z
  [/^(\d{4})\/(\d{1,2})(?:\/\d{1,2})?$/, 1, 2], // 2002/07/01
  [/^(\d{4})(\d{2})(?:\d{2})?$/, 1, 2], // 200207, 20020701
  [/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/, 3, 2], // 01/07/2002 (DD/MM/AAAA)
  [/^(\d{1,2})[/.-](\d{4})$/, 2, 1], // 07/2002 (MM/AAAA)
];

function parseDate(cell: string): [number, number] | null {
  const c = cell.trim();
  for (const [re, yi, mi] of DATE_PATTERNS) {
    const m = c.match(re);
    if (!m) continue;
    const y = +m[yi];
    const mo = +m[mi];
    if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12) return [y, mo];
  }
  return null;
}

// ---------- Numbers ----------

const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "-", "--", "---"]);
const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Strict parsing: "12abc" is no longer converted to 12 as with parseFloat. */
function parseNumber(raw: string, decimalComma: boolean): number | null {
  let s = raw.trim();
  if (decimalComma && /^[+-]?\d+,\d+(?:e[+-]?\d+)?$/i.test(s)) s = s.replace(",", ".");
  return NUM_RE.test(s) ? Number(s) : null;
}

// ---------- CSV tokenizer ----------

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Choose the delimiter with the most consistent count per line. */
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 50);
  let best = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t"]) {
    const freq = new Map<number, number>();
    for (const l of lines) {
      const n = countOutsideQuotes(l, d);
      if (n > 0) freq.set(n, (freq.get(n) ?? 0) + 1);
    }
    for (const [n, f] of freq) {
      const score = f * 1000 + n;
      if (score > bestScore) {
        best = d;
        bestScore = score;
      }
    }
  }
  return best;
}

function parseRows(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
    } else if (ch === delim) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") continue;
    else field += ch;
  }
  if (inQuotes) throw new Error("El CSV tiene comillas sin cerrar.");
  if (field !== "" || row.length) endRow();
  return rows;
}

// ---------- Public API ----------

export function parseCsv(text: string, label: string, opts: CsvOptions = {}): MonthlySeries {
  text = text.replace(/^\uFEFF/, ""); // BOM
  const delim = detectDelimiter(text);
  const decimalComma = delim !== ","; // con ";" o tab se admite "1,5"
  const rows = parseRows(text, delim).filter((r) => r.length >= 2);
  if (!rows.length) throw new Error("The CSV does not contain rows with at least two columns.");

  const ncol = Math.max(...rows.map((r) => r.length));

  // 1) Date column: the one with the most parseable cells; ties use the leftmost column.
  const dateCounts = Array.from(
    { length: ncol },
    (_, c) => rows.filter((r) => r[c] !== undefined && parseDate(r[c]) !== null).length,
  );
  const dateCol = opts.dateColumn ?? dateCounts.indexOf(Math.max(...dateCounts));
  if (!(dateCounts[dateCol] >= 4)) {
    throw new Error(
      "No valid date column was found. Supported formats include YYYY-MM, YYYY-MM-DD, YYYY/MM/DD, YYYYMM, DD/MM/YYYY, and MM/YYYY.",
    );
  }

  const dataRows = rows.filter((r) => r[dateCol] !== undefined && parseDate(r[dateCol]) !== null);
  const firstIdx = rows.indexOf(dataRows[0]);
  const header = firstIdx > 0 ? rows[firstIdx - 1].map((h) => h.trim()) : [];

  // 2) Value column: select it once for the entire file, not once per row.
  const numericShare = (c: number) =>
    dataRows.filter((r) => r[c] !== undefined && parseNumber(r[c], decimalComma) !== null).length /
    dataRows.length;

  let valueCol: number;
  let others: number[] = [];
  if (typeof opts.valueColumn === "number") {
    valueCol = opts.valueColumn;
  } else if (typeof opts.valueColumn === "string") {
    const needle = opts.valueColumn.toLowerCase();
    valueCol = header.findIndex((h) => h.toLowerCase().includes(needle));
    if (valueCol < 0) throw new Error(`No column header contains "${opts.valueColumn}".`);
  } else {
    const cands = Array.from({ length: ncol }, (_, c) => c).filter(
      (c) => c !== dateCol && numericShare(c) >= 0.5,
    );
    if (!cands.length) throw new Error("No numeric value column was found beside the date column.");
    valueCol = cands.find((c) => /mean|avg|average|value|valor|media|dato/i.test(header[c] ?? "")) ?? cands[0];
    others = cands.filter((c) => c !== valueCol);
  }

  // 3) Accumulate monthly values and track discarded rows.
  const acc = new MonthAccumulator();
  let missing = 0;
  let invalid = 0;
  let masked = 0;
  for (const r of dataRows) {
    const [y, mo] = parseDate(r[dateCol])!;
    const raw = (r[valueCol] ?? "").trim();
    if (MISSING.has(raw.toLowerCase())) {
      missing++;
      continue;
    }
    const n = parseNumber(raw, decimalComma);
    if (n === null) {
      invalid++;
      continue;
    }
    const v = clean(n); // Sentinel and out-of-range values are handled by series.ts.
    if (v === null) {
      masked++;
      continue;
    }
    acc.add(y, mo, v);
  }

  if (acc.size < 4) {
    throw new Error(
      "The CSV does not contain enough valid date/value rows. It must include a date column and a numeric value column.",
    );
  }

  const units = text.match(/units?\s*[:=]\s*([^,;\t\r\n"]+)/i)?.[1].trim() ?? "";
  const map = acc.means();
  const years = [...map.keys()].map((k) => keyYear(k));

  const colName = (c: number) => header[c] || `columna ${c + 1}`;
  const notes = [
    `Imported from CSV: ${dataRows.length} dated rows, ${map.size} months with data. ` +
      `Date: ${colName(dateCol)}; value: ${colName(valueCol)}.`,
  ];
  if (missing) notes.push(`${missing} rows with an empty or "NA" value were skipped.`);
  if (invalid) notes.push(`${invalid} rows with a non-numeric value were skipped.`);
  if (masked) notes.push(`${masked} rows with a sentinel or out-of-range value were skipped.`);
  if (others.length) {
    notes.push(
      `Other numeric columns were detected (${others.map(colName).join(", ")}); "${colName(valueCol)}" was selected. ` +
        `Use the valueColumn option to select another one.`,
    );
  }

  return toGrid(map, Math.min(...years), Math.max(...years), {
    units,
    sourceLabel: label,
    urls: [],
    notes,
  });
}
