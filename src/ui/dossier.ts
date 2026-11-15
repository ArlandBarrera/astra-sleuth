// Exportación: dossier HTML autocontenido (texto + figuras + números), CSV y JSON.
import { getVar, seasonText, short, sourceLabel, varName } from "../catalog";
import { describeRegion, surfaceLabel } from "../geo";
import { L, lang, locale } from "../i18n";
import type { Analysis, RegionResult } from "../state";
import { coverageNote, esc, fmt, fmtPSci, fmtSigned, prettyUnits, verdict, ym } from "../text";
import { placeName } from "./results";

function download(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(a: Analysis): string {
  return `astra-sleuth_${a.variableId}_${a.season}_${a.createdAt.slice(0, 10)}`;
}

const regions = (a: Analysis) => [a.A, a.B].filter((x): x is RegionResult => !!x);

export function exportCsv(a: Analysis): void {
  const lines = ["region,variable,year,month,value,anomaly,sen_trend,units"];
  for (const rr of regions(a)) {
    const g = rr.stats.grid;
    const sets: [string, RegionResult["series"], typeof g][] = [[a.variableId, rr.series, g]];
    if (rr.pair) sets.push([rr.pair.id, rr.pair.series, rr.pair.stats.grid]);
    for (const [id, s, gg] of sets) {
      s.years.forEach((y, i) => {
        const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
        lines.push([rr.slot, id, y, s.months[i], v(s.values[i]), v(gg.anom[i]), v(gg.fit[i]), `"${s.units}"`].join(","));
      });
    }
  }
  download(`${slug(a)}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}

export function exportJson(a: Analysis): void {
  const strip = (rr: RegionResult) => ({
    slot: rr.slot,
    region: rr.region,
    source: rr.series.sourceLabel,
    units: rr.series.units,
    urls: rr.series.urls,
    stats: { ...rr.stats, grid: undefined },
    pair: rr.pair ? { id: rr.pair.id, units: rr.pair.series.units, stats: { ...rr.pair.stats, grid: undefined }, couple: { all: rr.pair.couple.all, before: rr.pair.couple.before, after: rr.pair.couple.after } } : undefined,
  });
  const out = {
    tool: "Astra Sleuth",
    engine: a.engineVersion,
    createdAt: a.createdAt,
    params: { variable: a.variableId, pair: a.pairId, season: a.season, y0: a.y0, y1: a.y1, mode: a.mode, chlSensor: a.chlSensor, aodSource: a.aodSource },
    regions: regions(a).map(strip),
    dipole: a.dipole ? { all: a.dipole.all } : undefined,
  };
  download(`${slug(a)}.json`, JSON.stringify(out, null, 2), "application/json");
}

export function exportDossier(a: Analysis, hr: boolean, canvases: HTMLCanvasElement[], svgs: { id: string; el: Element }[]): void {
  const v = getVar(a.variableId);
  const rs = regions(a);
  const imgs = canvases.map((c) => {
    try {
      return c.toDataURL("image/png");
    } catch {
      return "";
    }
  });
  const svg = (id: string) => {
    const f = svgs.find((x) => x.id === id);
    if (!f) return "";
    const node = f.el.cloneNode(true) as Element;
    return node.outerHTML;
  };

  const verdicts = rs
    .map((rr) => {
      const vd = verdict(rr.stats, hr, a.variableId, rr.series.units, placeName(rr), a.season, rr.region);
      const mk = rr.stats.mk;
      const u = prettyUnits(rr.series.units);
      const pt = rr.stats.pettitt;
      return `<section>
        <h2>${a.mode === "dipole" ? `${L("Región", "Region")} ${rr.slot}: ` : ""}${esc(placeName(rr))}</h2>
        <p class="meta">${rr.region.kind === "point" ? L("Punto", "Point") : L("Área", "Area")} · ${esc(describeRegion(rr.region))} · ${surfaceLabel(rr.region.surface)}</p>
        <p class="headline">${esc(vd.headline)}</p>
        <ol>${vd.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
        ${(() => {
          const g = coverageNote(rr.series, a.y0, a.y1);
          return g ? `<p class="small"><strong>${L("Nota de cobertura", "Coverage note")}:</strong> ${esc(g)}</p>` : "";
        })()}
        <table>
          <tr><th>${L("Pendiente de Sen", "Sen slope")}</th><td>${fmtSigned(mk.slopeDecade, 4)}${u ? " " + esc(u) : ""} ${L("por década", "per decade")}</td></tr>
          <tr><th>${L("IC 95 %", "95% CI")} ${hr ? L("(corregido)", "(corrected)") : ""}</th><td>[${fmtSigned((hr ? mk.ciHrDecade : mk.ciDecade)[0], 3)}, ${fmtSigned((hr ? mk.ciHrDecade : mk.ciDecade)[1], 3)}]</td></tr>
          <tr><th>Mann-Kendall</th><td>n = ${mk.n}, S = ${mk.s}, Z = ${fmt(mk.z, 4)}, p = ${fmtPSci(mk.p)}, τ = ${fmt(mk.tau, 3)}</td></tr>
          <tr><th>${L("Hamed y Rao", "Hamed and Rao")}</th><td>factor = ${fmt(mk.acfFactor, 3)}, Z* = ${fmt(mk.zHr, 4)}, p* = ${fmtPSci(mk.pHr)}</td></tr>
          ${rr.stats.seasonal ? `<tr><th>Seasonal MK</th><td>S = ${rr.stats.seasonal.s}, Z = ${fmt(rr.stats.seasonal.z, 4)}, p = ${fmtPSci(rr.stats.seasonal.p)}, Sen = ${fmtSigned(rr.stats.seasonal.slopeDecade, 4)}/${L("década", "decade")}</td></tr>` : ""}
          ${pt ? `<tr><th>Pettitt</th><td>${ym(pt.year, pt.month)}, p = ${fmtPSci(pt.p)}, ${L("media", "mean")} ${fmt(pt.meanBefore, 3)} → ${fmt(pt.meanAfter, 3)}</td></tr>` : ""}
          <tr><th>${L("Años necesarios (Weatherhead)", "Years needed (Weatherhead)")}</th><td>${rr.stats.horizon.yearsNeeded === null ? "—" : fmt(rr.stats.horizon.yearsNeeded, 3)} (${L("disponibles", "available")} ${fmt(rr.stats.horizon.yearsAvailable, 3)})</td></tr>
          <tr><th>${L("Completitud", "Completeness")}</th><td>${Math.round(rr.stats.completeness * 100)} % (${rr.stats.nValid}/${rr.stats.nMonths} ${L("meses", "months")})</td></tr>
          <tr><th>${L("Fuente", "Source")}</th><td>${esc(rr.series.sourceLabel)}</td></tr>
          ${rr.pair?.couple.all ? `<tr><th>${L("Acoplamiento con", "Coupling with")} ${esc(short(rr.pair.id))}</th><td>ρ = ${fmtSigned(rr.pair.couple.all.rho, 3)}, p = ${fmtPSci(rr.pair.couple.all.p)}${rr.pair.couple.before && rr.pair.couple.after ? `; ${L("antes", "before")} ρ = ${fmtSigned(rr.pair.couple.before.rho, 3)}, ${L("después", "after")} ρ = ${fmtSigned(rr.pair.couple.after.rho, 3)}` : ""}</td></tr>` : ""}
        </table>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Astra Sleuth · ${esc(varName(v))}</title>
<style>
  body{margin:0;background:#F4F3EF;color:#1D1D1B;font:15px/1.55 "IBM Plex Sans",system-ui,sans-serif}
  main{max-width:860px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 4px;border-top:1px solid #1D1D1B;padding-top:12px}
  .meta,.small{color:#5C5A53;font-size:13px} .headline{font-weight:600;font-size:17px}
  table{border-collapse:collapse;width:100%;font:13px/1.4 "IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
  th,td{border:1px solid #C9C5BA;padding:5px 8px;text-align:left;vertical-align:top} th{width:34%;background:#ECEAE3;font-weight:500}
  img,svg{max-width:100%;height:auto;border:1px solid #C9C5BA;background:#FBFAF7}
  code,.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;word-break:break-all}
</style></head><body><main>
<p class="small">ASTRA SLEUTH · DOSSIER</p>
<h1>${esc(varName(v))}: ${a.y0}–${a.y1}, ${esc(seasonText(a.season, a.A.region))}</h1>
<p class="meta">${L("Generado", "Generated")} ${new Date(a.createdAt).toLocaleString(locale())} · ${esc(sourceLabel(v, a))} · ${L("Corrección de autocorrelación", "Autocorrelation correction")}: ${hr ? L("activada", "on") : L("desactivada", "off")}</p>
${verdicts}
<h2>${L("Serie temporal (anomalías)", "Time series (anomalies)")}</h2>
${imgs.filter(Boolean).map((src, i) => `<p class="small">${a.mode === "dipole" ? `${L("Región", "Region")} ${i === 0 ? "A" : "B"}` : ""}</p><img alt="${L("Serie temporal", "Time series")}" src="${src}">`).join("")}
<h2>Significance Horizon</h2>
${svg("fig-horizon")}
${a.dipole?.all ? `<h2>${L("Dipolo A frente a B", "Dipole A versus B")}</h2><p>Spearman ρ = ${fmtSigned(a.dipole.all.rho, 3)}, p = ${fmtPSci(a.dipole.all.p)}, n = ${a.dipole.all.n}.</p>${svg("fig-dipole")}` : ""}
${rs.filter((r) => r.pair).map((r) => `<h2>${L("Acoplamiento", "Coupling")} ${a.mode === "dipole" ? r.slot : ""}: ${esc(short(a.variableId))} ${L("frente a", "versus")} ${esc(short(r.pair!.id))}</h2>${svg(`fig-pair-${r.slot}`)}`).join("")}
<h2>${L("Método", "Methods")}</h2>
<p class="small">${L(
  "Anomalías respecto a la climatología mensual del periodo; Mann-Kendall bilateral (α = 0,05) con corrección de Hamed y Rao (1998); pendiente de Sen (1968) con IC de Gilbert (1987); Seasonal Mann-Kendall (Hirsch et al., 1982); Pettitt (1979); años necesarios según Weatherhead et al. (1998).",
  "Anomalies relative to the period's monthly climatology; two-sided Mann-Kendall (α = 0.05) with Hamed and Rao (1998) correction; Sen (1968) slope with Gilbert (1987) CI; Seasonal Mann-Kendall (Hirsch et al., 1982); Pettitt (1979); years needed per Weatherhead et al. (1998).",
)} ${L("Motor", "Engine")} ${esc(a.engineVersion)} (Rust → WebAssembly).</p>
<h2>${L("Consultas de datos", "Data queries")}</h2>
<ul>${rs.flatMap((r) => [...r.series.urls, ...(r.pair?.series.urls ?? [])]).map((u) => `<li class="mono">${esc(u)}</li>`).join("")}</ul>
</main></body></html>`;
  download(`${slug(a)}.html`, html, "text/html;charset=utf-8");
}
