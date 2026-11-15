// Catálogo de variables. `variables.json` es la fuente única de verdad de los datos;
// aquí solo se añaden metadatos de interfaz (dominio, nivel, capa GIBS de contexto).
import raw from "../variables.json";
import { L, lang } from "./i18n";

export type Block = "A" | "B" | "C";
export type Source = "power" | "erddap" | "giovanni";
export type Surface = "land" | "ocean" | "coast";

export interface QualityNote {
  after: string; // "YYYY-MM"
  severity: "warning" | "critical";
  text_es: string;
  text_en?: string;
  sensors?: string[];
}

export interface Mirror {
  erddap_host: string;
  dataset_id: string;
  api_code: string;
  label?: string;
  start?: string;
  end?: string;
}

export interface Sensor {
  label: string;
  label_en?: string;
  mirrors?: Mirror[];
  erddap_host: string;
  dataset_id: string;
  api_code: string;
  start: string;
  end?: string;
  var_status: string;
  note: string;
  note_en?: string;
}

export interface Fallback {
  source: "power";
  api_code: string;
  label_es: string;
  label_en?: string;
  units_hint: string;
  start: string;
  status: string;
  note_es: string;
  note_en?: string;
}

export interface Variable {
  id: string;
  block: Block;
  name_es: string;
  name_en?: string;
  definition_es: string;
  definition_en?: string;
  source: Source;
  api_code?: string;
  units_hint: string;
  start?: string;
  pairs_with: string[];
  status: "verified" | "check";
  fetch_note?: string;
  fetch_note_en?: string;
  /** Nombre legible de la fuente ERDDAP principal. */
  label?: string;
  mirrors?: Mirror[];
  quality_notes: QualityNote[];
  erddap_host?: string;
  dataset_id?: string;
  sensors?: Record<string, Sensor>;
  fallback?: Fallback;
}

export const VARIABLES: Variable[] = (raw as unknown as { variables: Variable[] }).variables;

export function getVar(id: string): Variable {
  const v = VARIABLES.find((x) => x.id === id);
  if (!v) throw new Error(L(`Variable desconocida: ${id}`, `Unknown variable: ${id}`));
  return v;
}

/** Elige el campo `_en` cuando la interfaz está en inglés (si existe). */
export const tx = (es: string, en?: string): string => (lang() === "en" && en ? en : es);
export const varName = (v: Variable) => tx(v.name_es, v.name_en);
export const varDef = (v: Variable) => tx(v.definition_es, v.definition_en);

export function blocks(): Record<Block, { title: string; hint: string }> {
  return {
    A: { title: L("Atmósfera y energía", "Atmosphere and energy"), hint: L("Aire, nubes, sol y partículas", "Air, clouds, sun and particles") },
    B: { title: L("Tierra y agua", "Land and water"), hint: L("Lluvia y humedad del suelo", "Rain and soil moisture") },
    C: { title: L("Océano y superficie", "Ocean and surface"), hint: L("Mar, vida marina y viento", "Sea, marine life and wind") },
  };
}
export const BLOCK_IDS: Block[] = ["A", "B", "C"];

export function levelLabel(l: "Básica" | "Intermedia" | "Especializada"): string {
  return l === "Básica" ? L("Básica", "Basic") : l === "Intermedia" ? L("Intermedia", "Intermediate") : L("Especializada", "Specialized");
}

/** Nivel didáctico (contexto.md, sección 3). */
export const LEVEL: Record<string, "Básica" | "Intermedia" | "Especializada"> = {
  T2M: "Básica",
  CLOUD_AMT: "Básica",
  PRECTOTCORR: "Básica",
  SST: "Básica",
  WS2M: "Intermedia",
  ALLSKY_SFC_SW_DWN: "Especializada",
  AOD: "Especializada",
  GWETPROF: "Especializada",
  CHLOR_A: "Especializada",
};

/** Dónde tiene sentido físico la variable. */
export const APPLIES_TO: Record<string, "any" | "land" | "ocean"> = {
  GWETPROF: "land",
  SST: "ocean",
  CHLOR_A: "ocean",
};

export function applicable(id: string, surface: Surface | null): boolean {
  const rule = APPLIES_TO[id] ?? "any";
  if (!surface || surface === "coast" || rule === "any") return true;
  return rule === surface;
}

/** Nombre corto para gráficas y tablas. */
const SHORT_ES: Record<string, string> = {
  T2M: "Temperatura del aire",
  ALLSKY_SFC_SW_DWN: "Radiación solar",
  CLOUD_AMT: "Nubosidad",
  AOD: "Aerosoles (AOD)",
  PRECTOTCORR: "Precipitación",
  GWETPROF: "Humedad del suelo",
  WS2M: "Viento a 2 m",
  SST: "Temperatura del mar",
  CHLOR_A: "Clorofila-a",
};
const SHORT_EN: Record<string, string> = {
  T2M: "Air temperature",
  ALLSKY_SFC_SW_DWN: "Solar radiation",
  CLOUD_AMT: "Cloud cover",
  AOD: "Aerosols (AOD)",
  PRECTOTCORR: "Precipitation",
  GWETPROF: "Soil moisture",
  WS2M: "Wind at 2 m",
  SST: "Sea temperature",
  CHLOR_A: "Chlorophyll-a",
};
export const short = (id: string): string => (lang() === "en" ? SHORT_EN : SHORT_ES)[id] ?? id;

/** Capa mensual de NASA GIBS que da contexto visual a cada variable. */
export const GIBS_CONTEXT: Record<string, { layer: string; matrix: string; label: string; daily?: boolean }> = {
  T2M: { layer: "MERRA2_2m_Air_Temperature_Monthly", matrix: "GoogleMapsCompatible_Level6", label: "Temperatura del aire, MERRA-2 mensual" },
  ALLSKY_SFC_SW_DWN: { layer: "CERES_Combined_Surface_Shortwave_Flux_Down_All_Sky_Monthly", matrix: "GoogleMapsCompatible_Level6", label: "Radiación solar en superficie, CERES mensual" },
  CLOUD_AMT: { layer: "MODIS_Aqua_Cloud_Fraction_Day", matrix: "GoogleMapsCompatible_Level6", label: "Fracción de nubes, MODIS-Aqua diaria", daily: true },
  AOD: { layer: "MERRA2_Aerosol_Optical_Depth_Analysis_Monthly", matrix: "GoogleMapsCompatible_Level6", label: "Aerosoles, MERRA-2 mensual" },
  PRECTOTCORR: { layer: "MERRA2_Precipitation_Bias_Corrected_Monthly", matrix: "GoogleMapsCompatible_Level6", label: "Precipitación corregida, MERRA-2 mensual" },
  GWETPROF: { layer: "GLDAS_Underground_Soil_Moisture_Monthly", matrix: "GoogleMapsCompatible_Level6", label: "Humedad del suelo, GLDAS mensual" },
  WS2M: { layer: "MERRA2_Surface_Wind_Speed_Monthly", matrix: "GoogleMapsCompatible_Level6", label: "Viento en superficie, MERRA-2 mensual" },
  SST: { layer: "GHRSST_L4_MUR_Sea_Surface_Temperature", matrix: "GoogleMapsCompatible_Level7", label: "Temperatura del mar, MUR diaria", daily: true },
  CHLOR_A: { layer: "VIIRS_SNPP_L2_Chlorophyll_A", matrix: "GoogleMapsCompatible_Level7", label: "Clorofila-a, VIIRS diaria", daily: true },
};

export type Season = "ALL" | "DJF" | "JFM" | "MAM" | "JJA" | "SON";

export const SEASON_IDS: Season[] = ["ALL", "DJF", "JFM", "MAM", "JJA", "SON"];

export function seasons(): { id: Season; short: string; long: string }[] {
  return [
    { id: "ALL", short: L("Todo el año", "Whole year"), long: L("todos los meses", "all months") },
    { id: "DJF", short: "DJF", long: L("diciembre a febrero", "December to February") },
    { id: "JFM", short: "JFM", long: L("enero a marzo", "January to March") },
    { id: "MAM", short: "MAM", long: L("marzo a mayo", "March to May") },
    { id: "JJA", short: "JJA", long: L("junio a agosto", "June to August") },
    { id: "SON", short: "SON", long: L("septiembre a noviembre", "September to November") },
  ];
}

/** Bounding box de Panamá: lat ∈ [7.0, 9.8], lon ∈ [-83.1, -77.1]. */
export function inPanama(lat: number | null | undefined, lon: number | null | undefined): boolean {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= 7.0 && lat <= 9.8 && lon >= -83.1 && lon <= -77.1;
}

/**
 * Texto de la estación. Los nombres del clima de Panamá (estación seca, lluvias) solo se
 * usan dentro de Panamá; en el resto del trópico, o sin región, se muestra el código
 * ("enero a marzo (JFM)"); fuera del trópico, el nombre según el hemisferio.
 */
export function seasonText(s: Season, region: { lat: number; lon: number } | null | undefined): string {
  if (s === "ALL") return L("todo el año", "the whole year");
  const base = seasons().find((x) => x.id === s)!.long;
  const lat = region?.lat ?? null;
  if (lat === null) return `${base} (${s})`;
  const panama = inPanama(lat, region?.lon);
  if (!panama && Math.abs(lat) < 23.5) return `${base} (${s})`;
  const north = lat >= 0;
  const en = lang() === "en";
  const names: Record<Exclude<Season, "ALL">, string> = panama
    ? en
      ? { DJF: "start of Panama's dry season", JFM: "Panama's dry season", MAM: "transition to the rains", JJA: "rainy season", SON: "heaviest rains in Panama" }
      : { DJF: "inicio de la estación seca en Panamá", JFM: "estación seca en Panamá", MAM: "transición a la lluvia", JJA: "estación lluviosa", SON: "lluvias más intensas en Panamá" }
    : north
      ? en
        ? { DJF: "winter", JFM: "late winter", MAM: "spring", JJA: "summer", SON: "autumn" }
        : { DJF: "invierno", JFM: "final del invierno", MAM: "primavera", JJA: "verano", SON: "otoño" }
      : en
        ? { DJF: "summer", JFM: "late summer", MAM: "autumn", JJA: "winter", SON: "spring" }
        : { DJF: "verano", JFM: "final del verano", MAM: "otoño", JJA: "invierno", SON: "primavera" };
  return `${base} (${names[s as Exclude<Season, "ALL">]})`;
}

/** Variables disponibles como pareja física de `id` (solo las que existen en el catálogo). */
export function pairsOf(id: string): string[] {
  const own = getVar(id).pairs_with.filter((p) => VARIABLES.some((v) => v.id === p));
  // también pares declarados en la otra dirección
  const back = VARIABLES.filter((v) => v.pairs_with.includes(id)).map((v) => v.id);
  return [...new Set([...own, ...back])].filter((p) => p !== id);
}

export function startYearOf(v: Variable, opts: { chlSensor: string; aodSource: string }): number {
  if (v.id === "CHLOR_A" && v.sensors) return +v.sensors[opts.chlSensor].start.slice(0, 4);
  if (v.id === "AOD" && opts.aodSource === "power" && v.fallback) return +v.fallback.start.slice(0, 4);
  return +(v.start ?? "1981").slice(0, 4);
}

export function endYearOf(v: Variable, opts: { chlSensor: string }): number | null {
  if (v.id === "CHLOR_A" && v.sensors?.[opts.chlSensor]?.end) return +v.sensors[opts.chlSensor].end!.slice(0, 4);
  return null;
}

export function sourceLabel(v: Variable, opts: { chlSensor: string; aodSource: string }): string {
  if (v.id === "CHLOR_A" && v.sensors) {
    const s = v.sensors[opts.chlSensor];
    return `NOAA ERDDAP · ${tx(s.label, s.label_en)}`;
  }
  if (v.id === "AOD")
    return opts.aodSource === "power" ? `NASA POWER · ${v.fallback ? tx(v.fallback.label_es, v.fallback.label_en) : "MERRA-2"}` : "NASA Giovanni · MODIS-Aqua MYD08_M3 (CSV)";
  if (v.source === "power") return "NASA POWER · MERRA-2 / CERES";
  if (v.source === "erddap") return `NOAA ERDDAP · ${v.label ?? v.dataset_id}`;
  return v.source;
}

/** Identificadores técnicos de la fuente (modo científico). */
export function sourceIds(v: Variable, opts: { chlSensor: string; aodSource: string }): string {
  if (v.id === "CHLOR_A" && v.sensors) {
    const s = v.sensors[opts.chlSensor];
    return `${new URL(s.erddap_host).host} · ${s.dataset_id} · ${s.api_code}`;
  }
  if (v.id === "AOD" && opts.aodSource === "power" && v.fallback) return `power.larc.nasa.gov · monthly · ${v.fallback.api_code}`;
  if (v.source === "power") return `power.larc.nasa.gov · monthly · ${v.api_code ?? v.id}`;
  if (v.source === "erddap" && v.erddap_host) return `${new URL(v.erddap_host).host} · ${v.dataset_id} · ${v.api_code}`;
  return v.api_code ?? v.id;
}
