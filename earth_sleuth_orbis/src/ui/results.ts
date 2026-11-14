// Resultados: respuesta en 3 líneas, paso 4 (serie temporal) y paso 5 (significancia).
import { SHORT, getVar, seasonText } from "../catalog";
import { firstLast, monthKey } from "../data/series";
import type { AnalyzeOut } from "../engine/types";
import { describeRegion } from "../geo";
import type { Analysis, RegionResult, State } from "../state";
import { corrSentence, lowerName, esc, fmt, fmtP, fmtPSci, pEq, fmtSigned, prettyUnits, verdict, ym } from "../text";
import { timeSeriesChart, type ChartHandle } from "./charts";
import { COLORS } from "./map";

let charts: ChartHandle[] = [];
let figures: { id: string; el: Element }[] = [];

export function currentFigures() {
  return {
    canvases: charts.map((c) => c.canvas()).filter((c): c is HTMLCanvasElement => !!c),
    svgs: figures,
  };
}

export function placeName(rr: RegionResult): string {
  return rr.region.name ?? (rr.region.kind === "point" ? `el punto ${describeRegion(rr.region)}` : `el área ${describeRegion(rr.region)}`);
}

function emptyHtml(): string {
  return `
  <section class="empty">
    <span class="eyebrow">Cómo funciona</span>
    <h2>Detecta si un cambio en el planeta es real o solo ruido natural</h2>
    <ol class="how-list">
      <li><strong>Variable.</strong> Elige qué medir: temperatura, lluvia, aerosoles, temperatura del mar…</li>
      <li><strong>Región.</strong> Toca el globo para elegir un punto o dibuja un área. Puedes comparar dos regiones.</li>
      <li><strong>Periodo y estación.</strong> Usa muchos años (ideal 20 o más) y, si quieres, una sola estación.</li>
      <li><strong>Serie temporal.</strong> Verás los datos mensuales y sus anomalías: la diferencia con lo normal de cada mes.</li>
      <li><strong>Significancia.</strong> El motor en Rust prueba si la tendencia es estadísticamente real (p &lt; 0,05).</li>
    </ol>
    <p class="muted small">¿Primera vez? Prueba un <strong>caso de ejemplo</strong> en el panel izquierdo.</p>
  </section>`;
}

function seg(value: string, items: { v: string; label: string }[], action: string): string {
  return `<div class="seg seg-sm" role="radiogroup">${items
    .map((it) => `<button type="button" role="radio" aria-checked="${it.v === value}" class="seg-btn${it.v === value ? " is-on" : ""}" data-action="${action}" data-v="${it.v}" data-k="${action}-${it.v}">${esc(it.label)}</button>`)
    .join("")}</div>`;
}

function qualityMarks(a: Analysis, varId: string): { key: number; label: string }[] {
  const v = getVar(varId);
  return v.quality_notes
    .filter((q) => !q.sensors || (varId === "CHLOR_A" && q.sensors.includes(a.chlSensor)))
    .filter(() => !(varId === "AOD" && a.aodSource === "power")) // nota de Aqua no aplica a MERRA-2
    .map((q) => {
      const [y, m] = q.after.split("-").map(Number);
      return { key: monthKey(y, m), label: q.severity === "critical" ? "Calidad del sensor degradada" : "Aviso de calidad del sensor" };
    });
}

function summaryHtml(a: Analysis, s: State): string {
  const list = [a.A, a.B].filter((x): x is RegionResult => !!x);
  const cards = list
    .map((rr) => {
      const v = verdict(rr.stats, s.hr, a.variableId, rr.series.units, placeName(rr), a.season, rr.region.lat, rr.region.lon);
      return `<article class="verdict ${v.significant ? "v-sig" : "v-ns"}" style="--c:${COLORS[rr.slot]}">
        <header>${a.mode === "dipole" ? `<span class="slot-badge">${rr.slot}</span>` : ""}<span class="verdict-tag">${v.significant ? "Significativa" : "No significativa aún"}</span></header>
        <h3>${esc(v.headline)}</h3>
        <ol class="three">${v.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
      </article>`;
    })
    .join("");
  let dip = "";
  if (a.dipole?.all && a.B) {
    const name = lowerName(SHORT[a.variableId] ?? "");
    dip = `<p class="dipole-line"><span class="eyebrow">Dipolo A frente a B</span> ${esc(
      corrSentence(a.dipole.all.rho, a.dipole.all.p, `${name} en A`, `${name} en B`),
    )}</p>`;
  }
  return `
  <section class="summary" aria-labelledby="sum-h">
    <div class="summary-head">
      <div><span class="eyebrow">Respuesta</span><h2 id="sum-h">${esc(getVar(a.variableId).name_es)} · ${list[0].series.years[0]}–${list[0].series.years.at(-1)}</h2></div>
      <div class="actions">
        <button type="button" class="btn" data-action="dossier" data-k="dossier">Exportar dossier</button>
        <button type="button" class="btn btn-ghost" data-action="csv-out" data-k="csv-out">Datos CSV</button>
        <button type="button" class="btn btn-ghost" data-action="json-out" data-k="json-out">JSON del motor</button>
      </div>
    </div>
    <div class="verdicts ${list.length > 1 ? "two" : ""}">${cards}</div>
    ${dip}
  </section>`;
}

function chartBlock(a: Analysis, rr: RegionResult): string {
  const fl = firstLast(rr.series);
  const st = rr.stats;
  const notes = [...rr.series.notes];
  return `<div class="chart-block" style="--c:${COLORS[rr.slot]}">
    <div class="chart-title">
      ${a.mode === "dipole" ? `<span class="slot-badge">${rr.slot}</span>` : ""}
      <span><strong>${esc(SHORT[a.variableId])}</strong> · ${esc(placeName(rr))}</span>
    </div>
    <div class="chart" id="chart-${rr.slot}"></div>
    <p class="quality mono small">
      <span title="Porcentaje de meses con dato válido">Completitud ${Math.round(st.completeness * 100)} %</span>
      <span>${st.nValid} de ${st.nMonths} meses</span>
      ${fl ? `<span>${fl.first} a ${fl.last}</span>` : ""}
      <span>${esc(rr.series.sourceLabel)}</span>
    </p>
    ${notes.length ? `<p class="small muted">${notes.map(esc).join(" ")}</p>` : ""}
  </div>`;
}

function step4Html(a: Analysis, s: State): string {
  const list = [a.A, a.B].filter((x): x is RegionResult => !!x);
  const seasonal = a.A.stats.pointsPerYear === 1;
  return `
  <section class="out" aria-labelledby="o4">
    <header class="out-head">
      <span class="step-num" aria-hidden="true">4</span>
      <h2 id="o4">Serie temporal</h2>
      ${seg(s.view, [{ v: "anom", label: "Anomalías" }, { v: "raw", label: "Valores crudos" }], "view")}
    </header>
    <p class="explain">${
      s.view === "anom"
        ? `Una <strong>anomalía</strong> es la diferencia entre el valor de un mes y lo normal para ese mes. Así el cambio natural entre verano e invierno no se confunde con una tendencia.`
        : `Estos son los promedios mensuales tal como los entrega la fuente. El ciclo de subidas y bajadas de cada año es la estación, no una tendencia.`
    }</p>
    <div class="charts">${list.map((rr) => chartBlock(a, rr)).join("")}</div>
    ${
      s.view === "anom"
        ? `<ul class="key small">
      <li><span class="sw sw-thin"></span>Cada mes</li>
      <li><span class="sw sw-main"></span>${seasonal ? "Media de la estación elegida (un punto por año)" : "Promedio de 12 meses"}${list.length > 1 ? " (en el color de cada región)" : ""}</li>
      <li><span class="sw sw-dash"></span>Tendencia de Sen</li>
      <li><span class="sw sw-band"></span>Rango probable de la tendencia (95 %)</li>
      <li><span class="sw sw-vline"></span>Quiebre brusco (Pettitt)</li>
    </ul>`
        : ""
    }
  </section>`;
}

function factsStudent(st: AnalyzeOut, hr: boolean, u: string): string {
  const mk = st.mk;
  const ci = hr ? mk.ciHrDecade : mk.ciDecade;
  const p = hr ? mk.pHr : mk.p;
  const sig = hr ? mk.significantHr : mk.significant;
  const need = st.horizon.yearsNeeded;
  return `<dl class="facts">
    <div><dt>Cambio por década</dt><dd><strong>${fmtSigned(mk.slopeDecade)}${u ? " " + esc(u) : ""}</strong><span class="muted"> (entre ${fmtSigned(ci[0])} y ${fmtSigned(ci[1])})</span></dd></div>
    <div><dt>p-valor</dt><dd><strong>${fmtP(p)}</strong> <span class="muted">${sig ? "menor que 0,05: significativa" : "0,05 o más: no significativa"}</span></dd></div>
    <div><dt>Años analizados</dt><dd><strong>${fmt(st.spanYears, 3)}</strong> <span class="muted">${st.pointsPerYear === 1 ? "(un valor por año)" : "(datos mensuales)"}</span></dd></div>
    <div><dt>Años necesarios para detectarla</dt><dd><strong>${need === null ? "—" : `≈ ${Math.ceil(need)}`}</strong> <span class="muted">${
      sig ? "ya es significativa" : need === null ? "sin tendencia que detectar" : `faltan ≈ ${Math.ceil(st.horizon.yearsRemaining ?? 0)}`
    }</span></dd></div>
  </dl>`;
}

function factsScientist(st: AnalyzeOut, u: string): string {
  const mk = st.mk;
  const se = st.seasonal;
  const pt = st.pettitt;
  const h = st.horizon;
  const uu = u ? ` ${esc(u)}` : "";
  const row = (k: string, v: string) => `<tr><th scope="row">${k}</th><td class="mono">${v}</td></tr>`;
  return `<table class="tech">
    <tbody>
      <tr class="sub"><th colspan="2">Mann-Kendall sobre ${st.pointsPerYear === 1 ? "medias estacionales" : "anomalías mensuales"}</th></tr>
      ${row("n · S · Var(S)", `${mk.n} · ${mk.s} · ${fmt(mk.varS, 6)}`)}
      ${row("Z · p", `${fmt(mk.z, 4)} · ${fmtPSci(mk.p)}`)}
      ${row("τ de Kendall", fmt(mk.tau, 3))}
      ${row("Sen (IC 95 %)", `${fmtSigned(mk.slopeDecade, 4)}${uu}/década [${fmtSigned(mk.ciDecade[0], 3)}, ${fmtSigned(mk.ciDecade[1], 3)}]`)}
      <tr class="sub"><th colspan="2">Corrección Hamed y Rao (1998)</th></tr>
      ${row("Factor Var*(S)/Var(S)", fmt(mk.acfFactor, 3))}
      ${row("Z* · p*", `${fmt(mk.zHr, 4)} · ${fmtPSci(mk.pHr)}`)}
      ${row("Sen IC 95 % corregido", `[${fmtSigned(mk.ciHrDecade[0], 3)}, ${fmtSigned(mk.ciHrDecade[1], 3)}]${uu}/década`)}
      ${
        se
          ? `<tr class="sub"><th colspan="2">Seasonal Mann-Kendall (Hirsch et al., 1982), valores crudos</th></tr>
      ${row("n · S · Z", `${se.n} · ${se.s} · ${fmt(se.z, 4)}`)}
      ${row("p", fmtPSci(se.p))}
      ${row("Sen estacional (IC 95 %)", `${fmtSigned(se.slopeDecade, 4)}${uu}/década [${fmtSigned(se.ciDecade[0], 3)}, ${fmtSigned(se.ciDecade[1], 3)}]`)}
      ${row("S por mes (E…D)", se.monthS.map((x) => (x === 0 ? "·" : x > 0 ? "+" : "−")).join(" "))}`
          : ""
      }
      ${
        pt
          ? `<tr class="sub"><th colspan="2">Pettitt (1979)</th></tr>
      ${row("Quiebre · p", `${ym(pt.year, pt.month)} · ${fmtPSci(pt.p)}`)}
      ${row("Media antes → después", `${fmt(pt.meanBefore, 3)} → ${fmt(pt.meanAfter, 3)}${uu}`)}`
          : ""
      }
      <tr class="sub"><th colspan="2">Detectabilidad (Weatherhead et al., 1998)</th></tr>
      ${row("σ ruido · φ lag-1", `${fmt(h.noiseSd, 3)}${uu} · ${fmt(h.phi, 3)}`)}
      ${row("n* años · disponibles", `${h.yearsNeeded === null ? "—" : fmt(h.yearsNeeded, 3)} · ${fmt(h.yearsAvailable, 3)}`)}
    </tbody>
  </table>`;
}

function horizonCaption(st: AnalyzeOut, hr: boolean): string {
  const ws = st.horizon.windows;
  let from: number | null = null;
  for (let i = ws.length - 1; i >= 0; i--) {
    const p = hr ? ws[i].pHr : ws[i].p;
    if (p < 0.05) from = ws[i].years;
    else break;
  }
  if (from !== null) return `Con los últimos <strong>${fmt(from)} años</strong> o más, la tendencia ya es significativa.`;
  // El registro completo no es significativo. Antes se decía "ninguna ventana alcanza
  // p < 0,05" aunque algunas ventanas recientes sí lo hicieran.
  const sigWins = ws.filter((w) => (hr ? w.pHr : w.p) < 0.05).map((w) => w.years);
  const rem = st.horizon.yearsRemaining;
  const more = rem !== null && rem > 0 ? ` Al ritmo actual harían falta <strong>≈ ${Math.ceil(rem)} años más</strong> de datos.` : "";
  if (sigWins.length)
    return `Solo algunas ventanas recientes (${sigWins.length === 1 ? `los últimos ${fmt(sigWins[0])} años` : `entre ${fmt(Math.min(...sigWins))} y ${fmt(Math.max(...sigWins))} años`}) bajan de 0,05, pero el registro completo no: puede ser un cambio reciente o una fluctuación.${more}`;
  if (more) return `Ninguna ventana alcanza p &lt; 0,05.${more}`;
  return "La curva no baja de 0,05: con estos datos no hay una tendencia detectable.";
}

function step5Html(a: Analysis, s: State): string {
  const list = [a.A, a.B].filter((x): x is RegionResult => !!x);
  const sci = s.level === "scientist";
  const blocks = list
    .map((rr) => {
      const u = prettyUnits(rr.series.units);
      const mk = rr.stats.mk;
      return `<div class="sig-block" style="--c:${COLORS[rr.slot]}">
        ${a.mode === "dipole" ? `<div class="chart-title"><span class="slot-badge">${rr.slot}</span><span>${esc(placeName(rr))}</span></div>` : ""}
        ${factsStudent(rr.stats, s.hr, u)}
        <p class="small muted">Sin corregir: ${pEq(mk.p)} · Corregido por autocorrelación: ${pEq(mk.pHr)}${
          mk.acfFactor > 1.05 ? ` (la incertidumbre se multiplicó por ${fmt(Math.sqrt(mk.acfFactor), 2)})` : ""
        }.</p>
        ${sci ? factsScientist(rr.stats, u) : ""}
      </div>`;
    })
    .join("");

  const caption = list.map((rr) => `${a.mode === "dipole" ? `<strong>${rr.slot}:</strong> ` : ""}${horizonCaption(rr.stats, s.hr)}`).join(" ");

  let dipole = "";
  if (a.dipole?.all && a.B) {
    const name = lowerName(SHORT[a.variableId] ?? "");
    dipole = `<div class="fig">
      <h3>Dipolo: ¿se mueven juntas A y B?</h3>
      <p class="small">Correlación de Spearman entre las anomalías mensuales de ambas regiones (${a.dipole.all.n} meses en común). ${esc(
        corrSentence(a.dipole.all.rho, a.dipole.all.p, `${name} en A`, `${name} en B`),
      )}</p>
      <div class="plot" id="fig-dipole"></div>
    </div>`;
  }

  const decoup = list
    .filter((rr) => rr.pair)
    .map((rr) => {
      const c = rr.pair!.couple;
      const pairName = SHORT[rr.pair!.id];
      const mainName = SHORT[a.variableId];
      const parts: string[] = [];
      if (c.all) parts.push(`Todo el registro: ρ = ${fmtSigned(c.all.rho, 2)} (${pEq(c.all.p)}, n = ${c.all.n}).`);
      if (c.before && c.after) {
        const d = Math.abs(c.after.rho) - Math.abs(c.before.rho);
        const change =
          Math.abs(d) < 0.15
            ? "La relación se mantiene parecida en ambos periodos: siguen acopladas."
            : d < 0
              ? "La relación se debilitó en el segundo periodo: las variables se están desacoplando."
              : "La relación se hizo más fuerte en el segundo periodo.";
        parts.push(`Antes: ρ = ${fmtSigned(c.before.rho, 2)}; después: ρ = ${fmtSigned(c.after.rho, 2)}. ${change}`);
      }
      return `<div class="fig">
        <h3>${a.mode === "dipole" ? `<span class="slot-badge" style="--c:${COLORS[rr.slot]}">${rr.slot}</span> ` : ""}Acoplamiento: ${esc(mainName)} frente a ${esc(pairName)}</h3>
        <p class="small">Cada punto es un mes (anomalías). ${esc(regimeText(rr))} ${esc(parts.join(" "))}</p>
        <div class="plot" id="fig-pair-${rr.slot}"></div>
      </div>`;
    })
    .join("");

  return `
  <section class="out" aria-labelledby="o5">
    <header class="out-head">
      <span class="step-num" aria-hidden="true">5</span>
      <h2 id="o5">Significancia estadística</h2>
      <label class="switch" data-k="hr-label">
        <input type="checkbox" data-action="hr" data-k="hr" ${s.hr ? "checked" : ""}>
        <span>Corregir autocorrelación <span class="muted">(Hamed y Rao, 1998)</span></span>
      </label>
    </header>
    <p class="explain">La prueba de <strong>Mann-Kendall</strong> cuenta cuántas veces un dato es mayor que los anteriores. Si sube (o baja) mucho más de lo que daría el azar, el <strong>p-valor</strong> es pequeño. Con p &lt; 0,05 decimos que la tendencia es significativa. Como un mes se parece al siguiente, la corrección de autocorrelación evita declarar tendencias que no existen.</p>
    <div class="sig ${list.length > 1 ? "two" : ""}">${blocks}</div>
    <div class="fig">
      <h3>Significance Horizon: ¿desde cuántos años se ve la tendencia?</h3>
      <p class="small">Se repite la prueba usando solo los últimos 5, 6, 7… años. Cuando la curva baja de la línea punteada, la tendencia es significativa. ${caption}</p>
      <div class="plot" id="fig-horizon"></div>
    </div>
    ${dipole}
    ${decoup}
  </section>`;
}

function regimeText(rr: RegionResult): string {
  const pt = rr.stats.pettitt;
  if (pt && pt.significant) return `Gris: antes del quiebre de ${ym(pt.year, pt.month)}; color: después.`;
  return "Gris: primera mitad del registro; color: segunda mitad.";
}

function glossaryHtml(): string {
  const items: [string, string][] = [
    ["Anomalía", "Diferencia entre el valor de un mes y el promedio histórico de ese mismo mes. Elimina el ciclo de las estaciones."],
    ["Tendencia de Sen", "Mediana de todas las pendientes entre pares de datos. Es robusta: un valor extremo no la mueve. Se expresa en unidades por década."],
    ["Mann-Kendall", "Prueba que no supone una forma de los datos. Compara cada dato con todos los anteriores para ver si predominan las subidas o las bajadas."],
    ["p-valor", "Probabilidad de ver una tendencia así de fuerte si en realidad no hubiera ninguna. Menor que 0,05 significa menos de 1 en 20: decimos que es significativa."],
    ["Autocorrelación", "Un mes cálido suele seguir a otro mes cálido. Eso hace que los datos parezcan más numerosos de lo que son. Hamed y Rao (1998) corrigen ese efecto."],
    ["Quiebre (Pettitt)", "Momento en que el nivel medio de la serie cambia de golpe, por ejemplo por un cambio de régimen climático o de instrumento."],
    ["Significance Horizon", "Curva del p-valor según cuántos años recientes se usan. Muestra desde cuándo una tendencia es detectable."],
    ["Dipolo y Spearman", "Comparar dos regiones lejanas. La correlación de Spearman (ρ, de −1 a 1) indica si sus anomalías suben y bajan juntas (ρ > 0) o en direcciones opuestas (ρ < 0)."],
    ["Completitud", "Porcentaje de meses con dato válido. Los valores de relleno de NASA (−999) se descartan antes de calcular."],
  ];
  return `<details class="glossary"><summary>Glosario: palabras clave explicadas</summary><dl>${items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl></details>`;
}

export function renderResults(root: HTMLElement, s: State): void {
  for (const c of charts) c.destroy();
  charts = [];
  figures = [];

  if (s.run.status === "idle") {
    root.innerHTML = emptyHtml() + glossaryHtml();
    return;
  }
  if (s.run.status === "loading") {
    root.innerHTML = `<section class="loading" aria-live="polite"><div class="bar"><span></span></div><p class="mono">${esc(s.run.msg)}</p></section>`;
    return;
  }
  if (s.run.status === "error") {
    root.innerHTML = `<section class="error" role="alert"><span class="eyebrow">No se pudo completar el análisis</span><p>${esc(s.run.msg)}</p>
      <button type="button" class="btn" data-action="run">Reintentar</button></section>${glossaryHtml()}`;
    return;
  }

  const a = s.run.analysis;
  root.innerHTML = summaryHtml(a, s) + step4Html(a, s) + step5Html(a, s) + glossaryHtml() + methodsHtml(a);

  const list = [a.A, a.B].filter((x): x is RegionResult => !!x);
  for (const rr of list) {
    const el = root.querySelector<HTMLElement>(`#chart-${rr.slot}`)!;
    charts.push(
      timeSeriesChart(el, {
        stats: rr.stats,
        years: rr.series.years,
        months: rr.series.months,
        view: s.view,
        hr: s.hr,
        color: COLORS[rr.slot],
        units: rr.series.units,
        quality: qualityMarks(a, a.variableId),
        syncKey: list.length > 1 ? "dipolo" : undefined,
        label: `Serie temporal de ${SHORT[a.variableId]} en ${placeName(rr)}`,
      }),
    );
  }
  void drawFigures(root, a, s);
}

let drawToken = 0;

/** Las figuras de Observable Plot se cargan bajo demanda (no pesan en la carga inicial). */
async function drawFigures(root: HTMLElement, a: Analysis, s: State): Promise<void> {
  const token = ++drawToken;
  const { horizonPlot, scatterPlot } = await import("./plots");
  if (token !== drawToken) return;
  const list = [a.A, a.B].filter((x): x is RegionResult => !!x);
  const put = (id: string, make: (w: number) => Element) => {
    const host = root.querySelector<HTMLElement>(`#${id}`);
    if (!host) return;
    const el = make(Math.max(300, host.clientWidth));
    host.replaceChildren(el);
    figures.push({ id, el });
  };
  put("fig-horizon", (w) =>
    horizonPlot(
      list.map((rr) => ({ label: rr.slot, color: COLORS[rr.slot], windows: rr.stats.horizon.windows })),
      s.hr,
      w,
    ),
  );
  const name = SHORT[a.variableId];
  if (a.dipole?.all && a.B) {
    put("fig-dipole", (w) =>
      scatterPlot(
        {
          x: a.dipole!.x,
          y: a.dipole!.y,
          keys: a.dipole!.keys,
          splitKey: null,
          splitLabel: ["Meses en común", ""],
          color: "#4A4A44",
          xLabel: `Anomalía en A${unitsSuffix(a.A)}`,
          yLabel: `Anomalía en B${unitsSuffix(a.B!)}`,
        },
        w,
      ),
    );
  }
  for (const rr of list) {
    if (!rr.pair) continue;
    const c = rr.pair.couple;
    const split = splitFor(rr);
    put(`fig-pair-${rr.slot}`, (w) =>
      scatterPlot(
        {
          x: c.x,
          y: c.y,
          keys: c.keys,
          splitKey: split.key,
          splitLabel: split.labels,
          color: COLORS[rr.slot],
          xLabel: `${name}, anomalía${unitsSuffix(rr)}`,
          yLabel: `${SHORT[rr.pair!.id]}, anomalía${rr.pair!.series.units ? ` (${prettyUnits(rr.pair!.series.units)})` : ""}`,
        },
        w,
      ),
    );
  }
}

function unitsSuffix(rr: RegionResult): string {
  const u = prettyUnits(rr.series.units);
  return u ? ` (${u})` : "";
}

/** Punto de corte de regímenes: quiebre de Pettitt significativo o mitad del registro. */
export function splitFor(rr: RegionResult): { key: number; labels: [string, string] } {
  const pt = rr.stats.pettitt;
  if (pt && pt.significant) return { key: pt.key, labels: [`Antes de ${ym(pt.year, pt.month)}`, `Desde ${ym(pt.year, pt.month)}`] };
  const n = rr.series.years.length;
  const mid = Math.floor(n / 2);
  const key = monthKey(rr.series.years[mid], rr.series.months[mid]);
  return { key, labels: [`Hasta ${rr.series.years[mid - 1] ?? ""}`, `Desde ${rr.series.years[mid]}`] };
}

function methodsHtml(a: Analysis): string {
  return `<details class="glossary"><summary>Método y fuentes (para científicos)</summary>
    <div class="methods small">
      <p>Valores centinela (≤ −999) eliminados. Anomalías respecto a la climatología mensual del periodo analizado. ${
        a.season === "ALL"
          ? "Mann-Kendall sobre anomalías mensuales; Seasonal Mann-Kendall (12 meses) sobre valores crudos."
          : `Estación ${a.season} (${esc(seasonText(a.season, a.A.region.lat, a.A.region.lon))}): media por año estacional de las anomalías (mínimo 2 de 3 meses; diciembre cuenta para el invierno siguiente) y Seasonal Mann-Kendall sobre los meses de la estación.`
      } Sen (1968) con IC de Gilbert (1987). Corrección de varianza de Hamed y Rao (1998) con autocorrelaciones significativas de los rangos sin tendencia. Pettitt (1979). Años necesarios según Weatherhead et al. (1998), generalizado a k puntos por año. Spearman con p de la t de Student (n − 2 g.l.). α = 0,05, bilateral.</p>
      <p>Motor: <span class="mono">${esc(a.engineVersion)}</span> (Rust → WebAssembly con wasm-bindgen, ejecutado en un Web Worker).</p>
      <p>Consultas:</p>
      <ul class="mono urls">${[a.A, a.B]
        .filter((x): x is RegionResult => !!x)
        .flatMap((rr) => [...rr.series.urls, ...(rr.pair?.series.urls ?? [])])
        .map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`)
        .join("")}</ul>
    </div>
  </details>`;
}

/** Redibuja solo las figuras SVG (al cambiar el ancho de la ventana). */
export function redrawFigures(root: HTMLElement, s: State): void {
  if (s.run.status !== "done") return;
  figures = [];
  void drawFigures(root, s.run.analysis, s);
}
