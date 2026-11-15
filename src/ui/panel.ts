// Panel de investigación: casos de ejemplo + pasos 1 (variable), 2 (región) y 3 (periodo).
import {
  BLOCK_IDS,
  LEVEL,
  VARIABLES,
  applicable,
  blocks,
  endYearOf,
  getVar,
  levelLabel,
  pairsOf,
  seasonText,
  seasons,
  sourceIds,
  sourceLabel,
  startYearOf,
  tx,
  varDef,
  varName,
} from "../catalog";
import { needsCsv } from "../data/fetch";
import { describeRegion, regionName, surfaceLabel } from "../geo";
import { hypothesis } from "../hints";
import { L } from "../i18n";
import { PRESETS } from "../presets";
import { CURRENT_YEAR, type Slot, type State } from "../state";
import { coverageNote, esc } from "../text";
import { COLORS } from "./map";

function unitHint(id: string): string {
  const u: Record<string, string> = {
    T2M: "°C",
    ALLSKY_SFC_SW_DWN: L("MJ/m²/día", "MJ/m²/day"),
    CLOUD_AMT: "%",
    AOD: L("sin unidad", "unitless"),
    PRECTOTCORR: L("mm/día", "mm/day"),
    GWETPROF: L("0 a 1", "0 to 1"),
    WS2M: "m/s",
    SST: "°C",
    CHLOR_A: "mg/m³",
  };
  return u[id] ?? "";
}

function segmented(name: string, value: string, items: { v: string; label: string; title?: string }[], action: string): string {
  return `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${items
    .map(
      (it) =>
        `<button type="button" role="radio" aria-checked="${it.v === value}" class="seg-btn${it.v === value ? " is-on" : ""}" data-action="${action}" data-v="${esc(it.v)}" data-k="${action}-${esc(it.v)}"${it.title ? ` title="${esc(it.title)}"` : ""}>${esc(it.label)}</button>`,
    )
    .join("")}</div>`;
}

function activeSurface(s: State) {
  const r = s.regions[s.activeSlot] ?? s.regions.A;
  if (s.mode === "dipole" && s.regions.A && s.regions.B && s.regions.A.surface !== s.regions.B.surface) return "coast" as const;
  return r?.surface ?? null;
}

function presetsHtml(): string {
  return `
  <section class="block" aria-labelledby="presets-h">
    <h2 class="eyebrow" id="presets-h">${L("Casos de ejemplo en 1 clic", "1-click example cases")}</h2>
    <div class="preset-grid">
      ${PRESETS.map(
        (p) => `<button type="button" class="preset" data-action="preset" data-v="${p.id}" data-k="preset-${p.id}">
          <span class="preset-title">${esc(L(p.title, p.title_en))}</span>
          <span class="preset-sub">${esc(L(p.subtitle, p.subtitle_en))}</span>
        </button>`,
      ).join("")}
    </div>
  </section>`;
}

function stepHead(n: number, title: string, sub: string): string {
  return `<header class="step-head"><span class="step-num" aria-hidden="true">${n}</span><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></header>`;
}

function variableHtml(s: State): string {
  const surface = activeSurface(s);
  const sci = s.level === "scientist";
  const BLOCKS = blocks();
  const groups = BLOCK_IDS
    .map((b) => {
      const rows = VARIABLES.filter((v) => v.block === b)
        .map((v) => {
          const ok = applicable(v.id, surface);
          const on = v.id === s.variableId;
          const y = startYearOf(v, s);
          const why = !ok ? (surface === "land" ? L("Solo sobre el océano", "Ocean only") : L("Solo sobre tierra", "Land only")) : "";
          return `<label class="var-row${on ? " is-on" : ""}${ok ? "" : " is-off"}" data-k="var-${v.id}">
            <input type="radio" name="variable" value="${v.id}" ${on ? "checked" : ""} ${ok ? "" : "disabled"} data-action="variable">
            <span class="var-main">
              <span class="var-name">${esc(varName(v))}</span>
              ${sci ? `<span class="var-code mono small">${esc(v.id === "CHLOR_A" && v.sensors ? v.sensors[s.chlSensor].api_code : v.id === "AOD" && s.aodSource === "power" && v.fallback ? v.fallback.api_code : (v.api_code ?? v.id))}</span>` : `<span class="var-def">${esc(varDef(v))}</span>`}
              ${why ? `<span class="var-why">${why}</span>` : ""}
            </span>
            <span class="var-meta">
              ${sci ? "" : `<span class="tag tag-${LEVEL[v.id] === "Básica" ? "basic" : LEVEL[v.id] === "Intermedia" ? "mid" : "spec"}">${LEVEL[v.id] ? levelLabel(LEVEL[v.id]) : ""}</span>`}
              <span class="mono small">${esc(unitHint(v.id) || v.units_hint)}</span>
              <span class="mono small muted">${L("desde", "from")} ${y}</span>
            </span>
          </label>`;
        })
        .join("");
      return `<fieldset class="var-group"><legend><span>${BLOCKS[b].title}</span><span class="muted">${BLOCKS[b].hint}</span></legend>${rows}</fieldset>`;
    })
    .join("");

  const v = getVar(s.variableId);
  const extra: string[] = [];
  if (v.id === "CHLOR_A" && v.sensors) {
    extra.push(`<div class="field"><span class="field-label">Sensor</span>${segmented(
      "Sensor",
      s.chlSensor,
      Object.entries(v.sensors).map(([k, x]) => ({ v: k, label: tx(x.label, x.label_en) })),
      "sensor",
    )}</div>`);
  }
  if (v.id === "AOD") {
    extra.push(`<div class="field"><span class="field-label">${L("Fuente de datos", "Data source")}</span>${segmented(
      L("Fuente de AOD", "AOD source"),
      s.aodSource,
      [
        { v: "power", label: L("MERRA-2 (automático)", "MERRA-2 (automatic)"), title: v.fallback ? tx(v.fallback.note_es, v.fallback.note_en) : undefined },
        { v: "csv", label: "MODIS Giovanni (CSV)" },
      ],
      "aod",
    )}</div>`);
  }
  const status =
    v.status === "check" && !(v.id === "AOD" && s.aodSource === "power")
      ? `<p class="note note-warn"><strong>${L("Por confirmar.", "Unverified.")}</strong> ${L(
          "Esta variable no se ha verificado con una llamada real a su API mensual; puede fallar.",
          "This variable has not been verified with a real call to its monthly API; it may fail.",
        )}</p>`
      : "";
  const sensor = v.id === "CHLOR_A" ? v.sensors?.[s.chlSensor] : undefined;
  const fetchNote =
    (sensor ? tx(sensor.note, sensor.note_en) : "") ||
    (v.id === "AOD" && s.aodSource === "power" && v.fallback ? tx(v.fallback.note_es, v.fallback.note_en) : "") ||
    (v.fetch_note ? tx(v.fetch_note, v.fetch_note_en) : "");
  const qn = v.quality_notes.filter((q) => !q.sensors || (v.id === "CHLOR_A" && q.sensors.includes(s.chlSensor)));
  const pairs = pairsOf(v.id);
  const others = VARIABLES.filter((x) => x.id !== v.id && !pairs.includes(x.id));
  const endY = endYearOf(v, s);

  return `
  <section class="step" aria-labelledby="s1">
    ${stepHead(1, L("Variable", "Variable"), L("¿Qué quieres medir?", "What do you want to measure?")).replace("<h2>", '<h2 id="s1">')}
    ${surface ? `<p class="small muted">${L("Filtrado para", "Filtered for")}: <strong>${surfaceLabel(surface)}</strong>. ${L("Las variables que no aplican aparecen atenuadas.", "Variables that do not apply are dimmed.")}</p>` : ""}
    ${groups}
    <div class="var-detail">
      <p class="small"><span class="muted">${L("Fuente", "Source")}:</span> ${esc(sourceLabel(v, s))}${endY ? ` · ${L("termina en", "ends in")} ${endY}` : ""}</p>
      ${sci ? `<p class="small mono src-ids">${esc(sourceIds(v, s))}</p>` : ""}
      ${extra.join("")}
      ${status}
      ${qn.map((q) => `<p class="note ${q.severity === "critical" ? "note-crit" : "note-warn"}"><strong>${L("Calidad del sensor desde", "Sensor quality since")} ${q.after}.</strong> ${esc(tx(q.text_es, q.text_en))}</p>`).join("")}
      ${fetchNote ? `<details class="small"${sci ? " open" : ""}><summary>${L("Nota técnica de la fuente", "Technical note on the source")}</summary><p>${esc(fetchNote)}</p></details>` : ""}
      <label class="field">
        <span class="field-label">${L("Comparar con otra variable", "Compare with another variable")} <span class="muted">(${L("acoplamiento, opcional", "coupling, optional")})</span></span>
        <select data-action="pair" data-k="pair">
          <option value="">${L("Ninguna", "None")}</option>
          ${pairs.length ? `<optgroup label="${L("Pareja física sugerida", "Suggested physical pair")}">${pairs.map((p) => `<option value="${p}" ${s.pairId === p ? "selected" : ""}>${esc(varName(getVar(p)))}</option>`).join("")}</optgroup>` : ""}
          <optgroup label="${L("Otras", "Others")}">${others.map((p) => `<option value="${p.id}" ${s.pairId === p.id ? "selected" : ""}>${esc(varName(p))}</option>`).join("")}</optgroup>
        </select>
      </label>
    </div>
  </section>`;
}

function slotCard(s: State, slot: Slot): string {
  const r = s.regions[slot];
  const active = s.mode === "dipole" ? s.activeSlot === slot : true;
  const csvKey = `${slot}:${s.variableId}`;
  const csvNeeded = needsCsv(s.variableId, s);
  const csvOptional = !csvNeeded && getVar(s.variableId).source === "erddap";
  return `<div class="slot${active ? " is-active" : ""}" style="--c:${COLORS[slot]}">
    <button type="button" class="slot-btn" data-action="slot" data-v="${slot}" data-k="slot-${slot}" aria-pressed="${active}">
      <span class="slot-badge">${slot}</span>
      <span class="slot-body">
        <span class="slot-title">${r && regionName(r) ? esc(regionName(r)!) : `${L("Región", "Region")} ${slot}`}${active && s.mode === "dipole" ? ` <span class="muted small">(${L("editando", "editing")})</span>` : ""}</span>
        <span class="slot-desc mono small">${r ? `${r.kind === "point" ? L("Punto", "Point") : L("Área", "Area")} · ${esc(describeRegion(r))}` : L("Sin elegir: haz clic en el globo", "Not set: click on the globe")}</span>
        ${r ? `<span class="tag tag-surface">${surfaceLabel(r.surface)}</span>` : ""}
      </span>
    </button>
    ${
      csvNeeded
        ? `<label class="csv-drop small">
            <input type="file" accept=".csv,.txt,text/csv" data-action="csv" data-v="${slot}">
            <span>${s.csv[csvKey] ? L(`CSV cargado: ${s.csv[csvKey]!.values.length} meses`, `CSV loaded: ${s.csv[csvKey]!.values.length} months`) : L("Cargar CSV de Giovanni para esta región", "Load a Giovanni CSV for this region")}</span>
          </label>`
        : csvOptional
          ? `<details class="csv-alt small"><summary>${L("¿Servidor ERDDAP caído? Usar un CSV propio", "ERDDAP server down? Use your own CSV")}</summary>
              <label class="csv-drop">
                <input type="file" accept=".csv,.txt,text/csv" data-action="csv" data-v="${slot}">
                <span>${
                  s.csv[csvKey]
                    ? L(`CSV cargado: ${s.csv[csvKey]!.values.length} meses (se usará en lugar del servidor)`, `CSV loaded: ${s.csv[csvKey]!.values.length} months (used instead of the server)`)
                    : L("Columnas: fecha (AAAA-MM) y valor", "Columns: date (YYYY-MM) and value")
                }</span>
              </label>
            </details>`
          : ""
    }
  </div>`;
}

function regionHtml(s: State): string {
  const active = s.regions[s.activeSlot] ?? s.regions.A;
  const hint = active ? hypothesis(active) : null;
  return `
  <section class="step" aria-labelledby="s2">
    ${stepHead(2, L("Región", "Region"), L("¿Dónde quieres investigar?", "Where do you want to investigate?")).replace("<h2>", '<h2 id="s2">')}
    ${segmented(
      L("Modo", "Mode"),
      s.mode,
      [
        { v: "single", label: L("Una región", "One region") },
        { v: "dipole", label: L("Dos regiones (Dipolo A frente a B)", "Two regions (Dipole A versus B)") },
      ],
      "mode",
    )}
    <p class="small how">${L(
      "Haz <strong>clic en el globo</strong> para elegir un punto, o usa la herramienta de <strong>rectángulo</strong> (barra del mapa, arriba a la derecha) para un área.",
      "<strong>Click on the globe</strong> to pick a point, or use the <strong>rectangle</strong> tool (map toolbar, top right) for an area.",
    )}${s.mode === "dipole" ? L(" Elige cuál región editar tocando su tarjeta.", " Choose which region to edit by tapping its card.") : ""}</p>
    <div class="slots">
      ${slotCard(s, "A")}
      ${s.mode === "dipole" ? slotCard(s, "B") : ""}
    </div>
    <form class="coords" data-action="coords" autocomplete="off">
      <span class="field-label">${L("Escribir coordenadas", "Type coordinates")}${s.mode === "dipole" ? ` ${L("de la región", "for region")} ${s.activeSlot}` : ""}</span>
      <div class="coords-row">
        <label><span class="sr">${L("Latitud", "Latitude")}</span><input name="lat" type="number" step="any" min="-90" max="90" placeholder="${L("Latitud", "Latitude")} (9.1)" data-k="lat" required></label>
        <label><span class="sr">${L("Longitud", "Longitude")}</span><input name="lon" type="number" step="any" min="-180" max="180" placeholder="${L("Longitud", "Longitude")} (-79.7)" data-k="lon" required></label>
        <button type="submit" class="btn" data-k="coords-go">${L("Usar", "Use")}</button>
      </div>
    </form>
    ${s.mode === "dipole" && s.regions.A ? `<button type="button" class="btn btn-ghost" data-action="suggest" data-k="suggest">${L("Sugerir región B contraparte", "Suggest a counterpart region B")}</button>` : ""}
    ${hint && s.level === "student" ? `<aside class="hint"><span class="eyebrow">${L("Pista para investigar", "Research hint")}</span><p>${esc(hint)}</p></aside>` : ""}
  </section>`;
}

function periodHtml(s: State): string {
  const v = getVar(s.variableId);
  const minY = startYearOf(v, s);
  const maxY = endYearOf(v, s) ?? CURRENT_YEAR;
  const y0 = Math.max(s.y0, minY);
  const y1 = Math.min(s.y1, maxY);
  const span = y1 - y0 + 1;
  const quick = [
    { v: "all", y0: minY, label: `${minY}–${maxY}`, title: L("Registro completo de la variable", "Full record of the variable") },
    ...(minY < 2002 ? [{ v: "2002", y0: 2002, label: `2002–${maxY}`, title: L("Era de los satélites EOS (2002 en adelante)", "EOS satellite era (2002 onward)") }] : []),
  ];
  const quickOn = quick.find((q) => q.y0 === y0 && maxY === y1);
  // el último análisis (si es de esta misma variable y rango) dice qué años trajo de verdad la fuente
  let gap = "";
  if (s.run.status === "done") {
    const a = s.run.analysis;
    if (a.variableId === s.variableId && a.y0 === y0 && a.y1 === y1 && a.chlSensor === s.chlSensor && a.aodSource === s.aodSource) {
      gap = [a.A, a.B]
        .filter((rr): rr is NonNullable<typeof rr> => !!rr)
        .map((rr) => coverageNote(rr.series, a.y0, a.y1, a.mode === "dipole" ? L(` (región ${rr.slot})`, ` (region ${rr.slot})`) : ""))
        .filter(Boolean)
        .join(" ");
    }
  }
  return `
  <section class="step" aria-labelledby="s3">
    ${stepHead(3, L("Periodo y estación", "Period and season"), L("¿Qué años y qué meses?", "Which years and which months?")).replace("<h2>", '<h2 id="s3">')}
    <div class="period">
      <label class="field"><span class="field-label">${L("Desde", "From")}</span><input type="number" min="${minY}" max="${maxY}" value="${y0}" data-action="y0" data-k="y0"></label>
      <label class="field"><span class="field-label">${L("Hasta", "To")}</span><input type="number" min="${minY}" max="${maxY}" value="${y1}" data-action="y1" data-k="y1"></label>
      <div class="field"><span class="field-label">${L("Rápido", "Quick")}${quickOn ? "" : ` <span class="muted">· ${L("rango personalizado", "custom range")} ${y0}–${y1}</span>`}</span>
        <div class="quick">
          ${quick
            .map(
              (q) =>
                `<button type="button" class="btn btn-ghost${q === quickOn ? " is-on" : ""}" aria-pressed="${q === quickOn}" title="${esc(q.title)}" data-action="range" data-v="${q.v}" data-k="range-${q.v}">${q.label}</button>`,
            )
            .join("")}
        </div>
      </div>
    </div>
    <p class="small muted">${L("Datos mensuales. Esta variable tiene registro desde", "Monthly data. This variable has records from")} ${minY}${endYearOf(v, s) ? ` ${L("hasta", "to")} ${maxY}` : ""}.</p>
    ${gap ? `<p class="note note-warn"><strong>${L("El rango no coincide con los datos.", "The range does not match the data.")}</strong> ${esc(gap)}</p>` : ""}
    ${
      span < 15
        ? `<p class="note note-warn"><strong>${L(`Serie corta (${span} años).`, `Short series (${span} years).`)}</strong> ${L(
            "Con menos de 15 años es difícil separar una tendencia de la variación natural.",
            "With fewer than 15 years it is hard to separate a trend from natural variability.",
          )}</p>`
        : ""
    }
    <div class="field">
      <span class="field-label">${L("Estación", "Season")}</span>
      ${segmented(L("Estación", "Season"), s.season, seasons().map((x) => ({ v: x.id, label: x.short, title: x.long })), "season")}
      <p class="small">${L("Analizando", "Analyzing")}: <strong>${esc(seasonText(s.season, s.regions.A))}</strong>.</p>
    </div>
  </section>`;
}

function runHtml(s: State): string {
  const missing: string[] = [];
  if (!s.regions.A) missing.push(L("la región A", "region A"));
  if (s.mode === "dipole" && !s.regions.B) missing.push(L("la región B", "region B"));
  const busy = s.run.status === "loading";
  const ready =
    s.engine === "ready"
      ? L("Calcula los pasos 4 y 5.", "Computes steps 4 and 5.")
      : s.engine === "loading"
        ? L("Preparando el cálculo estadístico…", "Preparing the statistics…")
        : L("El cálculo estadístico no está disponible.", "Statistics are not available.");
  return `
  <div class="run">
    <button type="button" class="btn btn-primary" data-action="run" data-k="run" ${missing.length || busy || s.engine !== "ready" ? "disabled" : ""}>
      ${busy ? L("Analizando…", "Analyzing…") : L("Analizar tendencia", "Analyze trend")}
    </button>
    <p class="small muted run-status" aria-live="polite">${
      busy ? esc((s.run as { msg: string }).msg) : missing.length ? L(`Falta elegir ${missing.join(" y ")}.`, `Still need to pick ${missing.join(" and ")}.`) : ready
    }</p>
  </div>`;
}

export function renderPanel(root: HTMLElement, s: State): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
  root.innerHTML = presetsHtml() + variableHtml(s) + regionHtml(s) + periodHtml(s) + runHtml(s);
  if (focusKey) (root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
}
