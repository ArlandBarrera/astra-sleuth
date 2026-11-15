import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

import { lowerName } from "./text";
import { SHORT, applicable, endYearOf, getVar, pairsOf, startYearOf } from "./catalog";
import { parseCsv } from "./data/csv";
import { getSeries } from "./data/fetch";
import { monthKey, validCount, type MonthlySeries } from "./data/series";
import { engine } from "./engine/client";
import type { AnalyzeOut, CoupleOut } from "./engine/types";
import { classify, clampLat, normLon, preloadLand, SURFACE_LABEL, type Region } from "./geo";
import { counterpart } from "./hints";
import { PRESETS } from "./presets";
import { CURRENT_YEAR, getState, setState, subscribe, type Analysis, type RegionResult, type Slot, type State } from "./state";
import { exportCsv, exportDossier, exportJson } from "./ui/dossier";
import { createMap, type BaseLayer } from "./ui/map";
import { renderPanel } from "./ui/panel";
import { currentFigures, redrawFigures, renderResults, splitFor } from "./ui/results";

// ---------------------------------------------------------------- layout

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-name">Earth System Trend Detective</span>
      <span class="brand-sub">Tendencias de varias décadas con datos de NASA y NOAA</span>
    </div>
    <div class="topbar-right">
      <span class="engine-status mono" id="engine-status" aria-live="polite"></span>
      <span class="field-label">Nivel de detalle</span>
      <div class="seg seg-sm" role="radiogroup" aria-label="Nivel de detalle" id="level"></div>
    </div>
  </header>
  <div class="layout">
    <aside class="panel" id="panel" aria-label="Panel de investigación"></aside>
    <main class="main" id="main">
      <section class="map-wrap" aria-label="Globo para elegir la región">
        <div id="map"></div>
        <div class="map-tools">
          <div class="seg seg-sm" role="radiogroup" aria-label="Mapa base" id="base"></div>
          <label class="switch switch-sm"><input type="checkbox" id="ctx"><span id="ctx-label">Capa NASA GIBS</span></label>
        </div>
        <div class="map-notice" id="notice" role="status" aria-live="polite" hidden></div>
      </section>
      <div class="stale" id="stale" hidden>Cambiaste los parámetros. Pulsa <strong>Analizar tendencia</strong> para actualizar los resultados.</div>
      <div class="results" id="results"></div>
    </main>
  </div>`;

const panelEl = document.getElementById("panel")!;
const resultsEl = document.getElementById("results")!;
const noticeEl = document.getElementById("notice")!;
const staleEl = document.getElementById("stale")!;
const ctxBox = document.getElementById("ctx") as HTMLInputElement;
const ctxLabel = document.getElementById("ctx-label")!;

let base: BaseLayer = "relief";
let showContext = false;

const map = createMap(document.getElementById("map")!, {
  onPick: (kind, lat, lon, bbox) => void pickRegion({ kind, lat, lon, bbox }),
  onError: (msg) => notify(msg),
});
preloadLand();

// ---------------------------------------------------------------- avisos

let noticeTimer = 0;
function notify(msg: string): void {
  noticeEl.textContent = msg;
  noticeEl.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (noticeEl.hidden = true), 8000);
}

// ---------------------------------------------------------------- render

function renderChrome(s: State): void {
  const es = document.getElementById("engine-status")!;
  es.textContent = s.engine === "ready" ? "Motor Rust/WASM: listo" : s.engine === "loading" ? "Motor Rust/WASM: cargando" : "Motor Rust/WASM: error";
  es.dataset.state = s.engine;
  const lv = document.getElementById("level")!;
  lv.innerHTML = (["student", "scientist"] as const)
    .map(
      (v) =>
        `<button type="button" role="radio" class="seg-btn${s.level === v ? " is-on" : ""}" aria-checked="${s.level === v}" data-action="level" data-v="${v}">${v === "student" ? "Estudiante" : "Científico"}</button>`,
    )
    .join("");
  document.getElementById("base")!.innerHTML = (["relief", "plain"] as const)
    .map(
      (v) =>
        `<button type="button" role="radio" class="seg-btn${base === v ? " is-on" : ""}" aria-checked="${base === v}" data-action="base" data-v="${v}">${v === "relief" ? "Relieve" : "Tierra y agua"}</button>`,
    )
    .join("");
  ctxLabel.textContent = `Capa NASA GIBS: ${lowerName(SHORT[s.variableId])}`;
  document.body.classList.toggle("level-sci", s.level === "scientist");
}

function isStale(s: State): boolean {
  if (s.run.status !== "done") return false;
  const a = s.run.analysis;
  const same = (r1: Region | null | undefined, r2: Region | undefined) =>
    !!r1 && !!r2 && r1.kind === r2.kind && r1.lat === r2.lat && r1.lon === r2.lon && String(r1.bbox) === String(r2.bbox);
  return (
    a.variableId !== s.variableId ||
    a.pairId !== s.pairId ||
    a.season !== s.season ||
    a.y0 !== s.y0 ||
    a.y1 !== s.y1 ||
    a.mode !== s.mode ||
    a.chlSensor !== s.chlSensor ||
    a.aodSource !== s.aodSource ||
    !same(s.regions.A, a.A.region) ||
    (s.mode === "dipole" && !same(s.regions.B, a.B?.region))
  );
}

subscribe((s, prev) => {
  renderPanel(panelEl, s);
  renderChrome(s);
  if (s.regions !== prev.regions || s.activeSlot !== prev.activeSlot || s.mode !== prev.mode) map.setRegions(s.regions, s.activeSlot, s.mode);
  if (s.variableId !== prev.variableId) map.setContext(showContext ? s.variableId : null);
  if (s.run !== prev.run || s.hr !== prev.hr || s.view !== prev.view || s.level !== prev.level) renderResults(resultsEl, s);
  staleEl.hidden = !isStale(s);
});

// ---------------------------------------------------------------- regiones

async function pickRegion(r: Omit<Region, "surface">, slot?: Slot): Promise<void> {
  const s = getState();
  const target = slot ?? (s.mode === "dipole" ? s.activeSlot : "A");
  const surface = await classify(r);
  const region: Region = { ...r, lat: clampLat(r.lat), lon: normLon(r.lon), surface };
  setState((st) => {
    const regions = { ...st.regions, [target]: region };
    let activeSlot = st.activeSlot;
    if (st.mode === "dipole" && target === "A" && !regions.B) activeSlot = "B";
    return { regions, activeSlot };
  });
  const st = getState();
  if (!applicable(st.variableId, surface)) {
    notify(`${getVar(st.variableId).name_es} no aplica sobre ${SURFACE_LABEL[surface].toLowerCase()}. Elige otra variable en el paso 1.`);
  } else if (surface === "coast" && ["SST", "CHLOR_A"].includes(st.variableId)) {
    notify("Esta región toca la costa: los datos del mar pueden faltar en las celdas de tierra.");
  }
}

// ---------------------------------------------------------------- análisis

let controller: AbortController | null = null;

function seasonMask(values: (number | null)[], months: number[], season: string): (number | null)[] {
  const sets: Record<string, number[]> = { DJF: [12, 1, 2], JFM: [1, 2, 3], MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11] };
  const set = sets[season];
  if (!set) return values;
  return values.map((v, i) => (set.includes(months[i]) ? v : null));
}

function keysOf(s: MonthlySeries): number[] {
  return s.years.map((y, i) => monthKey(y, s.months[i]));
}

async function analyzeSeries(series: MonthlySeries, season: string): Promise<AnalyzeOut> {
  return engine.analyze({ years: series.years, months: series.months, values: series.values, season, alpha: 0.05 });
}

async function runAnalysis(): Promise<void> {
  const s = getState();
  const slots: Slot[] = s.mode === "dipole" ? ["A", "B"] : ["A"];
  if (slots.some((k) => !s.regions[k])) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const v = getVar(s.variableId);
  const opts = { y0: s.y0, y1: s.y1, chlSensor: s.chlSensor, aodSource: s.aodSource };
  const loading = (msg: string) => setState({ run: { status: "loading", msg } });

  try {
    const results: Partial<Record<Slot, RegionResult>> = {};
    for (const slot of slots) {
      const region = s.regions[slot]!;
      const where = s.mode === "dipole" ? ` (región ${slot})` : "";
      loading(`Descargando ${v.name_es.toLowerCase()}${where}…`);
      const csv = { [s.variableId]: s.csv[`${slot}:${s.variableId}`] };
      const main = (await getSeries([s.variableId], region, opts, csv, signal))[s.variableId];
      if (validCount(main) < 24) {
        throw new Error(
          `${v.name_es}${where}: solo hay ${validCount(main)} meses con datos en ese lugar y periodo. ` +
            `Prueba otra región${["SST", "CHLOR_A"].includes(v.id) ? " (mar adentro)" : ""} o un periodo más largo.`,
        );
      }
      loading(`Calculando la tendencia en Rust/WASM${where}…`);
      const stats = await analyzeSeries(main, s.season);
      const rr: RegionResult = { slot, region, series: main, stats };

      if (s.pairId) {
        try {
          loading(`Descargando ${getVar(s.pairId).name_es.toLowerCase()} para el acoplamiento${where}…`);
          const pcsv = { [s.pairId]: s.csv[`${slot}:${s.pairId}`] };
          const ps = (await getSeries([s.pairId], region, opts, pcsv, signal))[s.pairId];
          if (validCount(ps) >= 24) {
            const pstats = await analyzeSeries(ps, "ALL");
            const split = splitFor(rr);
            const couple: CoupleOut = await engine.couple(
              {
                keysA: keysOf(main),
                a: seasonMask(stats.grid.anom, main.months, s.season),
                keysB: keysOf(ps),
                b: pstats.grid.anom,
                splitKey: split.key,
              },
              0.05,
            );
            rr.pair = { id: s.pairId, series: ps, stats: pstats, couple };
          } else {
            notify(`No hay suficientes datos de ${getVar(s.pairId).name_es.toLowerCase()} para el acoplamiento${where}.`);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          notify(`Acoplamiento omitido${where}: ${(e as Error).message}`);
        }
      }
      results[slot] = rr;
    }

    let dipole: CoupleOut | undefined;
    if (results.A && results.B) {
      dipole = await engine.couple(
        {
          keysA: keysOf(results.A.series),
          a: seasonMask(results.A.stats.grid.anom, results.A.series.months, s.season),
          keysB: keysOf(results.B.series),
          b: seasonMask(results.B.stats.grid.anom, results.B.series.months, s.season),
          splitKey: null,
        },
        0.05,
      );
    }

    const analysis: Analysis = {
      variableId: s.variableId,
      pairId: s.pairId,
      season: s.season,
      y0: s.y0,
      y1: s.y1,
      mode: s.mode,
      chlSensor: s.chlSensor,
      aodSource: s.aodSource,
      A: results.A!,
      B: results.B,
      dipole,
      engineVersion: getState().engineVersion,
      createdAt: new Date().toISOString(),
    };
    setState({ run: { status: "done", analysis } });
    const sum = document.querySelector<HTMLElement>(".summary");
    const mainEl = document.getElementById("main")!;
    if (sum && getComputedStyle(mainEl).display !== "contents") mainEl.scrollTo({ top: mainEl.scrollTop + sum.getBoundingClientRect().top - mainEl.getBoundingClientRect().top - 8, behavior: "smooth" });
    else sum?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    setState({ run: { status: "error", msg: (e as Error).message } });
  }
}

// ---------------------------------------------------------------- casos de ejemplo

async function applyPreset(id: string): Promise<void> {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const [A, B] = await Promise.all([
    classify(p.A).then((surface) => ({ ...p.A, surface }) as Region),
    p.B ? classify(p.B).then((surface) => ({ ...p.B!, surface }) as Region) : Promise.resolve(null),
  ]);
  setState({
    variableId: p.variableId,
    pairId: p.pairId,
    mode: p.mode,
    y0: p.y0,
    y1: p.y1,
    season: p.season,
    aodSource: p.aodSource ?? getState().aodSource,
    chlSensor: p.chlSensor ?? getState().chlSensor,
    regions: { A, B },
    activeSlot: "A",
  });
  if (A && B) map.fitBoth(A, B);
  else if (A) map.flyTo(A);
  await runAnalysis();
}

// ---------------------------------------------------------------- eventos

function defaultPair(variableId: string, s: State): string | null {
  const surf = s.regions.A?.surface ?? null;
  return pairsOf(variableId).find((p) => applicable(p, surf)) ?? null;
}

function clampYears(s: State, variableId = s.variableId): Pick<State, "y0" | "y1"> {
  const v = getVar(variableId);
  const min = startYearOf(v, s);
  const max = endYearOf(v, s) ?? CURRENT_YEAR;
  let y0 = Math.min(Math.max(s.y0, min), max - 4);
  let y1 = Math.max(Math.min(s.y1, max), min + 4);
  if (y1 - y0 < 4) y0 = Math.max(min, y1 - 4);
  return { y0, y1 };
}

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!t || t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "FORM") return;
  const s = getState();
  const v = t.dataset.v ?? "";
  switch (t.dataset.action) {
    case "preset":
      void applyPreset(v);
      break;
    case "sensor":
      setState((st) => ({ chlSensor: v as State["chlSensor"], ...clampYears({ ...st, chlSensor: v as State["chlSensor"] }) }));
      break;
    case "aod":
      setState((st) => ({ aodSource: v as State["aodSource"], ...clampYears({ ...st, aodSource: v as State["aodSource"] }) }));
      break;
    case "mode":
      setState({ mode: v as State["mode"], activeSlot: v === "dipole" && s.regions.A && !s.regions.B ? "B" : "A" });
      break;
    case "slot":
      setState({ activeSlot: v as Slot });
      if (s.regions[v as Slot]) map.flyTo(s.regions[v as Slot]!);
      break;
    case "suggest": {
      if (!s.regions.A) break;
      const c = counterpart(s.regions.A);
      void pickRegion({ kind: "point", lat: c.lat, lon: c.lon, name: c.name }, "B").then(() => {
        notify(`Sugerencia: ${c.name}. ${c.why}`);
        const st = getState();
        if (st.regions.A && st.regions.B) map.fitBoth(st.regions.A, st.regions.B);
      });
      break;
    }
    case "range": {
      const vv = getVar(s.variableId);
      const min = startYearOf(vv, s);
      const max = endYearOf(vv, s) ?? CURRENT_YEAR;
      setState({ y0: v === "2002" ? 2002 : min, y1: max });
      break;
    }
    case "season":
      setState({ season: v as State["season"] });
      break;
    case "run":
      void runAnalysis();
      break;
    case "view":
      setState({ view: v as State["view"] });
      break;
    case "level":
      setState({ level: v as State["level"] });
      break;
    case "base":
      base = v as BaseLayer;
      map.setBase(base);
      renderChrome(s);
      break;
    case "dossier":
      if (s.run.status === "done") {
        const f = currentFigures();
        exportDossier(s.run.analysis, s.hr, f.canvases, f.svgs);
      }
      break;
    case "csv-out":
      if (s.run.status === "done") exportCsv(s.run.analysis);
      break;
    case "json-out":
      if (s.run.status === "done") exportJson(s.run.analysis);
      break;
  }
});

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const s = getState();
  switch (t.dataset.action) {
    case "variable": {
      const id = t.value;
      setState({ variableId: id, pairId: defaultPair(id, s), ...clampYears(s, id) });
      break;
    }
    case "pair":
      setState({ pairId: t.value || null });
      break;
    case "y0":
    case "y1": {
      const n = parseInt(t.value, 10);
      if (!Number.isFinite(n)) break;
      setState((st) => clampYears({ ...st, [t.dataset.action!]: n }));
      break;
    }
    case "hr":
      setState({ hr: (t as HTMLInputElement).checked });
      break;
    case "csv": {
      const file = (t as HTMLInputElement).files?.[0];
      const slot = (t as HTMLInputElement).dataset.v as Slot;
      if (!file) break;
      void file.text().then(
        (text) => {
          try {
            const series = parseCsv(text, `CSV importado (${file.name})`);
            setState((st) => ({ csv: { ...st.csv, [`${slot}:${st.variableId}`]: series } }));
            notify(`CSV loaded: ${series.values.length} months (${series.years[0]}–${series.years.at(-1)}).`);
          } catch (err) {
            notify((err as Error).message);
          }
        },
        () => notify("The file could not be read."),
      );
      break;
    }
  }
});

document.addEventListener("submit", (e) => {
  const f = e.target as HTMLFormElement;
  if (f.dataset.action !== "coords") return;
  e.preventDefault();
  const lat = parseFloat((f.elements.namedItem("lat") as HTMLInputElement).value);
  const lon = parseFloat((f.elements.namedItem("lon") as HTMLInputElement).value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    notify("Coordenadas no válidas: latitud entre −90 y 90, longitud entre −180 y 180.");
    return;
  }
  void pickRegion({ kind: "point", lat, lon }).then(() => {
    const st = getState();
    const r = st.regions[st.mode === "dipole" ? (st.activeSlot === "B" && st.regions.B ? "B" : "A") : "A"];
    if (r) map.flyTo(r);
  });
});

ctxBox.addEventListener("change", () => {
  showContext = ctxBox.checked;
  map.setContext(showContext ? getState().variableId : null);
});

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => redrawFigures(resultsEl, getState()), 200);
});

// ---------------------------------------------------------------- arranque

setState({});
renderResults(resultsEl, getState());
map.setRegions(getState().regions, "A", "single");
engine
  .version()
  .then((v) => setState({ engine: "ready", engineVersion: v }))
  .catch((e: Error) => {
    setState({ engine: "error" });
    notify(e.message);
  });
