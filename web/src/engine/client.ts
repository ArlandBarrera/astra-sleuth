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

export const engine = {
  version: () => call<string>("version"),
  analyze: (req: AnalyzeRequest) => call<AnalyzeOut>("analyze", req),
  couple: (req: CoupleRequest, alpha: number) => call<CoupleOut>("couple", { req, alpha }),
};
