/// <reference lib="webworker" />
// Web Worker: carga el motor Rust → WASM una sola vez y responde peticiones.
// Así los cálculos O(n²) de Mann-Kendall nunca bloquean la interfaz.
import init, { analyze, couple, engine_version } from "../wasm/pkg/trend_wasm.js";

const ready: Promise<string> = init().then(() => engine_version());

type Msg =
  | { id: number; kind: "version" }
  | { id: number; kind: "analyze"; payload: unknown }
  | { id: number; kind: "couple"; payload: { req: unknown; alpha: number } };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    const version = await ready;
    let result: unknown;
    if (msg.kind === "version") result = version;
    else if (msg.kind === "analyze") result = analyze(msg.payload);
    else result = couple(msg.payload.req, msg.payload.alpha);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: msg.id, ok: true, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: msg.id, ok: false, error });
  }
};
