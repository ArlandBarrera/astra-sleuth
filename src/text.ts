// Formateo y lenguaje claro: convierte el JSON del motor en frases que entiende un
// estudiante de secundaria, sin perder los números que necesita un científico.
import { SHORT, getVar, seasonText, type Season } from "./catalog";
import type { AnalyzeOut } from "./engine/types";

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
  return k in UNIT_MAP ? UNIT_MAP[k] : k;
}

/** Número con decimales adaptados a su magnitud. */
export function fmt(x: number | null | undefined, sig = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const a = Math.abs(x);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : Math.min(6, Math.max(0, sig - 1 - Math.floor(Math.log10(a))));
  return x.toLocaleString("es", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function fmtSigned(x: number, sig = 3): string {
  const s = fmt(x, sig);
  return x > 0 ? `+${s}` : s.replace("-", "−");
}

/** p-valor legible: "< 0,001" o con tres decimales. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0,001";
  return p.toLocaleString("es", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/** "p < 0,001" o "p = 0,023": listo para insertar en una frase. */
export function pEq(p: number): string {
  return p < 0.001 ? "p < 0,001" : `p = ${fmtP(p)}`;
}

/** p-valor en notación científica (modo científico). */
export function fmtPSci(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p === 0) return "< 1×10⁻³⁰⁰";
  if (p >= 0.001) return p.toFixed(4).replace(".", ",");
  const e = Math.floor(Math.log10(p));
  const m = p / 10 ** e;
  const sup = String(e).replace(/[-0-9]/g, (c) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(c)]);
  return `${m.toFixed(2).replace(".", ",")}×10${sup}`;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const monthName = (m: number) => MONTHS[m - 1];
export const ym = (y: number, m: number) => `${monthName(m)} ${y}`;

/** Minúsculas para usar dentro de una frase, conservando siglas (AOD, SST). */
export function lowerName(s: string): string {
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
  lat: number | null,
): Verdict {
  const mk = stats.mk;
  const p = hr ? mk.pHr : mk.p;
  const sig = hr ? mk.significantHr : mk.significant;
  const ci = hr ? mk.ciHrDecade : mk.ciDecade;
  const u = prettyUnits(units);
  const name = SHORT[variableId] ?? getVar(variableId).name_es;
  const verb = mk.slopeDecade > 0 ? "sube" : mk.slopeDecade < 0 ? "baja" : "no cambia";
  const amount = `${fmt(Math.abs(mk.slopeDecade))}${u ? " " + u : ""} por década`;
  const period = `${Math.round(stats.spanYears)} años, ${seasonText(season, lat)}`;

  const headline = sig
    ? `Sí hay tendencia: ${lowerName(name)} ${verb} ${amount}`
    : `Aún no se puede afirmar una tendencia en ${lowerName(name)}`;

  const line1 = `En ${place}, ${lowerName(name)} ${verb === "no cambia" ? "no muestra cambio neto" : `${verb} unos ${amount}`} (${period}).`;
  let line2: string;
  if (sig) {
    line2 = `Es muy poco probable que sea casualidad: ${pEq(p)}, menor que 0,05. La tendencia es estadísticamente significativa.`;
  } else {
    const rem = stats.horizon.yearsRemaining;
    const more = rem !== null && rem > 0 && Number.isFinite(rem) ? ` Con el ritmo y el ruido actuales harían falta unos ${Math.ceil(rem)} años más de datos.` : "";
    line2 = `El cambio todavía se confunde con la variación natural: ${pEq(p)}, mayor o igual que 0,05.${more}`;
  }
  let line3: string;
  const pt = stats.pettitt;
  if (pt && pt.significant) {
    const dir = pt.meanAfter > pt.meanBefore ? "subió" : "bajó";
    line3 = `Hubo un salto brusco cerca de ${ym(pt.year, pt.month)}: el nivel medio ${dir} ${fmt(Math.abs(pt.meanAfter - pt.meanBefore))}${u ? " " + u : ""} (prueba de Pettitt).`;
  } else if (stats.completeness < 0.8) {
    line3 = `Cuidado: solo el ${Math.round(stats.completeness * 100)} % de los meses tiene datos, lo que reduce la confianza.`;
  } else {
    line3 = `No se detecta un salto brusco: el cambio, si existe, es gradual. Datos completos al ${Math.round(stats.completeness * 100)} %.`;
  }
  return { significant: sig, headline, lines: [line1, line2, line3], p, slope: mk.slopeDecade, ci };
}

export function corrSentence(rho: number, p: number, aName: string, bName: string): string {
  const strength = Math.abs(rho) >= 0.6 ? "fuerte" : Math.abs(rho) >= 0.3 ? "moderada" : "débil";
  const sig = p < 0.05;
  if (!sig) return `No hay relación clara entre ${aName} y ${bName} (ρ = ${fmtSigned(rho, 2)}, ${pEq(p)}).`;
  return rho > 0
    ? `Relación ${strength} y significativa: cuando ${aName} está por encima de lo normal, ${bName} también tiende a estarlo (ρ = ${fmtSigned(rho, 2)}, ${pEq(p)}).`
    : `Relación ${strength} y opuesta: cuando ${aName} está por encima de lo normal, ${bName} tiende a estar por debajo (ρ = ${fmtSigned(rho, 2)}, ${pEq(p)}).`;
}
