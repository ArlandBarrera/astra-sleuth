// Geometría de regiones: normalización de longitudes (antimeridiano), límites de las
// APIs y clasificación tierra / océano / costa con la máscara Natural Earth 1:50m.
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { Surface } from "./catalog";

export interface Region {
  kind: "point" | "bbox";
  /** Centro (o punto) en grados. */
  lat: number;
  lon: number;
  /** [oeste, sur, este, norte] cuando kind = "bbox". */
  bbox?: [number, number, number, number];
  surface: Surface;
  /** Nombre opcional (casos de ejemplo). */
  name?: string;
}

/** Lleva cualquier longitud al rango [-180, 180). */
export function normLon(lon: number): number {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Object.is(x, -0) ? 0 : x;
}

export function clampLat(lat: number): number {
  return Math.max(-89.9, Math.min(89.9, lat));
}

export type BboxResult = { ok: true; bbox: [number, number, number, number] } | { ok: false; reason: string };

/**
 * Normaliza un rectángulo dibujado. Rechaza los que cruzan el antimeridiano
 * (las APIs de NASA POWER y ERDDAP no aceptan cajas partidas).
 */
export function normalizeBbox(coords: [number, number][]): BboxResult {
  const lons = coords.map((c) => normLon(c[0]));
  const lats = coords.map((c) => clampLat(c[1]));
  const w = Math.min(...lons);
  const e = Math.max(...lons);
  const s = Math.min(...lats);
  const n = Math.max(...lats);
  // Si el ancho aparente supera 180° el rectángulo cruzó el antimeridiano.
  if (e - w > 180) {
    return { ok: false, reason: "El rectángulo cruza la línea de cambio de fecha (180°). Dibuja una caja a un solo lado." };
  }
  if (e - w < 0.05 || n - s < 0.05) {
    return { ok: false, reason: "El rectángulo es demasiado pequeño. Usa un punto o dibuja un área mayor." };
  }
  return { ok: true, bbox: [w, s, e, n] };
}

export function round(x: number, d = 2): number {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
}
export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "O"}`;
}

export function describeRegion(r: Region): string {
  if (r.kind === "point") return `${fmtLat(r.lat)}, ${fmtLon(r.lon)}`;
  const [w, s, e, n] = r.bbox!;
  return `${fmtLat(s)} a ${fmtLat(n)}, ${fmtLon(w)} a ${fmtLon(e)}`;
}

export const SURFACE_LABEL: Record<Surface, string> = {
  land: "Tierra",
  ocean: "Océano",
  coast: "Costa (tierra y mar)",
};

// ---------------------------------------------------------------- máscara de tierra

let landPromise: Promise<Feature<Polygon | MultiPolygon>> | null = null;

function loadLand(): Promise<Feature<Polygon | MultiPolygon>> {
  if (!landPromise) {
    landPromise = import("world-atlas/land-50m.json").then((m) => {
      const topo = (m.default ?? m) as unknown as Parameters<typeof feature>[0];
      const objects = (topo as unknown as { objects: Record<string, unknown> }).objects;
      const fc = feature(topo, objects.land as Parameters<typeof feature>[1]) as unknown as {
        features?: Feature<Polygon | MultiPolygon>[];
        type: string;
      };
      if (fc.type === "FeatureCollection" && fc.features) {
        const polys: number[][][][] = [];
        for (const f of fc.features) {
          if (f.geometry.type === "Polygon") polys.push(f.geometry.coordinates as number[][][]);
          else polys.push(...(f.geometry.coordinates as number[][][][]));
        }
        return { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: polys } } as Feature<MultiPolygon>;
      }
      return fc as unknown as Feature<Polygon | MultiPolygon>;
    });
  }
  return landPromise;
}

/** Precarga la máscara (no bloquea la interfaz). */
export function preloadLand(): void {
  void loadLand();
}

async function isLand(lon: number, lat: number): Promise<boolean> {
  const land = await loadLand();
  return geoContains(land, [lon, lat]);
}

/**
 * Clasifica un punto o caja. Para un punto mira también un anillo de ±0.3°; para una
 * caja, una rejilla de 5×5 muestras: si hay mezcla, es "costa".
 */
export async function classify(r: Pick<Region, "kind" | "lat" | "lon" | "bbox">): Promise<Surface> {
  const samples: [number, number][] = [];
  if (r.kind === "point") {
    samples.push([r.lon, r.lat]);
    const d = 0.3;
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) samples.push([normLon(r.lon + dx), clampLat(r.lat + dy)]);
  } else {
    const [w, s, e, n] = r.bbox!;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) samples.push([w + ((e - w) * i) / 4, s + ((n - s) * j) / 4]);
  }
  const flags = await Promise.all(samples.map(([x, y]) => isLand(x, y)));
  if (r.kind === "point") {
    const center = flags[0];
    const ring = flags.slice(1);
    if (ring.every((f) => f === center)) return center ? "land" : "ocean";
    return "coast";
  }
  const landShare = flags.filter(Boolean).length / flags.length;
  if (landShare >= 0.85) return "land";
  if (landShare <= 0.15) return "ocean";
  return "coast";
}
