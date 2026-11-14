// Exportación: dossier HTML autocontenido (texto + figuras + números), CSV y JSON.
import { SHORT, getVar, seasonText, sourceLabel } from "../catalog";
import { describeRegion, SURFACE_LABEL } from "../geo";
import type { Analysis, RegionResult } from "../state";
import { esc, fmt, fmtPSci, fmtSigned, prettyUnits, verdict, ym } from "../text";
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
  return `earth-sleuth-orbis_${a.variableId}_${a.season}_${a.createdAt.slice(0, 10)}`;
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
    tool: "Earth Sleuth Orbis",
    engine: a.engineVersion,
    createdAt: a.createdAt,
    params: { variable: a.variableId, pair: a.pairId, season: a.season, y0: a.y0, y1: a.y1, mode: a.mode, chlSensor: a.chlSensor, aodSource: a.aodSource },
    regions: regions(a).map(strip),
    dipole: a.dipole ? { all: a.dipole.all } : undefined,
  };
  download(`${slug(a)}.json`, JSON.stringify(out, null, 2), "application/json");
}

export function exportDossier(a: Analysis, hr: boolean, canvases: HTMLCanvasElement[], svgs: { id: string; el: Element }[], view: "anom" | "raw" = "anom"): void {
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
      const vd = verdict(rr.stats, hr, a.variableId, rr.series.units, placeName(rr), a.season, rr.region.lat, rr.region.lon);
      const mk = rr.stats.mk;
      const u = prettyUnits(rr.series.units);
      const pt = rr.stats.pettitt;
      return `<section>
        <h2>${a.mode === "dipole" ? `Región ${rr.slot}: ` : ""}${esc(placeName(rr))}</h2>
        <p class="meta">${rr.region.kind === "point" ? "Punto" : "Área"} · ${esc(describeRegion(rr.region))} · ${SURFACE_LABEL[rr.region.surface]}</p>
        <p class="headline">${esc(vd.headline)}</p>
        <ol>${vd.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
        <table>
          <tr><th>Pendiente de Sen</th><td>${fmtSigned(mk.slopeDecade, 4)}${u ? " " + esc(u) : ""} por década</td></tr>
          <tr><th>IC 95 % ${hr ? "(corregido)" : ""}</th><td>[${fmtSigned((hr ? mk.ciHrDecade : mk.ciDecade)[0], 3)}, ${fmtSigned((hr ? mk.ciHrDecade : mk.ciDecade)[1], 3)}]</td></tr>
          <tr><th>Mann-Kendall</th><td>n = ${mk.n}, S = ${mk.s}, Z = ${fmt(mk.z, 4)}, p = ${fmtPSci(mk.p)}, τ = ${fmt(mk.tau, 3)}</td></tr>
          <tr><th>Hamed y Rao</th><td>factor = ${fmt(mk.acfFactor, 3)}, Z* = ${fmt(mk.zHr, 4)}, p* = ${fmtPSci(mk.pHr)}</td></tr>
          ${rr.stats.seasonal ? `<tr><th>Seasonal MK</th><td>S = ${rr.stats.seasonal.s}, Z = ${fmt(rr.stats.seasonal.z, 4)}, p = ${fmtPSci(rr.stats.seasonal.p)}, Sen = ${fmtSigned(rr.stats.seasonal.slopeDecade, 4)}/década</td></tr>` : ""}
          ${pt ? `<tr><th>Pettitt</th><td>${ym(pt.year, pt.month)}, p = ${fmtPSci(pt.p)}, media ${fmt(pt.meanBefore, 3)} → ${fmt(pt.meanAfter, 3)}</td></tr>` : ""}
          <tr><th>Años necesarios (Weatherhead)</th><td>${rr.stats.horizon.yearsNeeded === null ? "—" : fmt(rr.stats.horizon.yearsNeeded, 3)} (disponibles ${fmt(rr.stats.horizon.yearsAvailable, 3)})</td></tr>
          <tr><th>Completitud</th><td>${Math.round(rr.stats.completeness * 100)} % (${rr.stats.nValid}/${rr.stats.nMonths} meses)</td></tr>
          <tr><th>Fuente</th><td>${esc(rr.series.sourceLabel)}</td></tr>
          ${rr.pair?.couple.all ? `<tr><th>Acoplamiento con ${esc(SHORT[rr.pair.id])}</th><td>ρ = ${fmtSigned(rr.pair.couple.all.rho, 3)}, p = ${fmtPSci(rr.pair.couple.all.p)}${rr.pair.couple.before && rr.pair.couple.after ? `; antes ρ = ${fmtSigned(rr.pair.couple.before.rho, 3)}, después ρ = ${fmtSigned(rr.pair.couple.after.rho, 3)}` : ""}</td></tr>` : ""}
        </table>
      </section>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dossier · ${esc(v.name_es)}</title>
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
<p class="small">EARTH SLEUTH ORBIS · DOSSIER</p>
<h1>${esc(v.name_es)}: ${a.y0}–${a.y1}, ${esc(seasonText(a.season, a.A.region.lat, a.A.region.lon))}</h1>
<p class="meta">Generado ${new Date(a.createdAt).toLocaleString("es")} · ${esc(sourceLabel(v, a))} · Corrección de autocorrelación: ${hr ? "activada" : "desactivada"}</p>
${verdicts}
<h2>Serie temporal (${view === "anom" ? "anomalías" : "valores crudos"})</h2>
${imgs.filter(Boolean).map((src, i) => `<p class="small">${a.mode === "dipole" ? `Región ${i === 0 ? "A" : "B"}` : ""}</p><img alt="Serie temporal" src="${src}">`).join("")}
<h2>Significance Horizon</h2>
${svg("fig-horizon")}
${a.dipole?.all ? `<h2>Dipolo A frente a B</h2><p>Spearman ρ = ${fmtSigned(a.dipole.all.rho, 3)}, p = ${fmtPSci(a.dipole.all.p)}, n = ${a.dipole.all.n}.</p>${svg("fig-dipole")}` : ""}
${rs.filter((r) => r.pair).map((r) => `<h2>Acoplamiento ${a.mode === "dipole" ? r.slot : ""}: ${esc(SHORT[a.variableId])} frente a ${esc(SHORT[r.pair!.id])}</h2>${svg(`fig-pair-${r.slot}`)}`).join("")}
<h2>Método</h2>
<p class="small">Anomalías respecto a la climatología mensual del periodo; Mann-Kendall bilateral (α = 0,05) con corrección de Hamed y Rao (1998); pendiente de Sen (1968) con IC de Gilbert (1987); Seasonal Mann-Kendall (Hirsch et al., 1982); Pettitt (1979); años necesarios según Weatherhead et al. (1998). Motor ${esc(a.engineVersion)} (Rust → WebAssembly).</p>
<h2>Consultas de datos</h2>
<ul>${rs.flatMap((r) => [...r.series.urls, ...(r.pair?.series.urls ?? [])]).map((u) => `<li class="mono">${esc(u)}</li>`).join("")}</ul>
</main></body></html>`;
  download(`${slug(a)}.html`, html, "text/html;charset=utf-8");
}
