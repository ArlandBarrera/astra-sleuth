// Series temporales con uPlot: valores crudos o anomalías + recta de Sen, banda IC 95 %,
// quiebre de Pettitt y zonas con avisos de calidad del sensor.
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { AnalyzeOut } from "../engine/types";
import { fmt, prettyUnits, ym } from "../text";

export interface ChartInput {
  stats: AnalyzeOut;
  years: number[];
  months: number[];
  view: "anom" | "raw";
  hr: boolean;
  color: string;
  units: string;
  /** Avisos de calidad con fecha de inicio (zona sombreada desde esa fecha). */
  quality: { key: number; label: string }[];
  syncKey?: string;
  label: string;
}

const INK = "#1D1D1B";
const GRID = "#E2DFD6";
const FONT = '11px "IBM Plex Mono", ui-monospace, monospace';

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface ChartHandle {
  destroy(): void;
  canvas(): HTMLCanvasElement | null;
}

export function timeSeriesChart(el: HTMLElement, c: ChartInput): ChartHandle {
  const g = c.stats.grid;
  const xs = c.years.map((y, i) => Date.UTC(y, c.months[i] - 1, 15) / 1000);
  const u = prettyUnits(c.units);
  const seasonal = c.stats.pointsPerYear === 1;
  const keyToX = (k: number) => Date.UTC(Math.floor(k / 12), k % 12, 15) / 1000;

  const data: uPlot.AlignedData = [xs];
  const series: uPlot.Series[] = [
    { label: "Fecha", value: (_u, v) => (v == null ? "—" : ym(new Date(v * 1000).getUTCFullYear(), new Date(v * 1000).getUTCMonth() + 1)) },
  ];
  const bands: uPlot.Band[] = [];
  const valueFmt = (_u: uPlot, v: number | null) => (v == null ? "—" : `${fmt(v)}${u ? " " + u : ""}`);

  if (c.view === "raw") {
    data.push(g.raw as (number | null)[]);
    series.push({ label: "Valor mensual medido", stroke: c.color, width: 1.5, value: valueFmt, spanGaps: false });
  } else {
    data.push(g.anom as (number | null)[]);
    series.push({ label: "Anomalía mensual", stroke: hexA(INK, 0.28), width: 1, value: valueFmt });
    if (seasonal) {
      data.push(g.tested as (number | null)[]);
      series.push({
        label: "Media de la estación",
        stroke: c.color,
        width: 0,
        paths: () => null,
        points: { show: true, size: 7, fill: c.color, stroke: c.color },
        value: valueFmt,
      });
    } else {
      data.push(g.smooth as (number | null)[]);
      series.push({ label: "Promedio de 12 meses", stroke: c.color, width: 2, value: valueFmt });
    }
    const lo = c.hr ? g.loHr : g.lo;
    const hi = c.hr ? g.hiHr : g.hi;
    data.push(g.fit as (number | null)[], lo as (number | null)[], hi as (number | null)[]);
    series.push(
      { label: "Tendencia de Sen", stroke: INK, width: 1.75, dash: [6, 4], value: valueFmt },
      { label: "Banda 95 % (inferior)", stroke: "transparent", width: 0, value: valueFmt, show: true },
      { label: "Banda 95 % (superior)", stroke: "transparent", width: 0, value: valueFmt, show: true },
    );
    const n = series.length;
    bands.push({ series: [n - 1, n - 2], fill: hexA(c.color, 0.16) });
  }

  const pet = c.stats.pettitt;
  const petX = pet && pet.significant && c.view === "anom" ? keyToX(pet.key) : null;

  const opts: uPlot.Options = {
    width: Math.max(320, el.clientWidth),
    height: el.clientWidth < 560 ? 230 : 280,
    pxAlign: 0,
    series,
    bands,
    scales: { x: { time: true } },
    cursor: { sync: c.syncKey ? { key: c.syncKey } : undefined, points: { size: 6 } },
    legend: { show: true, live: true },
    axes: [
      { stroke: INK, font: FONT, grid: { stroke: GRID, width: 1 }, ticks: { stroke: GRID } },
      {
        stroke: INK,
        font: FONT,
        size: 58,
        grid: { stroke: GRID, width: 1 },
        ticks: { stroke: GRID },
        label: c.view === "anom" ? `Anomalía${u ? ` (${u})` : ""}` : u || "Valor",
        labelFont: FONT,
        labelSize: 18,
        values: (_u, vals) => vals.map((v) => fmt(v, 2)),
      },
    ],
    hooks: {
      drawClear: [
        (p) => {
          const ctx = p.ctx;
          const { left, top, width, height } = p.bbox;
          ctx.save();
          for (const q of c.quality) {
            const x0 = p.valToPos(keyToX(q.key), "x", true);
            if (x0 > left + width) continue;
            const xa = Math.max(left, x0);
            ctx.fillStyle = "rgba(200,75,49,0.07)";
            ctx.fillRect(xa, top, left + width - xa, height);
            ctx.fillStyle = "#9C3A25";
            ctx.font = `${10 * devicePixelRatio}px "IBM Plex Mono", monospace`;
            ctx.textBaseline = "top";
            ctx.textAlign = "left"; // uPlot deja textAlign del dibujo de los ejes
            // si la zona es estrecha (gráfica en móvil), alinear el texto a la derecha para
            // que no se corte en el borde
            const pad = 4 * devicePixelRatio;
            const tw = ctx.measureText(q.label).width;
            const tx = xa + pad + tw > left + width ? Math.max(left + pad, left + width - tw - pad) : xa + pad;
            ctx.fillText(q.label, tx, top + pad);
          }
          if (c.view === "anom") {
            const y0 = p.valToPos(0, "y", true);
            if (y0 >= top && y0 <= top + height) {
              ctx.strokeStyle = hexA(INK, 0.45);
              ctx.lineWidth = devicePixelRatio;
              ctx.beginPath();
              ctx.moveTo(left, y0);
              ctx.lineTo(left + width, y0);
              ctx.stroke();
            }
          }
          ctx.restore();
        },
      ],
      draw: [
        (p) => {
          if (petX === null) return;
          const ctx = p.ctx;
          const { top, height } = p.bbox;
          const x = p.valToPos(petX, "x", true);
          ctx.save();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.25 * devicePixelRatio;
          ctx.setLineDash([2 * devicePixelRatio, 3 * devicePixelRatio]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + height);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = INK;
          ctx.font = `${10 * devicePixelRatio}px "IBM Plex Mono", monospace`;
          ctx.textBaseline = "bottom";
          ctx.textAlign = "left"; // uPlot deja textAlign del dibujo de los ejes
          const text = `Quiebre ${ym(pet!.year, pet!.month)}`;
          const w = ctx.measureText(text).width;
          const tx = x + 4 * devicePixelRatio + w > p.bbox.left + p.bbox.width ? x - w - 4 * devicePixelRatio : x + 4 * devicePixelRatio;
          const ty = top + height - 4 * devicePixelRatio;
          // fondo de papel para que la etiqueta se lea encima de los datos
          ctx.fillStyle = "rgba(251,250,247,0.85)";
          ctx.fillRect(tx - 2 * devicePixelRatio, ty - 12 * devicePixelRatio, w + 4 * devicePixelRatio, 13 * devicePixelRatio);
          ctx.fillStyle = INK;
          ctx.fillText(text, tx, ty);
          ctx.restore();
        },
      ],
    },
  };

  el.replaceChildren();
  const plot = new uPlot(opts, data, el);
  plot.root.setAttribute("aria-label", c.label);
  plot.root.querySelector(".u-legend")?.classList.add("chart-legend");
  // las series de la banda no necesitan fila propia en la leyenda
  plot.root.querySelectorAll(".u-legend .u-series").forEach((row, i) => {
    if (String(series[i]?.label ?? "").startsWith("Banda")) (row as HTMLElement).style.display = "none";
  });

  const ro = new ResizeObserver(() => {
    const w = Math.max(320, el.clientWidth);
    if (Math.abs(w - plot.width) > 2) plot.setSize({ width: w, height: w < 560 ? 230 : 280 });
  });
  ro.observe(el);

  return {
    destroy() {
      ro.disconnect();
      plot.destroy();
    },
    canvas() {
      return plot.root.querySelector("canvas");
    },
  };
}
