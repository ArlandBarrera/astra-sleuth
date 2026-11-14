// Cliente del Web Worker estadístico (promesas sobre postMessage).
import type { AnalyzeOut, AnalyzeRequest, CoupleOut, CoupleRequest } from "./types";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, Pending>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.result);
  else p.reject(new Error(e.data.error ?? "Error del motor estadístico"));
};
worker.onerror = (e) => {
  const err = new Error(`El motor estadístico (WASM) no pudo cargarse: ${e.message || "error desconocido"}`);
  for (const p of pending.values()) p.reject(err);
  pending.clear();
};

function call<T>(kind: string, payload?: unknown): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, kind, payload });
  });
}

/**
 * Hamed y Rao (1998) con factor >= 1. El factor Var*(S)/Var(S) puede salir < 1 por las
 * autocorrelaciones negativas espurias de muchos desfases (con ruido blanco la mediana
 * era 0,85 y el 10 % de las series bajaba de 0,45): la "corrección" encogía la varianza
 * y declaraba más tendencias falsas que la prueba sin corregir (9 % frente al 5 %
 * nominal). La corrección solo debe proteger contra la autocorrelación positiva, así que
 * con factor < 1 se usan los valores sin corregir; es exactamente lo que daría el motor
 * con el factor acotado en 1 (mismo cambio en engine/mann_kendall/src/lib.rs).
 */
export function floorHamedRao(out: AnalyzeOut): AnalyzeOut {
  const mk = out.mk;
  for (const w of out.horizon.windows) w.pHr = Math.max(w.p, w.pHr);
  if (!(mk.acfFactor < 1)) return out;
  return {
    ...out,
    mk: { ...mk, acfFactor: 1, zHr: mk.z, pHr: mk.p, significantHr: mk.significant, ciHrDecade: mk.ciDecade },
    grid: { ...out.grid, loHr: out.grid.lo, hiHr: out.grid.hi },
  };
}

/**
 * El motor genera ventanas de 5 … round(años) años. Si el registro mide p. ej. 24,4 años,
 * la última ventana (24) deja fuera los primeros meses y la curva puede no terminar en
 * el p-valor del veredicto. Se añade siempre el registro completo como último punto.
 */
export function withFullWindow(out: AnalyzeOut): AnalyzeOut {
  const ws = out.horizon.windows;
  const last = ws[ws.length - 1];
  if (last && last.n >= out.mk.n) return out;
  const years = Math.round(out.spanYears * 10) / 10;
  if (last && years <= last.years) return out;
  ws.push({ years, n: out.mk.n, p: out.mk.p, pHr: out.mk.pHr, slopeDecade: out.mk.slopeDecade });
  return out;
}

export const engine = {
  version: () => call<string>("version"),
  analyze: (req: AnalyzeRequest) => call<AnalyzeOut>("analyze", req).then(floorHamedRao).then(withFullWindow),
  couple: (req: CoupleRequest, alpha: number) => call<CoupleOut>("couple", { req, alpha }),
};
