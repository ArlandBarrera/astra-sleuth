// Panel de investigación: casos de ejemplo + pasos 1 (variable), 2 (región) y 3 (periodo).
import {
  BLOCKS,
  LEVEL,
  SEASONS,
  VARIABLES,
  applicable,
  endYearOf,
  getVar,
  pairsOf,
  seasonText,
  sourceLabel,
  startYearOf,
  type Block,
} from "../catalog";
import { needsCsv } from "../data/fetch";
import { SURFACE_LABEL, describeRegion } from "../geo";
import { hypothesis } from "../hints";
import { PRESETS } from "../presets";
import { CURRENT_YEAR, type Slot, type State } from "../state";
import { esc } from "../text";
import { COLORS } from "./map";

const UNIT_HINT: Record<string, string> = {
  T2M: "°C",
  ALLSKY_SFC_SW_DWN: "MJ/m²/día",
  CLOUD_AMT: "%",
  AOD: "sin unidad",
  PRECTOTCORR: "mm/día",
  GWETPROF: "0 a 1",
  WS2M: "m/s",
  SST: "°C",
  CHLOR_A: "mg/m³",
};

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
    <h2 class="eyebrow" id="presets-h">Casos de ejemplo en 1 clic</h2>
    <div class="preset-grid">
      ${PRESETS.map(
        (p) => `<button type="button" class="preset" data-action="preset" data-v="${p.id}" data-k="preset-${p.id}">
          <span class="preset-title">${esc(p.title)}</span>
          <span class="preset-sub">${esc(p.subtitle)}</span>
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
  const groups = (Object.keys(BLOCKS) as Block[])
    .map((b) => {
      const rows = VARIABLES.filter((v) => v.block === b)
        .map((v) => {
          const ok = applicable(v.id, surface);
          const on = v.id === s.variableId;
          const y = startYearOf(v, s);
          const why = !ok ? (surface === "land" ? "Solo sobre el océano" : "Solo sobre tierra") : "";
          return `<label class="var-row${on ? " is-on" : ""}${ok ? "" : " is-off"}" data-k="var-${v.id}">
            <input type="radio" name="variable" value="${v.id}" ${on ? "checked" : ""} ${ok ? "" : "disabled"} data-action="variable">
            <span class="var-main">
              <span class="var-name">${esc(v.name_es)}</span>
              <span class="var-def">${esc(v.definition_es)}</span>
              ${why ? `<span class="var-why">${why}</span>` : ""}
            </span>
            <span class="var-meta">
              <span class="tag tag-${LEVEL[v.id] === "Básica" ? "basic" : LEVEL[v.id] === "Intermedia" ? "mid" : "spec"}">${LEVEL[v.id] ?? ""}</span>
              <span class="mono small">${esc(UNIT_HINT[v.id] ?? v.units_hint)}</span>
              <span class="mono small muted">desde ${y}</span>
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
      Object.entries(v.sensors).map(([k, x]) => ({ v: k, label: x.label })),
      "sensor",
    )}</div>`);
  }
  if (v.id === "AOD") {
    extra.push(`<div class="field"><span class="field-label">Fuente de datos</span>${segmented(
      "Fuente de AOD",
      s.aodSource,
      [
        { v: "power", label: "MERRA-2 (automático)", title: v.fallback?.note_es },
        { v: "csv", label: "MODIS Giovanni (CSV)" },
      ],
      "aod",
    )}</div>`);
  }
  const status =
    v.status === "check" && !(v.id === "AOD" && s.aodSource === "power")
      ? `<p class="note note-warn"><strong>Por confirmar.</strong> Esta variable no se ha verificado con una llamada real a su API mensual; puede fallar.</p>`
      : "";
  const fetchNote = v.fetch_note || (v.id === "CHLOR_A" && v.sensors?.[s.chlSensor]?.note) || (v.id === "AOD" && s.aodSource === "power" ? v.fallback?.note_es : "");
  const qn = v.quality_notes.filter((q) => !q.sensors || (v.id === "CHLOR_A" && q.sensors.includes(s.chlSensor)));
  const pairs = pairsOf(v.id);
  const others = VARIABLES.filter((x) => x.id !== v.id && !pairs.includes(x.id));
  const endY = endYearOf(v, s);

  return `
  <section class="step" aria-labelledby="s1">
    ${stepHead(1, "Variable", "¿Qué quieres medir?").replace("<h2>", '<h2 id="s1">')}
    ${surface ? `<p class="small muted">Filtrado para: <strong>${SURFACE_LABEL[surface]}</strong>. Las variables que no aplican aparecen atenuadas.</p>` : ""}
    ${groups}
    <div class="var-detail">
      <p class="small"><span class="muted">Fuente:</span> ${esc(sourceLabel(v, s))}${endY ? ` · termina en ${endY}` : ""}</p>
      ${extra.join("")}
      ${status}
      ${qn.map((q) => `<p class="note ${q.severity === "critical" ? "note-crit" : "note-warn"}"><strong>Calidad del sensor desde ${q.after}.</strong> ${esc(q.text_es)}</p>`).join("")}
      ${fetchNote ? `<details class="small"><summary>Nota técnica de la fuente</summary><p>${esc(fetchNote)}</p></details>` : ""}
      <label class="field">
        <span class="field-label">Comparar con otra variable <span class="muted">(acoplamiento, opcional)</span></span>
        <select data-action="pair" data-k="pair">
          <option value="">Ninguna</option>
          ${pairs.length ? `<optgroup label="Pareja física sugerida">${pairs.map((p) => `<option value="${p}" ${s.pairId === p ? "selected" : ""}>${esc(getVar(p).name_es)}</option>`).join("")}</optgroup>` : ""}
          <optgroup label="Otras">${others.map((p) => `<option value="${p.id}" ${s.pairId === p.id ? "selected" : ""}>${esc(p.name_es)}</option>`).join("")}</optgroup>
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
        <span class="slot-title">${r?.name ? esc(r.name) : `Región ${slot}`}${active && s.mode === "dipole" ? ' <span class="muted small">(editando)</span>' : ""}</span>
        <span class="slot-desc mono small">${r ? `${r.kind === "point" ? "Punto" : "Área"} · ${esc(describeRegion(r))}` : "Sin elegir: haz clic en el globo"}</span>
        ${r ? `<span class="tag tag-surface">${SURFACE_LABEL[r.surface]}</span>` : ""}
      </span>
    </button>
    ${
      csvNeeded
        ? `<label class="csv-drop small">
            <input type="file" accept=".csv,.txt,text/csv" data-action="csv" data-v="${slot}">
            <span>${s.csv[csvKey] ? `CSV cargado: ${s.csv[csvKey]!.values.length} meses` : "Cargar CSV de Giovanni para esta región"}</span>
          </label>`
        : csvOptional
          ? `<details class="csv-alt small"><summary>¿Servidor ERDDAP caído? Usar un CSV propio</summary>
              <label class="csv-drop">
                <input type="file" accept=".csv,.txt,text/csv" data-action="csv" data-v="${slot}">
                <span>${s.csv[csvKey] ? `CSV cargado: ${s.csv[csvKey]!.values.length} meses (se usará en lugar del servidor)` : "Columnas: fecha (AAAA-MM) y valor"}</span>
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
    ${stepHead(2, "Región", "¿Dónde quieres investigar?").replace("<h2>", '<h2 id="s2">')}
    ${segmented(
      "Modo",
      s.mode,
      [
        { v: "single", label: "Una región" },
        { v: "dipole", label: "Dos regiones (Dipolo A frente a B)" },
      ],
      "mode",
    )}
    <p class="small how">Haz <strong>clic en el globo</strong> para elegir un punto, o usa la herramienta de <strong>rectángulo</strong> (barra del mapa, arriba a la derecha) para un área.${s.mode === "dipole" ? " Elige cuál región editar tocando su tarjeta." : ""}</p>
    <div class="slots">
      ${slotCard(s, "A")}
      ${s.mode === "dipole" ? slotCard(s, "B") : ""}
    </div>
    <form class="coords" data-action="coords" autocomplete="off">
      <span class="field-label">Escribir coordenadas${s.mode === "dipole" ? ` de la región ${s.activeSlot}` : ""}</span>
      <div class="coords-row">
        <label><span class="sr">Latitud</span><input name="lat" type="number" step="any" min="-90" max="90" placeholder="Latitud (9.1)" data-k="lat" required></label>
        <label><span class="sr">Longitud</span><input name="lon" type="number" step="any" min="-180" max="180" placeholder="Longitud (-79.7)" data-k="lon" required></label>
        <button type="submit" class="btn" data-k="coords-go">Usar</button>
      </div>
    </form>
    ${s.mode === "dipole" && s.regions.A ? `<button type="button" class="btn btn-ghost" data-action="suggest" data-k="suggest">Sugerir región B contraparte</button>` : ""}
    ${hint ? `<aside class="hint"><span class="eyebrow">Pista para investigar</span><p>${esc(hint)}</p></aside>` : ""}
  </section>`;
}

function periodHtml(s: State): string {
  const v = getVar(s.variableId);
  const minY = startYearOf(v, s);
  const maxY = endYearOf(v, s) ?? CURRENT_YEAR;
  const y0 = Math.max(s.y0, minY);
  const y1 = Math.min(s.y1, maxY);
  const span = y1 - y0 + 1;
  const lat = (s.regions.A ?? null)?.lat ?? null;
  return `
  <section class="step" aria-labelledby="s3">
    ${stepHead(3, "Periodo y estación", "¿Qué años y qué meses?").replace("<h2>", '<h2 id="s3">')}
    <div class="period">
      <label class="field"><span class="field-label">Desde</span><input type="number" min="${minY}" max="${maxY}" value="${y0}" data-action="y0" data-k="y0"></label>
      <label class="field"><span class="field-label">Hasta</span><input type="number" min="${minY}" max="${maxY}" value="${y1}" data-action="y1" data-k="y1"></label>
      <div class="field"><span class="field-label">Rápido</span>
        <div class="quick">
          <button type="button" class="btn btn-ghost" data-action="range" data-v="all" data-k="range-all">${minY}–${maxY}</button>
          ${minY < 2002 ? `<button type="button" class="btn btn-ghost" data-action="range" data-v="2002" data-k="range-2002">2002–${maxY}</button>` : ""}
        </div>
      </div>
    </div>
    <p class="small muted">Datos mensuales. Esta variable tiene registro desde ${minY}${endYearOf(v, s) ? ` hasta ${maxY}` : ""}.</p>
    ${span < 15 ? `<p class="note note-warn"><strong>Serie corta (${span} años).</strong> Con menos de 15 años es difícil separar una tendencia de la variación natural.</p>` : ""}
    <div class="field">
      <span class="field-label">Estación</span>
      ${segmented("Estación", s.season, SEASONS.map((x) => ({ v: x.id, label: x.short, title: x.long })), "season")}
      <p class="small">Analizando: <strong>${esc(seasonText(s.season, lat))}</strong>.</p>
    </div>
  </section>`;
}

function runHtml(s: State): string {
  const missing: string[] = [];
  if (!s.regions.A) missing.push("la región A");
  if (s.mode === "dipole" && !s.regions.B) missing.push("la región B");
  const busy = s.run.status === "loading";
  const engineTxt = s.engine === "ready" ? "Motor Rust/WASM listo" : s.engine === "loading" ? "Cargando motor Rust/WASM" : "Motor no disponible";
  return `
  <div class="run">
    <button type="button" class="btn btn-primary" data-action="run" data-k="run" ${missing.length || busy || s.engine !== "ready" ? "disabled" : ""}>
      ${busy ? "Analizando…" : "Analizar tendencia"}
    </button>
    <p class="small muted run-status" aria-live="polite">${
      busy ? esc((s.run as { msg: string }).msg) : missing.length ? `Falta elegir ${missing.join(" y ")}.` : `${engineTxt}. Calcula los pasos 4 y 5.`
    }</p>
  </div>`;
}

export function renderPanel(root: HTMLElement, s: State): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
  root.innerHTML = presetsHtml() + variableHtml(s) + regionHtml(s) + periodHtml(s) + runHtml(s);
  if (focusKey) (root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
}
