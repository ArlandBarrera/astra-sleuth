// Tipos del JSON que devuelve el motor Rust (engine/trend_wasm/src/lib.rs, camelCase).

export interface MkOut {
  n: number;
  s: number;
  varS: number;
  z: number;
  p: number;
  tau: number;
  significant: boolean;
  direction: "up" | "down" | "flat";
  slopeDecade: number;
  ciDecade: [number, number];
  acfFactor: number;
  zHr: number;
  pHr: number;
  significantHr: boolean;
  ciHrDecade: [number, number];
}

export interface SeasonalOut {
  n: number;
  s: number;
  z: number;
  p: number;
  significant: boolean;
  direction: "up" | "down" | "flat";
  slopeDecade: number;
  ciDecade: [number, number];
  monthS: number[];
}

export interface PettittOut {
  gridIndex: number;
  year: number;
  month: number;
  key: number;
  p: number;
  significant: boolean;
  meanBefore: number;
  meanAfter: number;
}

export interface HorizonWindow {
  years: number;
  n: number;
  p: number;
  pHr: number;
  slopeDecade: number;
}

export interface HorizonOut {
  windows: HorizonWindow[];
  yearsNeeded: number | null;
  yearsRemaining: number | null;
  yearsAvailable: number;
  noiseSd: number;
  phi: number;
}

export interface GridOut {
  t: number[];
  raw: (number | null)[];
  anom: (number | null)[];
  smooth: (number | null)[];
  tested: (number | null)[];
  fit: (number | null)[];
  lo: (number | null)[];
  hi: (number | null)[];
  loHr: (number | null)[];
  hiHr: (number | null)[];
}

export interface AnalyzeOut {
  season: string;
  nMonths: number;
  nValid: number;
  completeness: number;
  spanYears: number;
  pointsPerYear: number;
  mk: MkOut;
  seasonal: SeasonalOut | null;
  pettitt: PettittOut | null;
  horizon: HorizonOut;
  grid: GridOut;
  warnings: string[];
}

export interface CorrOut {
  n: number;
  rho: number;
  p: number;
  significant: boolean;
}

export interface CoupleOut {
  all: CorrOut | null;
  before: CorrOut | null;
  after: CorrOut | null;
  keys: number[];
  x: number[];
  y: number[];
}

export interface AnalyzeRequest {
  years: number[];
  months: number[];
  values: (number | null)[];
  season: string;
  alpha: number;
}

export interface CoupleRequest {
  keysA: number[];
  a: (number | null)[];
  keysB: number[];
  b: (number | null)[];
  splitKey: number | null;
}
