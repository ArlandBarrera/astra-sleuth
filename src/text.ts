// Formateo y lenguaje claro: convierte el JSON del motor en frases que entiende un
// estudiante de secundaria, sin perder los números que necesita un científico.
import { short, seasonText, type Season } from "./catalog";
import { validRange, type MonthlySeries } from "./data/series";
import type { AnalyzeOut } from "./engine/types";
import { L, dec, lang, locale } from "./i18n";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const UNIT_MAP: Record<string, string> = {
  C: "°C",
  degree_C: "°C",
  degrees_C: "°C",
  celsius: "°C",
  "mm/day": "mm/día",
  "MJ/m^2/day": "MJ/m²/día",
  "kW-hr/m^2/day": "kWh/m²/día",
  "m/s": "m/s",
  "%": "%",
  "1": "",
  dimensionless: "",
  "mg m-3": "mg/m³",
  "mg m^-3": "mg/m³",
};

export function prettyUnits(u: string): string {
  const k = (u ?? "").trim();
  const out = k in UNIT_MAP ? UNIT_MAP[k] : k;
  return lang() === "en" ? out.replace("/día", "/day") : out;
}

/** Número con decimales adaptados a su magnitud. */
export function fmt(x: number | null | undefined, sig = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const a = Math.abs(x);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : Math.min(6, Math.max(0, sig - 1 - Math.floor(Math.log10(a))));
  return x.toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function fmtSigned(x: number, sig = 3): string {
  const s = fmt(x, sig);
  return x > 0 ? `+${s}` : s.replace("-", "−");
}

/** p-valor legible: "< 0,001" o con tres decimales. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return `< ${dec("0.001")}`;
  return p.toLocaleString(locale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** "p < 0,001" o "p = 0,023": listo para insertar en una frase. */
export function pEq(p: number): string {
  return p < 0.001 ? `p < ${dec("0.001")}` : `p = ${fmtP(p)}`;
}

/** p-valor en notación científica (modo científico). */
export function fmtPSci(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p === 0) return "< 1×10⁻³⁰⁰";
  if (p >= 0.001) return dec(p.toFixed(4));
  const e = Math.floor(Math.log10(p));
  const m = p / 10 ** e;
  const sup = String(e).replace(/[-0-9]/g, (c) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(c)]);
  return `${dec(m.toFixed(2))}×10${sup}`;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number) => (lang() === "en" ? MONTHS_EN : MONTHS_ES)[m - 1];
export const ym = (y: number, m: number) => `${monthName(m)} ${y}`;

/** Minúsculas para usar dentro de una frase, conservando siglas (AOD, SST). */
export function lowerName(s: string): string {
  if (lang() === "en") return s.charAt(0).toLowerCase() + s.slice(1);
  return s
    .split(" ")
    .map((w) => (/^\(?[A-Z0-9-]{2,}\)?$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

export interface Verdict {
  significant: boolean;
  headline: string;
  lines: [string, string, string];
  p: number;
  slope: number;
  ci: [number, number];
}

/** Veredicto en 3 líneas (micro-acción 3 de contexto.md, determinística). */
export function verdict(
  stats: AnalyzeOut,
  hr: boolean,
  variableId: string,
  units: string,
  place: string,
  season: Season,
  region: { lat: number; lon: number } | null,
): Verdict {
  const mk = stats.mk;
  const p = hr ? mk.pHr : mk.p;
  const sig = hr ? mk.significantHr : mk.significant;
  const ci = hr ? mk.ciHrDecade : mk.ciDecade;
  const u = prettyUnits(units);
  const name = lowerName(short(variableId));
  const up = mk.slopeDecade > 0;
  const flat = mk.slopeDecade === 0;
  const verb = flat ? L("no cambia", "does not change") : up ? L("sube", "rises") : L("baja", "falls");
  const amount = `${fmt(Math.abs(mk.slopeDecade))}${u ? " " + u : ""} ${L("por década", "per decade")}`;
  const period = `${Math.round(stats.spanYears)} ${L("años", "years")}, ${seasonText(season, region)}`;
  const pct = Math.round(stats.completeness * 100);

  const headline = sig
    ? L(`Sí hay tendencia: ${name} ${verb} ${amount}`, `There is a trend: ${name} ${verb} ${amount}`)
    : L(`Aún no se puede afirmar una tendencia en ${name}`, `A trend in ${name} cannot be claimed yet`);

  const line1 = flat
    ? L(`En ${place}, ${name} no muestra cambio neto (${period}).`, `In ${place}, ${name} shows no net change (${period}).`)
    : L(`En ${place}, ${name} ${verb} unos ${amount} (${period}).`, `In ${place}, ${name} ${verb} about ${amount} (${period}).`);
  let line2: string;
  if (sig) {
    line2 = L(
      `Es muy poco probable que sea casualidad: ${pEq(p)}, menor que 0,05. La tendencia es estadísticamente significativa.`,
      `It is very unlikely to be chance: ${pEq(p)}, below 0.05. The trend is statistically significant.`,
    );
  } else {
    const rem = stats.horizon.yearsRemaining;
    const ok = rem !== null && rem > 0 && Number.isFinite(rem);
    const more = ok
      ? L(` Con el ritmo y el ruido actuales harían falta unos ${Math.ceil(rem!)} años más de datos.`, ` At the current rate and noise, about ${Math.ceil(rem!)} more years of data would be needed.`)
      : "";
    // si alguna ventana reciente sí fue significativa, decirlo para no contradecir la gráfica
    const rs = recentSignificant(stats, hr);
    const recent = rs
      ? L(
          ` Algunas ventanas recientes (entre ${fmtYears(rs.min)} y ${fmtYears(rs.max)} años) sí dan p < 0,05, pero la serie completa no.`,
          ` Some recent windows (between ${fmtYears(rs.min)} and ${fmtYears(rs.max)} years) do reach p < 0.05, but the full series does not.`,
        )
      : "";
    line2 = L(
      `El cambio todavía se confunde con la variación natural: ${pEq(p)}, mayor o igual que 0,05.${recent}${more}`,
      `The change still blends in with natural variability: ${pEq(p)}, 0.05 or higher.${recent}${more}`,
    );
  }
  let line3: string;
  const pt = stats.pettitt;
  if (pt && pt.significant) {
    const rose = pt.meanAfter > pt.meanBefore;
    const jump = `${fmt(Math.abs(pt.meanAfter - pt.meanBefore))}${u ? " " + u : ""}`;
    line3 = L(
      `Hubo un salto brusco cerca de ${ym(pt.year, pt.month)}: el nivel medio ${rose ? "subió" : "bajó"} ${jump} (prueba de Pettitt).`,
      `There was an abrupt shift around ${ym(pt.year, pt.month)}: the mean level ${rose ? "rose" : "fell"} by ${jump} (Pettitt test).`,
    );
  } else if (stats.completeness < 0.8) {
    line3 = L(`Cuidado: solo el ${pct} % de los meses tiene datos, lo que reduce la confianza.`, `Caution: only ${pct}% of months have data, which lowers confidence.`);
  } else {
    line3 = L(
      `No se detecta un salto brusco: el cambio, si existe, es gradual. Datos completos al ${pct} %.`,
      `No abrupt shift detected: the change, if any, is gradual. Data ${pct}% complete.`,
    );
  }
  return { significant: sig, headline, lines: [line1, line2, line3], p, slope: mk.slopeDecade, ci };
}

export function corrSentence(rho: number, p: number, aName: string, bName: string): string {
  const a = Math.abs(rho);
  const strength = a >= 0.6 ? L("fuerte", "strong") : a >= 0.3 ? L("moderada", "moderate") : L("débil", "weak");
  const tail = `(ρ = ${fmtSigned(rho, 2)}, ${pEq(p)})`;
  if (p >= 0.05) return L(`No hay relación clara entre ${aName} y ${bName} ${tail}.`, `There is no clear relationship between ${aName} and ${bName} ${tail}.`);
  return rho > 0
    ? L(
        `Relación ${strength} y significativa: cuando ${aName} está por encima de lo normal, ${bName} también tiende a estarlo ${tail}.`,
        `A ${strength}, significant relationship: when ${aName} is above normal, ${bName} tends to be too ${tail}.`,
      )
    : L(
        `Relación ${strength} y opuesta: cuando ${aName} está por encima de lo normal, ${bName} tiende a estar por debajo ${tail}.`,
        `A ${strength}, opposite relationship: when ${aName} is above normal, ${bName} tends to be below ${tail}.`,
      );
}

/**
 * Aviso cuando el rango pedido (desde/hasta o fecha rápida) no coincide con los datos que
 * realmente entregó la fuente. null si coinciden a nivel de año.
 */
export function coverageNote(series: MonthlySeries, y0: number, y1: number, where = ""): string | null {
  const r = validRange(series);
  if (!r) return null;
  if (r.y0 <= y0 && r.y1 >= y1) return null;
  return L(
    `Pediste ${y0}–${y1}, pero el dataset${where} solo tiene datos de ${ym(r.y0, r.m0)} a ${ym(r.y1, r.m1)}. El análisis usa ese periodo real (${r.y0}–${r.y1}).`,
    `You asked for ${y0}–${y1}, but the dataset${where} only has data from ${ym(r.y0, r.m0)} to ${ym(r.y1, r.m1)}. The analysis uses that actual period (${r.y0}–${r.y1}).`,
  );
}

/**
 * Primer año L desde el cual la curva del Significance Horizon cruza p < 0,05 y se queda
 * debajo para todas las ventanas más largas. null si la ventana completa no es significativa.
 */
/**
 * Ventanas parciales (sin contar la serie completa, que es la última) con p < 0,05:
 * menor y mayor longitud en años. null si ninguna baja de 0,05.
 */
export function recentSignificant(stats: AnalyzeOut, hr: boolean): { min: number; max: number } | null {
  const part = stats.horizon.windows.slice(0, -1).filter((w) => (hr ? w.pHr : w.p) < 0.05);
  if (!part.length) return null;
  return { min: Math.min(...part.map((w) => w.years)), max: Math.max(...part.map((w) => w.years)) };
}

/** Años de una ventana del Horizon: enteros tal cual, la serie completa con un decimal. */
export const fmtYears = (y: number): string => fmt(y, 3);

export function significantSince(stats: AnalyzeOut, hr: boolean): number | null {
  const ws = stats.horizon.windows;
  let from: number | null = null;
  for (let i = ws.length - 1; i >= 0; i--) {
    const p = hr ? ws[i].pHr : ws[i].p;
    if (p < 0.05) from = ws[i].years;
    else break;
  }
  return from;
}
