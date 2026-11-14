// Casos de ejemplo en 1 clic (contexto.md, sección 2).
import type { Season } from "./catalog";
import type { Region } from "./geo";

export interface Preset {
  id: string;
  title: string;
  subtitle: string;
  variableId: string;
  pairId: string | null;
  mode: "single" | "dipole";
  y0: number;
  y1: number;
  season: Season;
  A: Omit<Region, "surface">;
  B?: Omit<Region, "surface">;
  aodSource?: "power" | "csv";
  chlSensor?: "viirs" | "modis";
}

export const PRESETS: Preset[] = [
  {
    id: "enso",
    title: "Canal de Panamá frente a Sudamérica",
    subtitle: "Dipolo ENSO · lluvia 1981–2026",
    variableId: "PRECTOTCORR",
    pairId: "GWETPROF",
    mode: "dipole",
    y0: 1981,
    y1: 2026,
    season: "ALL",
    A: { kind: "point", lat: 9.1, lon: -79.7, name: "Cuenca del Canal de Panamá" },
    B: { kind: "point", lat: -5.2, lon: -80.63, name: "Piura, costa norte de Perú" },
  },
  {
    id: "upwelling",
    title: "Afloramiento del Golfo de Panamá",
    subtitle: "Temperatura del mar · estación seca JFM",
    variableId: "SST",
    pairId: "CHLOR_A",
    mode: "single",
    y0: 2002,
    y1: 2026,
    season: "JFM",
    A: { kind: "bbox", lat: 8.0, lon: -79.25, bbox: [-80.0, 7.0, -78.5, 9.0], name: "Golfo de Panamá" },
  },
  {
    id: "wisconsin",
    title: "Wisconsin: humo y aerosoles",
    subtitle: "Caso Dr. Acker · AOD 2002–2026 · verano",
    variableId: "AOD",
    pairId: "ALLSKY_SFC_SW_DWN",
    mode: "single",
    y0: 2002,
    y1: 2026,
    season: "JJA",
    aodSource: "power",
    A: { kind: "bbox", lat: 44.8, lon: -89.85, bbox: [-92.9, 42.5, -86.8, 47.1], name: "Wisconsin" },
  },
  {
    id: "arctic",
    title: "Ártico frente al Sahel",
    subtitle: "Temperatura del aire · 1981–2026",
    variableId: "T2M",
    pairId: "CLOUD_AMT",
    mode: "dipole",
    y0: 1981,
    y1: 2026,
    season: "ALL",
    A: { kind: "point", lat: 78.2, lon: 15.6, name: "Svalbard, Ártico" },
    B: { kind: "point", lat: 13.5, lon: 2.1, name: "Niamey, Sahel" },
  },
];
