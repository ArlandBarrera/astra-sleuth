
// Persistent localStorage cache with TTL.
// - Each entry stores its expiration time; expired entries are removed on read.
// - When storage is full, expired entries and then the oldest entries are purged.
// - Failures such as private mode, invalid JSON, or quota limits degrade to no cache.
// Increment NS when the cached data shape changes.

const NS = "series-cache:v1:";

interface Entry {
  exp: number;
  saved: number;
  v: unknown;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // acceso denegado
  }
}

function ownKeys(st: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i);
    if (k && k.startsWith(NS)) keys.push(k);
  }
  return keys;
}

function readEntry(st: Storage, fullKey: string): Entry | null {
  try {
    const raw = st.getItem(fullKey);
    if (!raw) return null;
    const e = JSON.parse(raw) as Partial<Entry> | null;
    if (!e || typeof e.exp !== "number" || typeof e.saved !== "number") return null;
    return e as Entry;
  } catch {
    return null;
  }
}

export function storeGet(key: string): unknown {
  const st = storage();
  if (!st) return null;
  const full = NS + key;
  const e = readEntry(st, full);
  if (!e || e.exp < Date.now()) {
    try {
      st.removeItem(full);
    } catch {
      /* ignorar */
    }
    return null;
  }
  return e.v ?? null;
}

export function storeSet(key: string, value: unknown, ttlMs: number): void {
  const st = storage();
  if (!st) return;
  const now = Date.now();
  const full = NS + key;
  let payload: string;
  try {
    payload = JSON.stringify({ exp: now + ttlMs, saved: now, v: value } satisfies Entry);
  } catch {
    return;
  }
  try {
    st.setItem(full, payload);
    return;
  } catch {
    /* cuota llena: liberar espacio y reintentar */
  }

  const live: { k: string; saved: number }[] = [];
  for (const k of ownKeys(st)) {
    const e = readEntry(st, k);
    if (!e || e.exp < now) st.removeItem(k);
    else live.push({ k, saved: e.saved });
  }
  live.sort((a, b) => a.saved - b.saved);
  for (let i = 0; i <= live.length; i++) {
    try {
      st.setItem(full, payload);
      return;
    } catch {
      const oldest = live[i];
      if (!oldest) return; // no cabe ni vaciando: se renuncia a cachear
      st.removeItem(oldest.k);
    }
  }
}

/** Remove all entries from this cache, for example from a "Refresh data" button. */
export function storeClear(): void {
  const st = storage();
  if (!st) return;
  for (const k of ownKeys(st)) st.removeItem(k);
}
