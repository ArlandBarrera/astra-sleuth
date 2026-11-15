// Dispatch each variable to POWER, ERDDAP, or CSV and cache the result.
//
// Three cache layers, from fastest to slowest:
//   1) memory, 2) localStorage with TTL, 3) network with shared in-flight requests.
import { getVar, sourceLabel, startYearOf, type Variable } from "../catalog";
import type { Region } from "../geo";
import { fetchErddap } from "./erddap";
import { shared } from "./https";
import { fetchPower } from "./power";
import { isMonthlySeries, sliceYears, type MonthlySeries } from "./series";
import { storeGet, storeSet } from "./store";

export interface FetchOpts {
  y0: number;
  y1: number;
  chlSensor: "viirs" | "modis";
  aodSource: "power" | "csv";
}

// ---------- Cache ----------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MEMORY_TTL = HOUR;
const TTL_POWER = 7 * DAY;
const TTL_ERDDAP = 3 * DAY;
/** Current-year ranges can gain new months, so they use a shorter TTL. */
const TTL_CURRENT_YEAR = DAY;

function ttlFor(base: number, y1: number): number {
  return y1 >= new Date().getFullYear() ? Math.min(base, TTL_CURRENT_YEAR) : base;
}

const memory = new Map<string, { exp: number; s: MonthlySeries }>();

function recall(key: string): MonthlySeries | null {
  const m = memory.get(key);
  if (m && m.exp > Date.now()) return m.s;
  memory.delete(key);
  const stored = storeGet(key);
  if (isMonthlySeries(stored)) {
    memory.set(key, { exp: Date.now() + MEMORY_TTL, s: stored });
    return stored;
  }
  return null;
}

function remember(key: string, s: MonthlySeries, ttlMs: number): void {
  memory.set(key, { exp: Date.now() + MEMORY_TTL, s });
  storeSet(key, s, ttlMs);
}

function regionKey(r: Region): string {
  return r.kind === "point" ? `p${r.lat.toFixed(3)},${r.lon.toFixed(3)}` : `b${r.bbox!.map((x) => x.toFixed(3)).join(",")}`;
}

/** Only options affecting the variable belong in the cache key. */
function cacheKey(v: Variable, region: Region, y0: number, o: FetchOpts): string {
  const extra = v.id === "CHLOR_A" ? o.chlSensor : v.id === "AOD" ? o.aodSource : "";
  return `${v.id}|${regionKey(region)}|${y0}|${o.y1}|${extra}`;
}

// ---------- Fuentes ----------

/** Effective POWER code for a variable; AOD can use the MERRA-2 fallback. */
function powerCode(v: Variable, o: FetchOpts): string | null {
  if (v.source === "power") return v.api_code ?? v.id;
  if (v.id === "AOD" && o.aodSource === "power" && v.fallback) return v.fallback.api_code;
  return null;
}

/** Variables that require a user-provided CSV because no REST API is available. */
export function needsCsv(id: string, o: Pick<FetchOpts, "aodSource">): boolean {
  const v = getVar(id);
  return v.source === "giovanni" && !(v.id === "AOD" && o.aodSource === "power");
}

/** Resolve ERDDAP configuration and fail clearly when the catalog is incomplete. */
function erddapRequest(v: Variable, o: FetchOpts) {
  if (v.id === "CHLOR_A" && v.sensors) {
    const s = v.sensors[o.chlSensor];
    if (!s) throw new Error(`${v.name_es}: no configuration exists for sensor "${o.chlSensor}".`);
    return { host: s.erddap_host, dataset: s.dataset_id, variable: s.api_code, startYm: s.start, endYm: s.end };
  }
  const missing = (["erddap_host", "dataset_id", "api_code"] as const).filter((k) => !v[k]);
  if (missing.length) {
    throw new Error(`${v.name_es}: ERDDAP configuration is incomplete in the catalog (missing ${missing.join(", ")}).`);
  }
  return { host: v.erddap_host!, dataset: v.dataset_id!, variable: v.api_code!, startYm: v.start ?? "1981-01" };
}

// ---------- API ----------

interface Job {
  id: string;
  v: Variable;
  y0: number;
  key: string;
}

export async function getSeries(
  ids: string[],
  region: Region,
  o: FetchOpts,
  csv: Record<string, MonthlySeries | undefined>,
  signal?: AbortSignal,
): Promise<Record<string, MonthlySeries>> {
  const results = new Map<string, MonthlySeries>();
  const erddapJobs: Job[] = [];
  const powerJobs: (Job & { code: string })[] = [];

  // Pass 1: classify and validate without touching the network.
  for (const id of ids) {
    const v = getVar(id);
    const y0 = Math.max(o.y0, startYearOf(v, o));

    if (needsCsv(id, o)) {
      const s = csv[id];
      if (!s) {
        throw new Error(`${v.name_es}: NASA Giovanni has no direct API. Load the CSV exported from Giovanni or choose the MERRA-2 source.`);
      }
      results.set(id, sliceYears(s, y0, o.y1));
      continue;
    }
    if (csv[id]) {
      // A user-provided CSV can replace a remote source, for example when ERDDAP is unavailable.
      results.set(id, sliceYears(csv[id]!, y0, o.y1));
      continue;
    }

    const key = cacheKey(v, region, y0, o);
    const hit = recall(key);
    if (hit) {
      results.set(id, hit);
      continue;
    }

    const code = powerCode(v, o);
    if (code) powerJobs.push({ id, v, y0, key, code });
    else {
      erddapRequest(v, o); // Validate now; the request is rebuilt in pass 2.
      erddapJobs.push({ id, v, y0, key });
    }
  }

  // Pass 2: launch all network work in parallel; ./https.ts enforces host limits.
  const tasks: Promise<void>[] = [];

  for (const job of erddapJobs) {
    tasks.push(
      shared(
        job.key,
        async (sig) => {
          const s = await fetchErddap(erddapRequest(job.v, o), region, job.y0, o.y1, sourceLabel(job.v, o), sig);
          remember(job.key, s, ttlFor(TTL_ERDDAP, o.y1));
          return s;
        },
        signal,
      ).then((s) => {
        results.set(job.id, s);
      }),
    );
  }

  if (powerJobs.length) {
    // In point mode, POWER returns all variables in one GET request.
    const codes = [...new Set(powerJobs.map((j) => j.code))].sort();
    const y0 = Math.min(...powerJobs.map((j) => j.y0));
    const batchKey = `power|${regionKey(region)}|${codes.join(",")}|${y0}|${o.y1}`;
    tasks.push(
      shared(
        batchKey,
        async (sig) => {
          const raw = await fetchPower(codes, region, y0, o.y1, sourceLabel(powerJobs[0].v, o), sig);
          const byId: Record<string, MonthlySeries> = {};
          for (const j of powerJobs) {
            const full = raw[j.code];
            if (!full) throw new Error(`NASA POWER did not return ${j.code}.`);
            const s = sliceYears(full, j.y0, o.y1);
            s.sourceLabel = sourceLabel(j.v, o);
            remember(j.key, s, ttlFor(TTL_POWER, o.y1));
            byId[j.id] = s;
          }
          return byId;
        },
        signal,
      ).then((byId) => {
        for (const [id, s] of Object.entries(byId)) results.set(id, s);
      }),
    );
  }

  await Promise.all(tasks);

  // Return results in the same order as requested.
  const out: Record<string, MonthlySeries> = {};
  for (const id of ids) {
    const s = results.get(id);
    if (s) out[id] = s;
  }
  return out;
}
