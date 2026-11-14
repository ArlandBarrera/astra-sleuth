// Estado global mínimo con suscripción (sin framework).
import type { Season } from "./catalog";
import type { MonthlySeries } from "./data/series";
import type { AnalyzeOut, CoupleOut } from "./engine/types";
import type { Region } from "./geo";

export type Slot = "A" | "B";

export interface RegionResult {
  slot: Slot;
  region: Region;
  series: MonthlySeries;
  stats: AnalyzeOut;
  pair?: { id: string; series: MonthlySeries; stats: AnalyzeOut; couple: CoupleOut };
}

export interface Analysis {
  /** Copia de los parámetros con que se calculó (para el dossier). */
  variableId: string;
  pairId: string | null;
  season: Season;
  y0: number;
  y1: number;
  mode: "single" | "dipole";
  chlSensor: "viirs" | "modis";
  aodSource: "power" | "csv";
  A: RegionResult;
  B?: RegionResult;
  dipole?: CoupleOut;
  engineVersion: string;
  createdAt: string;
}

export type Run =
  | { status: "idle" }
  | { status: "loading"; msg: string }
  | { status: "error"; msg: string }
  | { status: "done"; analysis: Analysis };

export interface State {
  level: "student" | "scientist";
  variableId: string;
  pairId: string | null;
  chlSensor: "viirs" | "modis";
  aodSource: "power" | "csv";
  mode: "single" | "dipole";
  activeSlot: Slot;
  regions: Record<Slot, Region | null>;
  y0: number;
  y1: number;
  season: Season;
  hr: boolean;
  view: "anom" | "raw";
  /** CSV importados, clave `${slot}:${variableId}`. */
  csv: Record<string, MonthlySeries | undefined>;
  run: Run;
  /** Último aviso no bloqueante (región ajustada, etc.). */
  notice: string | null;
  engine: "loading" | "ready" | "error";
  engineVersion: string;
}

/** Año en curso (antes fijo en 2026: la app dejaba de pedir datos nuevos al cambiar de año). */
export const CURRENT_YEAR = new Date().getFullYear();

let state: State = {
  level: "student",
  variableId: "T2M",
  pairId: null,
  chlSensor: "viirs",
  aodSource: "power",
  mode: "single",
  activeSlot: "A",
  regions: { A: null, B: null },
  y0: 1981,
  y1: CURRENT_YEAR,
  season: "ALL",
  hr: true,
  view: "anom",
  csv: {},
  run: { status: "idle" },
  notice: null,
  engine: "loading",
  engineVersion: "",
};

type Listener = (s: State, prev: State) => void;
const listeners = new Set<Listener>();

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)): void {
  const prev = state;
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l(state, prev);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
