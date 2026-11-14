// Catálogo de variables. `variables.json` es la fuente única de verdad de los datos;
// aquí solo se añaden metadatos de interfaz (dominio, nivel, capa GIBS de contexto).
import raw from "../variables.json";

export type Block = "A" | "B" | "C";
export type Source = "power" | "erddap" | "giovanni";
export type Surface = "land" | "ocean" | "coast";

export interface QualityNote {
  after: string; // "YYYY-MM"
  severity: "warning" | "critical";
  text_es: string;
  sensors?: string[];
}

export interface Sensor {
  label: string;
  erddap_host: string;
  dataset_id: string;
  api_code: string;
  start: string;
  end?: string;
  var_status: string;
  note: string;
}

export interface Fallback {
  source: "power";
  api_code: string;
  label_es: string;
  units_hint: string;
  start: string;
  status: string;
  note_es: string;
}

export interface Variable {
  id: string;
  block: Block;
  name_es: string;
  definition_es: string;
  source: Source;
  api_code?: string;
  units_hint: string;
  start?: string;
  pairs_with: string[];
  status: "verified" | "check";
  fetch_note?: string;
  quality_notes: QualityNote[];
  erddap_host?: string;
  dataset_id?: string;
  sensors?: Record<string, Sensor>;
  fallback?: Fallback;
}

export const VARIABLES: Variable[] = (raw as unknown as { variables: Variable[] }).variables;

export function getVar(id: string): Variable {
  const v = VARIABLES.find((x) => x.id === id);
  if (!v) throw new Error(`Variable desconocida: ${id}`);
  return v;
}

export const BLOCKS: Record<Block, { title: string; hint: string }> = {
  A: { title: "Atmósfera y energía", hint: "Aire, nubes, sol y partículas" },
  B: { title: "Tierra y agua", hint: "Lluvia y humedad del suelo" },
  C: { title: "Océano y superficie", hint: "Mar, vida marina y viento" },
};

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
export const SHORT: Record<string, string> = {
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

export const SEASONS: { id: Season; short: string; long: string }[] = [
  { id: "ALL", short: "Todo el año", long: "todos los meses" },
  { id: "DJF", short: "DJF", long: "diciembre a febrero" },
  { id: "JFM", short: "JFM", long: "enero a marzo" },
  { id: "MAM", short: "MAM", long: "marzo a mayo" },
  { id: "JJA", short: "JJA", long: "junio a agosto" },
  { id: "SON", short: "SON", long: "septiembre a noviembre" },
];

export function seasonText(s: Season, lat: number | null): string {
  if (s === "ALL") return "todo el año";
  const base = SEASONS.find((x) => x.id === s)!.long;
  const north = lat === null || lat >= 0;
  const tropics = lat !== null && Math.abs(lat) < 23.5;
  const names: Record<Exclude<Season, "ALL">, string> = tropics
    ? { DJF: "inicio de la estación seca en Panamá", JFM: "estación seca en Panamá", MAM: "transición a la lluvia", JJA: "estación lluviosa", SON: "lluvias más intensas en Panamá" }
    : north
      ? { DJF: "invierno", JFM: "final del invierno", MAM: "primavera", JJA: "verano", SON: "otoño" }
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
  if (v.id === "CHLOR_A" && v.sensors) return `NOAA ERDDAP · ${v.sensors[opts.chlSensor].label}`;
  if (v.id === "AOD") return opts.aodSource === "power" ? `NASA POWER · ${v.fallback?.label_es ?? "MERRA-2"}` : "NASA Giovanni · MODIS-Aqua MYD08_M3 (CSV)";
  if (v.source === "power") return "NASA POWER · MERRA-2 / CERES";
  if (v.source === "erddap") return `NOAA ERDDAP · ${v.dataset_id}`;
  return v.source;
}
