// CSV import for time series exported from NASA Giovanni ("Time Series, Area-Averaged")
// or any file containing date and value columns. Daily data are aggregated into
// monthly averages.

import { L } from "../i18n";
import { clean, monthKey, toGrid, type MonthlySeries } from "./series";

export interface CsvOptions {
  /** Zero-based date column. The parser detects it when omitted. */
  dateColumn?: number;
  /** Zero-based value column or a case-insensitive header fragment. */
  valueColumn?: number | string;
  /** Force comma-decimal parsing when the delimiter is not a comma. */
  decimalComma?: boolean;
}

type DatePattern = [pattern: RegExp, yearGroup: number, monthGroup: number];

const DATE_PATTERNS: DatePattern[] = [
  [/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[ T].*)?$/, 1, 2], // 2002-07, 2002-07-01, 2002-07-01T00:00:00Z
  [/^(\d{4})\/(\d{1,2})(?:\/\d{1,2})?(?:[ T].*)?$/, 1, 2], // 2002/07, 2002/07/01
  [/^(\d{4})(\d{2})(?:\d{2})?$/, 1, 2], // 200207, 20020701
  [/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ T].*)?$/, 3, 2], // 01/07/2002 (DD/MM/YYYY)
  [/^(\d{1,2})[\/.-](\d{4})$/, 2, 1], // 07/2002 (MM/YYYY)
];

const MISSING_VALUES = new Set(["", "na", "n/a", "nan", "null", "none", "-", "--", "---"]);
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const VALUE_HEADER_PATTERN = /mean|avg|average|value|valor|media|dato/i;

function parseDate(cell: string): [number, number] | null {
  const value = cell.trim();
  for (const [pattern, yearGroup, monthGroup] of DATE_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;

    const year = Number(match[yearGroup]);
    const month = Number(match[monthGroup]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) return [year, month];
  }
  return null;
}

function parseNumber(raw: string, decimalComma: boolean): number | null {
  let value = raw.trim();
  if (decimalComma && /^[+-]?\d+,\d+(?:e[+-]?\d+)?$/i.test(value)) value = value.replace(",", ".");
  return NUMBER_PATTERN.test(value) ? Number(value) : null;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (line[i] === delimiter && !quoted) {
      count++;
    }
  }
  return count;
}

/** Detect the delimiter with the most consistent field count in the sample. */
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 50);
  let bestDelimiter = ",";
  let bestScore = 0;

  for (const delimiter of [",", ";", "\t"]) {
    const frequencies = new Map<number, number>();
    for (const line of lines) {
      const count = countOutsideQuotes(line, delimiter);
      if (count > 0) frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
    }

    for (const [count, frequency] of frequencies) {
      const score = frequency * 1000 + count;
      if (score > bestScore) {
        bestDelimiter = delimiter;
        bestScore = score;
      }
    }
  }
  return bestDelimiter;
}

/** Parse RFC 4180-style rows, including quoted delimiters and line breaks. */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const character = text[i];

    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (character === delimiter) {
      endField();
    } else if (character === "\n") {
      endRow();
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) throw new Error(L("El CSV tiene un campo entre comillas sin cerrar.", "The CSV contains an unclosed quoted field."));
  if (field !== "" || row.length) endRow();
  return rows;
}

function assertColumnIndex(index: number, columnCount: number, name: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= columnCount) {
    throw new Error(L(`${name} debe ser un índice de columna válido (desde 0).`, `${name} must be a valid zero-based column index.`));
  }
}

function findHeader(rows: string[][], firstDataRow: number, columnCount: number): string[] {
  if (firstDataRow === 0) return [];
  const candidate = rows[firstDataRow - 1] ?? [];
  return Array.from({ length: columnCount }, (_, index) => (candidate[index] ?? "").trim());
}

export function parseCsv(text: string, label: string, options: CsvOptions = {}): MonthlySeries {
  const normalizedText = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalizedText);
  const decimalComma = options.decimalComma ?? delimiter !== ",";
  const rows = parseRows(normalizedText, delimiter).filter((row) => row.length >= 2);

  if (!rows.length) throw new Error(L("El CSV no tiene filas con al menos dos columnas.", "The CSV does not contain rows with at least two columns."));

  const columnCount = Math.max(...rows.map((row) => row.length));
  const parsedDates = rows.map((row) => row.map((cell) => parseDate(cell)));
  const dateCounts = Array.from({ length: columnCount }, (_, column) =>
    parsedDates.reduce((count, row) => count + (row[column] ? 1 : 0), 0),
  );

  const detectedDateColumn = dateCounts.indexOf(Math.max(...dateCounts));
  const dateColumn = options.dateColumn ?? detectedDateColumn;
  assertColumnIndex(dateColumn, columnCount, "dateColumn");
  if (dateCounts[dateColumn] < 4) {
    throw new Error(
      L(
        "No se encontró una columna de fechas válida. Formatos admitidos: AAAA-MM, AAAA-MM-DD, AAAA/MM/DD, AAAAMM, DD/MM/AAAA y MM/AAAA.",
        "No valid date column was found. Supported formats include YYYY-MM, YYYY-MM-DD, YYYY/MM/DD, YYYYMM, DD/MM/YYYY, and MM/YYYY.",
      ),
    );
  }

  const dataRows = rows
    .map((row, index) => ({ row, index, date: parsedDates[index][dateColumn] }))
    .filter((entry): entry is { row: string[]; index: number; date: [number, number] } => entry.date !== null);
  const header = findHeader(rows, dataRows[0].index, columnCount);

  const numericShare = (column: number) => {
    const numeric = dataRows.reduce(
      (count, entry) => count + (entry.row[column] !== undefined && parseNumber(entry.row[column], decimalComma) !== null ? 1 : 0),
      0,
    );
    return numeric / dataRows.length;
  };

  let valueColumn: number;
  let alternativeColumns: number[] = [];
  if (typeof options.valueColumn === "number") {
    valueColumn = options.valueColumn;
    assertColumnIndex(valueColumn, columnCount, "valueColumn");
  } else if (typeof options.valueColumn === "string") {
    const requested = options.valueColumn.trim().toLowerCase();
    valueColumn = header.findIndex((name) => name.toLowerCase().includes(requested));
    if (valueColumn < 0) throw new Error(L(`Ningún encabezado contiene "${options.valueColumn}".`, `No column header contains "${options.valueColumn}".`));
  } else {
    const candidates = Array.from({ length: columnCount }, (_, column) => column).filter(
      (column) => column !== dateColumn && numericShare(column) >= 0.5,
    );
    if (!candidates.length) throw new Error(L("No se encontró una columna numérica junto a la de fechas.", "No numeric value column was found beside the date column."));
    valueColumn = candidates.find((column) => VALUE_HEADER_PATTERN.test(header[column])) ?? candidates[0];
    alternativeColumns = candidates.filter((column) => column !== valueColumn);
  }

  const monthlyTotals = new Map<number, [sum: number, count: number]>();
  let missingValues = 0;
  let invalidValues = 0;
  let maskedValues = 0;

  for (const entry of dataRows) {
    const raw = (entry.row[valueColumn] ?? "").trim();
    if (MISSING_VALUES.has(raw.toLowerCase())) {
      missingValues++;
      continue;
    }

    const parsed = parseNumber(raw, decimalComma);
    if (parsed === null) {
      invalidValues++;
      continue;
    }

    const value = clean(parsed);
    if (value === null) {
      maskedValues++;
      continue;
    }

    const [year, month] = entry.date;
    const key = monthKey(year, month);
    const total = monthlyTotals.get(key) ?? [0, 0];
    total[0] += value;
    total[1]++;
    monthlyTotals.set(key, total);
  }

  if (monthlyTotals.size < 4) {
    throw new Error(
      L(
        "El CSV no tiene suficientes filas válidas de fecha y valor. Debe incluir una columna de fecha y otra numérica.",
        "The CSV does not contain enough valid date/value rows. It must include a date column and a numeric value column.",
      ),
    );
  }

  const units = normalizedText.match(/units?\s*[:=]\s*([^,;\t\r\n"]+)/i)?.[1].trim() ?? "";
  const monthlyValues = new Map([...monthlyTotals].map(([key, [sum, count]]) => [key, sum / count]));
  const years = [...monthlyValues.keys()].map((key) => Math.floor(key / 12));
  const columnName = (column: number) => header[column] || L(`columna ${column + 1}`, `column ${column + 1}`);

  const notes = [
    L(
      `Importado de CSV: ${dataRows.length} filas con fecha, ${monthlyValues.size} meses con datos. Fecha: ${columnName(dateColumn)}; valor: ${columnName(valueColumn)}.`,
      `Imported from CSV: ${dataRows.length} dated rows, ${monthlyValues.size} months with data. Date: ${columnName(dateColumn)}; value: ${columnName(valueColumn)}.`,
    ),
  ];
  if (missingValues) notes.push(L(`Se omitieron ${missingValues} filas sin valor.`, `${missingValues} rows with an empty or missing value were skipped.`));
  if (invalidValues) notes.push(L(`Se omitieron ${invalidValues} filas con valor no numérico.`, `${invalidValues} rows with a non-numeric value were skipped.`));
  if (maskedValues) notes.push(L(`Se omitieron ${maskedValues} filas con valor centinela o fuera de rango.`, `${maskedValues} rows with a sentinel or out-of-range value were skipped.`));
  if (alternativeColumns.length) {
    notes.push(
      L(
        `Se detectaron otras columnas numéricas (${alternativeColumns.map(columnName).join(", ")}); se usó ${columnName(valueColumn)}.`,
        `Other numeric columns were detected (${alternativeColumns.map(columnName).join(", ")}); column ${columnName(valueColumn)} was selected. Use the valueColumn option to select another one.`,
      ),
    );
  }

  return toGrid(monthlyValues, Math.min(...years), Math.max(...years), {
    units,
    sourceLabel: label,
    urls: [],
    notes,
  });
}
