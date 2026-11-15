// Figuras SVG exportables con Observable Plot: Significance Horizon y Regime Decoupling.
import { L, dec } from "../i18n";
import * as Plot from "@observablehq/plot";
import type { HorizonWindow } from "../engine/types";
import { fmt, fmtP } from "../text";

/** true si el punto queda en la mitad baja del eje log (la etiqueta va encima). */
const lowerHalf = (p: number, minP: number): boolean => Math.log10(p) < Math.log10(minP) / 2;

const INK = "#1D1D1B";
const P_FLOOR = 1e-12;
const STYLE = { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: "11px", background: "transparent", color: INK, overflow: "visible" };

export interface HorizonSet {
  label: string;
  color: string;
  windows: HorizonWindow[];
}

/**
 * p-valor de Mann-Kendall usando solo los últimos L años, para L = 5 … total.
 * Si la curva cruza 0,05 se ve desde cuántos años la tendencia es detectable.
 */
export function horizonPlot(sets: HorizonSet[], hr: boolean, width: number): SVGSVGElement | HTMLElement {
  const rows = sets.flatMap((s) =>
    s.windows.map((w) => ({ set: s.label, color: s.color, years: w.years, p: Math.max(P_FLOOR, hr ? w.pHr : w.p) })),
  );
  const minP = Math.max(P_FLOOR, Math.min(0.01, ...rows.map((r) => r.p)) / 2);
  const minX = Math.min(5, ...rows.map((r) => r.years));
  const maxX = Math.max(10, ...rows.map((r) => r.years));
  const marks: Plot.Markish[] = [
    Plot.rect([{ x1: minX, x2: maxX, y1: minP, y2: 0.05 }], { x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: "#005A8D", fillOpacity: 0.06 }),
    Plot.ruleY([0.05], { stroke: INK, strokeDasharray: "5,4" }),
    Plot.text([{ x: maxX, y: 0.05 }], { x: "x", y: "y", text: () => L("umbral p = 0,05", "threshold p = 0.05"), textAnchor: "end", dy: -7, fill: INK }),
    Plot.text([{ x: minX, y: minP }], { x: "x", y: "y", text: () => L("zona significativa", "significant zone"), textAnchor: "start", dx: 4, dy: -8, fill: "#005A8D" }),
  ];
  const tip = (d: { years: number; p: number }) => `${fmt(d.years, 3)} ${L("años", "years")}: p = ${d.p.toExponential(2)}`;
  for (const s of sets) {
    const data = rows.filter((r) => r.set === s.label);
    marks.push(Plot.line(data, { x: "years", y: "p", stroke: s.color, strokeWidth: 2 }));
    marks.push(Plot.dot(data.slice(0, -1).filter((d) => [5, 10, 20, 40].includes(d.years)), { x: "years", y: "p", fill: s.color, r: 4, stroke: "#F4F3EF", strokeWidth: 1.5, title: tip }));
    // último punto = serie completa: el mismo p-valor que la tarjeta de arriba
    const last = data.at(-1);
    if (last) {
      marks.push(Plot.dot([last], { x: "years", y: "p", fill: "#F4F3EF", stroke: s.color, r: 5, strokeWidth: 2, title: tip }));
      marks.push(
        Plot.text([last], {
          x: "years",
          y: "p",
          text: (d: { years: number; p: number }) => `${L("serie completa", "full series")} · p = ${fmtP(d.p)}`,
          textAnchor: "end",
          dx: -8,
          dy: lowerHalf(last.p, minP) ? -10 : 12,
          fill: s.color,
        }),
      );
    }
  }
  return Plot.plot({
    width,
    height: 250,
    marginLeft: 62,
    marginBottom: 40,
    style: STYLE,
    x: { label: L("Años más recientes incluidos en la prueba →", "Most recent years included in the test →"), domain: [minX, maxX], ticks: [5, 10, 15, 20, 25, 30, 35, 40, 45].filter((t) => t <= maxX), grid: true },
    y: {
      type: "log",
      label: L("↑ p-valor (escala logarítmica)", "↑ p-value (log scale)"),
      domain: [minP, 1],
      grid: true,
      tickFormat: (d: number) => (d >= 0.001 ? dec(String(d)) : `1e${Math.round(Math.log10(d))}`),
    },
    marks,
  });
}

export interface ScatterInput {
  x: number[];
  y: number[];
  keys: number[];
  splitKey: number | null;
  splitLabel: [string, string];
  color: string;
  xLabel: string;
  yLabel: string;
}

/** Diagrama de dispersión de anomalías con un color por régimen (antes / después). */
export function scatterPlot(s: ScatterInput, width: number): SVGSVGElement | HTMLElement {
  const rows = s.x.map((x, i) => ({
    x,
    y: s.y[i],
    regime: s.splitKey === null ? s.splitLabel[0] : s.keys[i] < s.splitKey ? s.splitLabel[0] : s.splitLabel[1],
  }));
  const domain = s.splitKey === null ? [s.splitLabel[0]] : s.splitLabel;
  const range = s.splitKey === null ? [s.color] : ["#9C978A", s.color];
  return Plot.plot({
    width,
    height: 300,
    marginLeft: 62,
    marginBottom: 42,
    style: STYLE,
    color: { domain, range, legend: s.splitKey !== null },
    x: { label: `${s.xLabel} →`, grid: true, tickFormat: (d: number) => fmt(d, 2) },
    y: { label: `↑ ${s.yLabel}`, grid: true, tickFormat: (d: number) => fmt(d, 2) },
    marks: [
      Plot.ruleX([0], { stroke: INK, strokeOpacity: 0.35 }),
      Plot.ruleY([0], { stroke: INK, strokeOpacity: 0.35 }),
      Plot.dot(rows, { x: "x", y: "y", fill: "regime", r: 2.6, fillOpacity: 0.75 }),
      Plot.linearRegressionY(rows, { x: "x", y: "y", stroke: "regime", strokeWidth: 2, ci: 0 }),
    ],
  });
}
