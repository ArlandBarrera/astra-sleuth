// Resultados: respuesta en 3 líneas, paso 4 (serie temporal) y paso 5 (significancia).
import { getVar, seasonText, short, varName } from "../catalog";
import { firstLast, monthKey } from "../data/series";
import type { AnalyzeOut } from "../engine/types";
import { describeRegion, regionName } from "../geo";
import { L } from "../i18n";
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
  return (
    regionName(rr.region) ??
    (rr.region.kind === "point" ? `${L("el punto", "the point")} ${describeRegion(rr.region)}` : `${L("el área", "the area")} ${describeRegion(rr.region)}`)
  );
}

function emptyHtml(s: State): string {
  if (s.level === "scientist") {
    return `
  <section class="empty">
    <span class="eyebrow">${L("Modo científico", "Scientist mode")}</span>
    <h2>${L("Detección de tendencias no paramétrica sobre series mensuales", "Non-parametric trend detection on monthly series")}</h2>
    <ul class="how-list sci-list">
      <li>${L(
        "<strong>Datos.</strong> NASA POWER (MERRA-2/CERES, API mensual) y NOAA ERDDAP griddap (CoralTemp, VIIRS, MODIS), descargados en tramos con espejos y reintentos.",
        "<strong>Data.</strong> NASA POWER (MERRA-2/CERES, monthly API) and NOAA ERDDAP griddap (CoralTemp, VIIRS, MODIS), downloaded in chunks with mirrors and retries.",
      )}</li>
      <li>${L(
        "<strong>Pre-proceso.</strong> Centinelas ≤ −999 eliminados; anomalías respecto a la climatología mensual; promedio espacial ponderado por cos(φ).",
        "<strong>Pre-processing.</strong> Sentinels ≤ −999 removed; anomalies relative to the monthly climatology; spatial mean weighted by cos(φ).",
      )}</li>
      <li>${L(
        "<strong>Tendencia.</strong> Mann-Kendall con corrección de varianza de Hamed y Rao (1998), Sen (1968) con IC de Gilbert (1987), Seasonal MK (Hirsch et al., 1982).",
        "<strong>Trend.</strong> Mann-Kendall with Hamed and Rao (1998) variance correction, Sen (1968) with Gilbert (1987) CI, Seasonal MK (Hirsch et al., 1982).",
      )}</li>
      <li>${L(
        "<strong>Cambio de régimen y detectabilidad.</strong> Pettitt (1979); años necesarios según Weatherhead et al. (1998); Spearman para dipolos y acoplamientos.",
        "<strong>Regime shift and detectability.</strong> Pettitt (1979); years needed per Weatherhead et al. (1998); Spearman for dipoles and couplings.",
      )}</li>
    </ul>
    <p class="muted small">${L("Verás los estadísticos completos (S, Var(S), Z, τ, p sin y con corrección), códigos de dataset y las URL exactas de cada consulta.", "You will see full statistics (S, Var(S), Z, τ, raw and corrected p), dataset codes and the exact URL of every query.")}</p>
  </section>`;
  }
  return `
  <section class="empty">
    <span class="eyebrow">${L("Cómo funciona", "How it works")}</span>
    <h2>${L("Detecta si un cambio en el planeta es real o solo ruido natural", "Find out whether a change on the planet is real or just natural noise")}</h2>
    <ol class="how-list">
      <li>${L("<strong>Variable.</strong> Elige qué medir: temperatura, lluvia, aerosoles, temperatura del mar…", "<strong>Variable.</strong> Choose what to measure: temperature, rain, aerosols, sea temperature…")}</li>
      <li>${L("<strong>Región.</strong> Toca el globo para elegir un punto o dibuja un área. Puedes comparar dos regiones.", "<strong>Region.</strong> Tap the globe to pick a point or draw an area. You can compare two regions.")}</li>
      <li>${L("<strong>Periodo y estación.</strong> Usa muchos años (ideal 20 o más) y, si quieres, una sola estación.", "<strong>Period and season.</strong> Use many years (ideally 20 or more) and, if you like, a single season.")}</li>
      <li>${L("<strong>Serie temporal.</strong> Verás los datos mensuales y sus anomalías: la diferencia con lo normal de cada mes.", "<strong>Time series.</strong> You will see the monthly data and its anomalies: the difference from each month's normal.")}</li>
      <li>${L("<strong>Significancia.</strong> Una prueba estadística dice si la tendencia es real (p &lt; 0,05).", "<strong>Significance.</strong> A statistical test tells whether the trend is real (p &lt; 0.05).")}</li>
    </ol>
    <p class="muted small">${L("¿Primera vez? Prueba un <strong>caso de ejemplo</strong> en el panel izquierdo.", "First time? Try an <strong>example case</strong> in the left panel.")}</p>
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
      return { key: monthKey(y, m), label: q.severity === "critical" ? L("Calidad del sensor degradada", "Degraded sensor quality") : L("Aviso de calidad del sensor", "Sensor quality warning") };
    });
}

function summaryHtml(a: Analysis, s: State): string {
  const list = [a.A, a.B].filter((x): x is RegionResult => !!x);
  const sci = s.level === "scientist";
  const cards = list
    .map((rr) => {
      const v = verdict(rr.stats, s.hr, a.variableId, rr.series.units, placeName(rr), a.season, rr.region.lat);
      const mk = rr.stats.mk;
      const u = prettyUnits(rr.series.units);
      const statLine = sci
        ? `<p class="stat-line mono small">Sen ${fmtSigned(mk.slopeDecade, 4)}${u ? " " + esc(u) : ""}/${L("déc", "dec")} [${fmtSigned(v.ci[0], 3)}, ${fmtSigned(v.ci[1], 3)}] · ${s.hr ? "Z*" : "Z"} = ${fmt(s.hr ? mk.zHr : mk.z, 4)} · ${s.hr ? "p*" : "p"} = ${fmtPSci(v.p)} · τ = ${fmt(mk.tau, 3)} · n = ${mk.n}</p>`
        : "";
      return `<article class="verdict ${v.significant ? "v-sig" : "v-ns"}" style="--c:${COLORS[rr.slot]}">
        <header>${a.mode === "dipole" ? `<span class="slot-badge">${rr.slot}</span>` : ""}<span class="verdict-tag">${v.significant ? L("Significativa", "Significant") : L("No significativa aún", "Not significant yet")}</span></header>
        <h3>${esc(v.headline)}</h3>
        ${statLine}
        <ol class="three">${v.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>
      </article>`;
    })
    .join("");
  let dip = "";
  if (a.dipole?.all && a.B) {
    const name = lowerName(short(a.variableId));
    dip = `<p class="dipole-line"><span class="eyebrow">${L("Dipolo A frente a B", "Dipole A versus B")}</span> ${esc(
      corrSentence(a.dipole.all.rho, a.dipole.all.p, `${name} ${L("en", "in")} A`, `${name} ${L("en", "in")} B`),
    )}</p>`;
  }
  return `
  <section class="summary" aria-labelledby="sum-h">
    <div class="summary-head">
      <div><span class="eyebrow">${L("Respuesta", "Answer")}</span><h2 id="sum-h">${esc(varName(getVar(a.variableId)))} · ${list[0].series.years[0]}–${list[0].series.years.at(-1)}</h2></div>
      <div class="actions">
        <button type="button" class="btn" data-action="dossier" data-k="dossier">${L("Exportar dossier", "Export dossier")}</button>
        <button type="button" class="btn btn-ghost" data-action="csv-out" data-k="csv-out">${L("Datos CSV", "CSV data")}</button>
        ${sci ? `<button type="button" class="btn btn-ghost" data-action="json-out" data-k="json-out">${L("JSON de estadísticos", "Statistics JSON")}</button>` : ""}
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
      <span><strong>${esc(short(a.variableId))}</strong> · ${esc(placeName(rr))}</span>
    </div>
    <div class="chart" id="chart-${rr.slot}"></div>
    <p class="quality mono small">
      <span title="${L("Porcentaje de meses con dato válido", "Share of months with valid data")}">${L("Completitud", "Completeness")} ${Math.round(st.completeness * 100)} %</span>
      <span>${st.nValid} ${L("de", "of")} ${st.nMonths} ${L("meses", "months")}</span>
      ${fl ? `<span>${fl.first} ${L("a", "to")} ${fl.last}</span>` : ""}
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
      <h2 id="o4">${L("Serie temporal", "Time series")}</h2>
      ${seg(s.view, [{ v: "anom", label: L("Anomalías", "Anomalies") }, { v: "raw", label: L("Valores crudos", "Raw values") }], "view")}
    </header>
    ${
      s.level === "student"
        ? `<p class="explain">${
            s.view === "anom"
              ? L(
                  "Una <strong>anomalía</strong> es la diferencia entre el valor de un mes y lo normal para ese mes. Así el cambio natural entre verano e invierno no se confunde con una tendencia.",
                  "An <strong>anomaly</strong> is the difference between a month's value and what is normal for that month. That way the natural swing between summer and winter is not mistaken for a trend.",
                )
              : L(
                  "Estos son los promedios mensuales tal como los entrega la fuente. El ciclo de subidas y bajadas de cada año es la estación, no una tendencia.",
                  "These are the monthly means exactly as the source delivers them. The yearly up-and-down cycle is the season, not a trend.",
                )
          }</p>`
        : ""
    }
    <div class="charts">${list.map((rr) => chartBlock(a, rr)).join("")}</div>
    ${
      s.view === "anom"
        ? `<ul class="key small">
      <li><span class="sw sw-thin"></span>${L("Cada mes", "Each month")}</li>
      <li><span class="sw sw-main"></span>${seasonal ? L("Media de la estación elegida (un punto por año)", "Mean of the chosen season (one point per year)") : L("Promedio de 12 meses", "12-month average")}</li>
      <li><span class="sw sw-dash"></span>${L("Tendencia de Sen", "Sen trend")}</li>
      <li><span class="sw sw-band"></span>${L("Rango probable de la tendencia (95 %)", "Likely range of the trend (95%)")}</li>
      <li><span class="sw sw-vline"></span>${L("Quiebre brusco (Pettitt)", "Abrupt shift (Pettitt)")}</li>
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
    <div><dt>${L("Cambio por década", "Change per decade")}</dt><dd><strong>${fmtSigned(mk.slopeDecade)}${u ? " " + esc(u) : ""}</strong><span class="muted"> (${L("entre", "between")} ${fmtSigned(ci[0])} ${L("y", "and")} ${fmtSigned(ci[1])})</span></dd></div>
    <div><dt>${L("p-valor", "p-value")}</dt><dd><strong>${fmtP(p)}</strong> <span class="muted">${sig ? L("menor que 0,05: significativa", "below 0.05: significant") : L("0,05 o más: no significativa", "0.05 or more: not significant")}</span></dd></div>
    <div><dt>${L("Años analizados", "Years analyzed")}</dt><dd><strong>${fmt(st.spanYears, 3)}</strong> <span class="muted">${st.pointsPerYear === 1 ? L("(un valor por año)", "(one value per year)") : L("(datos mensuales)", "(monthly data)")}</span></dd></div>
    <div><dt>${L("Años necesarios para detectarla", "Years needed to detect it")}</dt><dd><strong>${need === null ? "—" : `≈ ${Math.ceil(need)}`}</strong> <span class="muted">${
      sig
        ? L("ya es significativa", "already significant")
        : need === null
          ? L("sin tendencia que detectar", "no trend to detect")
          : L(`faltan ≈ ${Math.ceil(st.horizon.yearsRemaining ?? 0)}`, `≈ ${Math.ceil(st.horizon.yearsRemaining ?? 0)} to go`)
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
      <tr class="sub"><th colspan="2">Mann-Kendall ${L("sobre", "on")} ${st.pointsPerYear === 1 ? L("medias estacionales", "seasonal means") : L("anomalías mensuales", "monthly anomalies")}</th></tr>
      ${row("n · S · Var(S)", `${mk.n} · ${mk.s} · ${fmt(mk.varS, 6)}`)}
      ${row("Z · p", `${fmt(mk.z, 4)} · ${fmtPSci(mk.p)}`)}
      ${row(L("τ de Kendall", "Kendall's τ"), fmt(mk.tau, 3))}
      ${row(L("Sen (IC 95 %)", "Sen (95% CI)"), `${fmtSigned(mk.slopeDecade, 4)}${uu}/${L("década", "decade")} [${fmtSigned(mk.ciDecade[0], 3)}, ${fmtSigned(mk.ciDecade[1], 3)}]`)}
      <tr class="sub"><th colspan="2">${L("Corrección Hamed y Rao (1998)", "Hamed and Rao (1998) correction")}</th></tr>
      ${row(L("Factor Var*(S)/Var(S)", "Var*(S)/Var(S) factor"), fmt(mk.acfFactor, 3))}
      ${row("Z* · p*", `${fmt(mk.zHr, 4)} · ${fmtPSci(mk.pHr)}`)}
      ${row(L("Sen IC 95 % corregido", "Corrected Sen 95% CI"), `[${fmtSigned(mk.ciHrDecade[0], 3)}, ${fmtSigned(mk.ciHrDecade[1], 3)}]${uu}/${L("década", "decade")}`)}
      ${
        se
          ? `<tr class="sub"><th colspan="2">Seasonal Mann-Kendall (Hirsch et al., 1982), ${L("valores crudos", "raw values")}</th></tr>
      ${row("n · S · Z", `${se.n} · ${se.s} · ${fmt(se.z, 4)}`)}
      ${row("p", fmtPSci(se.p))}
      ${row(L("Sen estacional (IC 95 %)", "Seasonal Sen (95% CI)"), `${fmtSigned(se.slopeDecade, 4)}${uu}/${L("década", "decade")} [${fmtSigned(se.ciDecade[0], 3)}, ${fmtSigned(se.ciDecade[1], 3)}]`)}
      ${row(L("S por mes (E…D)", "S per month (J…D)"), se.monthS.map((x) => (x === 0 ? "·" : x > 0 ? "+" : "−")).join(" "))}`
          : ""
      }
      ${
        pt
          ? `<tr class="sub"><th colspan="2">Pettitt (1979)</th></tr>
      ${row(L("Quiebre · p", "Shift · p"), `${ym(pt.year, pt.month)} · ${fmtPSci(pt.p)}`)}
      ${row(L("Media antes → después", "Mean before → after"), `${fmt(pt.meanBefore, 3)} → ${fmt(pt.meanAfter, 3)}${uu}`)}`
          : ""
      }
      <tr class="sub"><th colspan="2">${L("Detectabilidad (Weatherhead et al., 1998)", "Detectability (Weatherhead et al., 1998)")}</th></tr>
      ${row(L("σ ruido · φ lag-1", "noise σ · lag-1 φ"), `${fmt(h.noiseSd, 3)}${uu} · ${fmt(h.phi, 3)}`)}
      ${row(L("n* años · disponibles", "n* years · available"), `${h.yearsNeeded === null ? "—" : fmt(h.yearsNeeded, 3)} · ${fmt(h.yearsAvailable, 3)}`)}
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
  if (from !== null) return L(`Con los últimos <strong>${from} años</strong> o más, la tendencia ya es significativa.`, `With the last <strong>${from} years</strong> or more, the trend is already significant.`);
  const rem = st.horizon.yearsRemaining;
  if (rem !== null && rem > 0)
    return L(
      `Ninguna ventana alcanza p &lt; 0,05. Al ritmo actual harían falta <strong>≈ ${Math.ceil(rem)} años más</strong> de datos.`,
      `No window reaches p &lt; 0.05. At the current rate, <strong>≈ ${Math.ceil(rem)} more years</strong> of data would be needed.`,
    );
  return L("La curva no baja de 0,05 de forma estable: la tendencia no es robusta al cambiar el periodo.", "The curve does not stay below 0.05: the trend is not robust to changing the period.");
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
        ${sci ? factsScientist(rr.stats, u) : factsStudent(rr.stats, s.hr, u)}
        ${
          sci
            ? ""
            : `<p class="small muted">${L("Sin corregir", "Uncorrected")}: ${pEq(mk.p)} · ${L("Corregido por autocorrelación", "Autocorrelation-corrected")}: ${pEq(mk.pHr)}${
                mk.acfFactor > 1.05 ? L(` (la incertidumbre se multiplicó por ${fmt(Math.sqrt(mk.acfFactor), 2)})`, ` (uncertainty multiplied by ${fmt(Math.sqrt(mk.acfFactor), 2)})`) : ""
              }.</p>`
        }
      </div>`;
    })
    .join("");

  const caption = list.map((rr) => `${a.mode === "dipole" ? `<strong>${rr.slot}:</strong> ` : ""}${horizonCaption(rr.stats, s.hr)}`).join(" ");

  let dipole = "";
  if (a.dipole?.all && a.B) {
    const name = lowerName(short(a.variableId));
    dipole = `<div class="fig">
      <h3>${L("Dipolo: ¿se mueven juntas A y B?", "Dipole: do A and B move together?")}</h3>
      <p class="small">${L(
        `Correlación de Spearman entre las anomalías mensuales de ambas regiones (${a.dipole.all.n} meses en común).`,
        `Spearman correlation between the monthly anomalies of both regions (${a.dipole.all.n} months in common).`,
      )} ${esc(corrSentence(a.dipole.all.rho, a.dipole.all.p, `${name} ${L("en", "in")} A`, `${name} ${L("en", "in")} B`))}</p>
      <div class="plot" id="fig-dipole"></div>
    </div>`;
  }

  const decoup = list
    .filter((rr) => rr.pair)
    .map((rr) => {
      const c = rr.pair!.couple;
      const pairName = short(rr.pair!.id);
      const mainName = short(a.variableId);
      const parts: string[] = [];
      if (c.all) parts.push(`${L("Todo el registro", "Whole record")}: ρ = ${fmtSigned(c.all.rho, 2)} (${pEq(c.all.p)}, n = ${c.all.n}).`);
      if (c.before && c.after) {
        const d = Math.abs(c.after.rho) - Math.abs(c.before.rho);
        const change =
          Math.abs(d) < 0.15
            ? L("La relación se mantiene parecida en ambos periodos: siguen acopladas.", "The relationship is similar in both periods: they remain coupled.")
            : d < 0
              ? L("La relación se debilitó en el segundo periodo: las variables se están desacoplando.", "The relationship weakened in the second period: the variables are decoupling.")
              : L("La relación se hizo más fuerte en el segundo periodo.", "The relationship became stronger in the second period.");
        parts.push(`${L("Antes", "Before")}: ρ = ${fmtSigned(c.before.rho, 2)}; ${L("después", "after")}: ρ = ${fmtSigned(c.after.rho, 2)}. ${change}`);
      }
      return `<div class="fig">
        <h3>${a.mode === "dipole" ? `<span class="slot-badge" style="--c:${COLORS[rr.slot]}">${rr.slot}</span> ` : ""}${L("Acoplamiento", "Coupling")}: ${esc(mainName)} ${L("frente a", "versus")} ${esc(pairName)}</h3>
        <p class="small">${L("Cada punto es un mes (anomalías).", "Each point is one month (anomalies).")} ${esc(regimeText(rr))} ${esc(parts.join(" "))}</p>
        <div class="plot" id="fig-pair-${rr.slot}"></div>
      </div>`;
    })
    .join("");

  return `
  <section class="out" aria-labelledby="o5">
    <header class="out-head">
      <span class="step-num" aria-hidden="true">5</span>
      <h2 id="o5">${L("Significancia estadística", "Statistical significance")}</h2>
      <label class="switch" data-k="hr-label">
        <input type="checkbox" data-action="hr" data-k="hr" ${s.hr ? "checked" : ""}>
        <span>${L("Corregir autocorrelación", "Correct for autocorrelation")} <span class="muted">(${L("Hamed y Rao", "Hamed and Rao")}, 1998)</span></span>
      </label>
    </header>
    ${
      sci
        ? ""
        : `<p class="explain">${L(
            "La prueba de <strong>Mann-Kendall</strong> cuenta cuántas veces un dato es mayor que los anteriores. Si sube (o baja) mucho más de lo que daría el azar, el <strong>p-valor</strong> es pequeño. Con p &lt; 0,05 decimos que la tendencia es significativa. Como un mes se parece al siguiente, la corrección de autocorrelación evita declarar tendencias que no existen.",
            "The <strong>Mann-Kendall</strong> test counts how often a value is larger than the earlier ones. If it rises (or falls) much more than chance would allow, the <strong>p-value</strong> is small. With p &lt; 0.05 we call the trend significant. Because one month resembles the next, the autocorrelation correction avoids claiming trends that do not exist.",
          )}</p>`
    }
    <div class="sig ${list.length > 1 ? "two" : ""}">${blocks}</div>
    <div class="fig">
      <h3>${L("Significance Horizon: ¿desde cuántos años se ve la tendencia?", "Significance Horizon: from how many years is the trend visible?")}</h3>
      <p class="small">${L(
        "Se repite la prueba usando solo los últimos 5, 6, 7… años. Cuando la curva baja de la línea punteada, la tendencia es significativa.",
        "The test is repeated using only the last 5, 6, 7… years. When the curve drops below the dashed line, the trend is significant.",
      )} ${caption}</p>
      <div class="plot" id="fig-horizon"></div>
    </div>
    ${dipole}
    ${decoup}
  </section>`;
}

function regimeText(rr: RegionResult): string {
  const pt = rr.stats.pettitt;
  if (pt && pt.significant) return L(`Gris: antes del quiebre de ${ym(pt.year, pt.month)}; color: después.`, `Gray: before the ${ym(pt.year, pt.month)} shift; color: after.`);
  return L("Gris: primera mitad del registro; color: segunda mitad.", "Gray: first half of the record; color: second half.");
}

function glossaryHtml(s: State): string {
  if (s.level === "scientist") return "";
  const items: [string, string][] = [
    [L("Anomalía", "Anomaly"), L("Diferencia entre el valor de un mes y el promedio histórico de ese mismo mes. Elimina el ciclo de las estaciones.", "Difference between a month's value and the historical mean for that same month. It removes the seasonal cycle.")],
    [L("Tendencia de Sen", "Sen trend"), L("Mediana de todas las pendientes entre pares de datos. Es robusta: un valor extremo no la mueve. Se expresa en unidades por década.", "Median of all slopes between pairs of data points. It is robust: an extreme value does not move it. Expressed in units per decade.")],
    ["Mann-Kendall", L("Prueba que no supone una forma de los datos. Compara cada dato con todos los anteriores para ver si predominan las subidas o las bajadas.", "A test that assumes no shape for the data. It compares each value with all earlier ones to see whether rises or falls dominate.")],
    [L("p-valor", "p-value"), L("Probabilidad de ver una tendencia así de fuerte si en realidad no hubiera ninguna. Menor que 0,05 significa menos de 1 en 20: decimos que es significativa.", "Probability of seeing a trend this strong if there were really none. Below 0.05 means less than 1 in 20: we call it significant.")],
    [L("Autocorrelación", "Autocorrelation"), L("Un mes cálido suele seguir a otro mes cálido. Eso hace que los datos parezcan más numerosos de lo que son. Hamed y Rao (1998) corrigen ese efecto.", "A warm month tends to follow another warm month. That makes the data look more plentiful than it is. Hamed and Rao (1998) correct for this.")],
    [L("Quiebre (Pettitt)", "Shift (Pettitt)"), L("Momento en que el nivel medio de la serie cambia de golpe, por ejemplo por un cambio de régimen climático o de instrumento.", "The moment the series' mean level changes suddenly, for example due to a climate regime shift or an instrument change.")],
    ["Significance Horizon", L("Curva del p-valor según cuántos años recientes se usan. Muestra desde cuándo una tendencia es detectable.", "Curve of the p-value against how many recent years are used. It shows since when a trend is detectable.")],
    [L("Dipolo y Spearman", "Dipole and Spearman"), L("Comparar dos regiones lejanas. La correlación de Spearman (ρ, de −1 a 1) indica si sus anomalías suben y bajan juntas (ρ > 0) o en direcciones opuestas (ρ < 0).", "Comparing two distant regions. Spearman's correlation (ρ, from −1 to 1) shows whether their anomalies rise and fall together (ρ > 0) or in opposite directions (ρ < 0).")],
    [L("Completitud", "Completeness"), L("Porcentaje de meses con dato válido. Los valores de relleno de NASA (−999) se descartan antes de calcular.", "Share of months with valid data. NASA fill values (−999) are discarded before computing.")],
  ];
  return `<details class="glossary"><summary>${L("Glosario: palabras clave explicadas", "Glossary: key terms explained")}</summary><dl>${items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl></details>`;
}

export function renderResults(root: HTMLElement, s: State): void {
  for (const c of charts) c.destroy();
  charts = [];
  figures = [];

  if (s.run.status === "idle") {
    root.innerHTML = emptyHtml(s) + glossaryHtml(s);
    return;
  }
  if (s.run.status === "loading") {
    root.innerHTML = `<section class="loading" aria-live="polite"><div class="bar"><span></span></div><p class="mono">${esc(s.run.msg)}</p></section>`;
    return;
  }
  if (s.run.status === "error") {
    root.innerHTML = `<section class="error" role="alert"><span class="eyebrow">${L("No se pudo completar el análisis", "The analysis could not be completed")}</span><p>${esc(s.run.msg)}</p>
      <button type="button" class="btn" data-action="run">${L("Reintentar", "Retry")}</button></section>${glossaryHtml(s)}`;
    return;
  }

  const a = s.run.analysis;
  root.innerHTML = summaryHtml(a, s) + step4Html(a, s) + step5Html(a, s) + glossaryHtml(s) + (s.level === "scientist" ? methodsHtml(a) : "");

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
        label: L(`Serie temporal de ${short(a.variableId)} en ${placeName(rr)}`, `Time series of ${short(a.variableId)} in ${placeName(rr)}`),
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
  const name = short(a.variableId);
  if (a.dipole?.all && a.B) {
    put("fig-dipole", (w) =>
      scatterPlot(
        {
          x: a.dipole!.x,
          y: a.dipole!.y,
          keys: a.dipole!.keys,
          splitKey: null,
          splitLabel: [L("Meses en común", "Months in common"), ""],
          color: "#4A4A44",
          xLabel: `${L("Anomalía en A", "Anomaly in A")}${unitsSuffix(a.A)}`,
          yLabel: `${L("Anomalía en B", "Anomaly in B")}${unitsSuffix(a.B!)}`,
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
          xLabel: `${name}, ${L("anomalía", "anomaly")}${unitsSuffix(rr)}`,
          yLabel: `${short(rr.pair!.id)}, ${L("anomalía", "anomaly")}${rr.pair!.series.units ? ` (${prettyUnits(rr.pair!.series.units)})` : ""}`,
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
  if (pt && pt.significant) return { key: pt.key, labels: [`${L("Antes de", "Before")} ${ym(pt.year, pt.month)}`, `${L("Desde", "From")} ${ym(pt.year, pt.month)}`] };
  const n = rr.series.years.length;
  const mid = Math.floor(n / 2);
  const key = monthKey(rr.series.years[mid], rr.series.months[mid]);
  return { key, labels: [`${L("Hasta", "Until")} ${rr.series.years[mid - 1] ?? ""}`, `${L("Desde", "From")} ${rr.series.years[mid]}`] };
}

function methodsHtml(a: Analysis): string {
  const season =
    a.season === "ALL"
      ? L(
          "Mann-Kendall sobre anomalías mensuales; Seasonal Mann-Kendall (12 meses) sobre valores crudos.",
          "Mann-Kendall on monthly anomalies; Seasonal Mann-Kendall (12 months) on raw values.",
        )
      : L(
          `Estación ${a.season} (${esc(seasonText(a.season, a.A.region.lat))}): media por año estacional de las anomalías (mínimo 2 de 3 meses; diciembre cuenta para el invierno siguiente) y Seasonal Mann-Kendall sobre los meses de la estación.`,
          `Season ${a.season} (${esc(seasonText(a.season, a.A.region.lat))}): mean anomaly per seasonal year (at least 2 of 3 months; December counts toward the following winter) and Seasonal Mann-Kendall over the season's months.`,
        );
  return `<details class="glossary" open><summary>${L("Método y fuentes", "Methods and sources")}</summary>
    <div class="methods small">
      <p>${L(
        "Valores centinela (≤ −999) eliminados. Anomalías respecto a la climatología mensual del periodo analizado.",
        "Sentinel values (≤ −999) removed. Anomalies relative to the monthly climatology of the analyzed period.",
      )} ${season} ${L(
        "Sen (1968) con IC de Gilbert (1987). Corrección de varianza de Hamed y Rao (1998) con autocorrelaciones significativas de los rangos sin tendencia. Pettitt (1979). Años necesarios según Weatherhead et al. (1998), generalizado a k puntos por año. Spearman con p de la t de Student (n − 2 g.l.). α = 0,05, bilateral.",
        "Sen (1968) with Gilbert (1987) CI. Hamed and Rao (1998) variance correction using significant autocorrelations of the detrended ranks. Pettitt (1979). Years needed per Weatherhead et al. (1998), generalized to k points per year. Spearman with Student's t p-value (n − 2 d.f.). α = 0.05, two-sided.",
      )}</p>
      <p>${L("Motor", "Engine")}: <span class="mono">${esc(a.engineVersion)}</span> (Rust → WebAssembly, Web Worker).</p>
      <p>${L("Consultas", "Queries")}:</p>
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
