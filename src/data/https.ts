// Common HTTP layer for POWER, ERDDAP, and any other source:
// - Actual timeout per attempt (also covers reading the response body)
// - Retries with exponential backoff + jitter, respecting the Retry-After header
// - Concurrency limits and minimum request pacing per host
// - Deduplication of identical in-flight requests (with cancellation based on subscriber count)

// Errors

export type HttpErrorKind = "network" | "timeout" | "http" | "parse";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  kind: HttpErrorKind;
  status?: number;
  detail?: string;
  retryAfterMs?: number;

  constructor(message: string, kind: HttpErrorKind, extra: { status?: number; detail?: string; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "HttpError";
    this.kind = kind;
    this.status = extra.status;
    this.detail = extra.detail;
    this.retryAfterMs = extra.retryAfterMs;
  }

  get retryable(): boolean {
    return this.kind === "http" ? RETRYABLE_STATUS.has(this.status ?? 0) : this.kind === "network" || this.kind === "timeout";
  }
}

export function abortError(): DOMException {
  return new DOMException("Operation cancelled.", "AbortError");
}

// Utilities

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  return Number.isNaN(when) ? undefined : Math.max(0, when - Date.now());
}

function extractDetail(text: string): string {
  try {
    const j = JSON.parse(text) as { messages?: unknown; header?: unknown; message?: unknown; error?: unknown };
    if (Array.isArray(j.messages) && j.messages.length) return j.messages.map(String).join(" ");
    for (const k of [j.header, j.message, j.error]) if (typeof k === "string" && k) return k;
  } catch {
    /* it wasn't a JSON */
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

// Limit by host

interface Waiter {
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
  start(delayMs: number): void;
}

class Gate {
  private active = 0;
  private waiters: Waiter[] = [];
  private nextStart = 0;
  private max: number;
  private gapMs: number;

  constructor(max: number, gapMs: number) {
    this.max = max;
    this.gapMs = gapMs;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.enter(signal);
    try {
      return await fn();
    } finally {
      this.active--;
      this.pump();
    }
  }

  private enter(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const finish = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const w: Waiter = {
        started: false,
        start: (delay) => {
          w.started = true;
          if (delay <= 0) finish();
          else w.timer = setTimeout(finish, delay);
        },
      };
      const onAbort = () => {
        if (w.started) {
          clearTimeout(w.timer);
          this.active--;
          this.pump();
        } else {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1);
        }
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(w);
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.max && this.waiters.length) {
      const w = this.waiters.shift()!;
      this.active++;
      const now = Date.now();
      const startAt = Math.max(now, this.nextStart);
      this.nextStart = startAt + this.gapMs;
      w.start(startAt - now);
    }
  }
}


export interface HostLimits {
  /** Maximum simultaneous requests to the host. */
  concurrency: number;

  /** Minimum separation between request starts, in ms. */
  gapMs: number;
}

const DEFAULT_LIMITS: HostLimits = { concurrency: 2, gapMs: 200 };
const hostLimits = new Map<string, HostLimits>();
const gates = new Map<string, Gate>();

/** Adjusts the limits of a host (e.g. if an API documents a different maximum). */
export function configureHost(host: string, limits: Partial<HostLimits>): void {
  hostLimits.set(host, { ...DEFAULT_LIMITS, ...hostLimits.get(host), ...limits });
  gates.delete(host);
}

function gateFor(host: string): Gate {
  let g = gates.get(host);
  if (!g) {
    const l = hostLimits.get(host) ?? DEFAULT_LIMITS;
    g = new Gate(l.concurrency, l.gapMs);
    gates.set(host, g);
  }
  return g;
}

// ---------- fetchJson ----------

export interface FetchJsonOptions {
  /** Nombre legible del servicio para los mensajes de error ("NASA POWER"). */
  service: string;
  signal?: AbortSignal;
  /** Timeout per attempt, including connection and response-body reading. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Reintentos adicionales tras el primer intento. Por defecto 3. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

async function attemptOnce(url: string, service: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw abortError();
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  const timeoutError = () => new HttpError(`${service} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`, "timeout");

  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch {
      if (timedOut) throw timeoutError();
      if (signal?.aborted) throw abortError();
      throw new HttpError(`Could not connect to ${service}. Check your internet connection.`, "network");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = extractDetail(text);
      const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
      const retryable = RETRYABLE_STATUS.has(res.status);
      const msg = retryable
        ? `${service} is temporarily unavailable (HTTP ${res.status}).`
        : `${service} rejected the request: ${detail || `HTTP ${res.status}`}`;
      throw new HttpError(msg, "http", { status: res.status, detail, retryAfterMs });
    }

    try {
      return (await res.json()) as unknown;
    } catch {
      if (timedOut) throw timeoutError();
      if (signal?.aborted) throw abortError();
      throw new HttpError(`${service} returned a response that is not valid JSON.`, "parse");
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * GET with timeout, retries with backoff, and per-host rate limiting.
 * Returns `unknown`; callers must validate the response shape.
 * User cancellation is propagated as AbortError and is never retried.
 */
export async function fetchJson(url: string, opts: FetchJsonOptions): Promise<unknown> {
  const { service, signal, timeoutMs = 30_000, retries = 3, baseDelayMs = 800, maxDelayMs = 15_000 } = opts;
  const gate = gateFor(new URL(url).host);

  for (let attempt = 0; ; attempt++) {
    try {
      return await gate.run(() => attemptOnce(url, service, timeoutMs, signal), signal);
    } catch (e) {
      if (isAbort(e) || !(e instanceof HttpError) || !e.retryable || attempt >= retries) throw e;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * (0.5 + Math.random() * 0.5);
      const wait = e.retryAfterMs !== undefined ? Math.min(e.retryAfterMs, 60_000) : backoff;
      await sleep(wait, signal);
    }
  }
}

// ---------- In-flight request deduplication ----------

interface Flight {
  promise: Promise<unknown>;
  ctrl: AbortController;
  subs: number;
}

const flights = new Map<string, Flight>();

/**
 * If a request with the same key is already running, share its promise.
 * The underlying request is cancelled only when ALL subscribers cancel,
 * so aborting one view does not break another view waiting for the same data.
 */
export function shared<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let flight = flights.get(key);
  if (!flight || flight.ctrl.signal.aborted) {
    const ctrl = new AbortController();
    const created: Flight = { promise: undefined as unknown as Promise<unknown>, ctrl, subs: 0 };
    created.promise = loader(ctrl.signal);
    const cleanup = () => {
      if (flights.get(key) === created) flights.delete(key);
    };
    created.promise.then(cleanup, cleanup);
    flights.set(key, created);
    flight = created;
  }

  const f = flight;
  f.subs++;
  return new Promise<T>((resolve, reject) => {
    const detach = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      f.subs--;
      if (f.subs <= 0) f.ctrl.abort();
      reject(abortError());
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    f.promise.then(
      (v) => {
        detach();
        resolve(v as T);
      },
      (e) => {
        detach();
        reject(e);
      },
    );
  });
}
