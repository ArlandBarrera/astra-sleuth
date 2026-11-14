// Globo 3D: MapLibre (projection globe) + capas NASA GIBS + dibujo con terra-draw.
import { Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
// MapLibre v6 calcula la URL de su worker en tiempo de ejecución; Vite no puede verla,
// así que se registra de forma explícita (funciona igual en desarrollo y en producción).
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { MaplibreTerradrawControl } from "@watergis/maplibre-gl-terradraw";
import "maplibre-gl/dist/maplibre-gl.css";
import "@watergis/maplibre-gl-terradraw/dist/maplibre-gl-terradraw.css";
import type { Feature } from "geojson";
import { GIBS_CONTEXT } from "../catalog";
import { clampLat, normalizeBbox, normLon, type Region } from "../geo";
import type { Slot } from "../state";

setWorkerUrl(maplibreWorkerUrl);

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const gibsTiles = (layer: string, matrix: string, ext: "png" | "jpeg", time = "default") =>
  `${GIBS}/${layer}/default/${time}/${matrix}/{z}/{y}/{x}.${ext}`;
const ATTR = '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> · Natural Earth';

export const COLORS: Record<Slot, string> = { A: "#005A8D", B: "#C84B31" };

export type BaseLayer = "relief" | "plain";

export interface MapApi {
  setRegions(r: Record<Slot, Region | null>, active: Slot, mode: "single" | "dipole"): void;
  setContext(variableId: string | null): void;
  setBase(b: BaseLayer): void;
  flyTo(r: Region): void;
  fitBoth(a: Region, b: Region): void;
  resize(): void;
}

export interface MapEvents {
  /** El usuario dibujó/eligió una región (ya normalizada). */
  onPick(kind: "point" | "bbox", lat: number, lon: number, bbox?: [number, number, number, number]): void;
  onError(msg: string): void;
}

function style(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    // sin halo atmosférico: estética de papel técnico, nada de glow
    sky: { "atmosphere-blend": 0 },
    sources: {
      relief: {
        type: "raster",
        tiles: [gibsTiles("BlueMarble_ShadedRelief_Bathymetry", "GoogleMapsCompatible_Level8", "jpeg")],
        tileSize: 256,
        maxzoom: 8,
        attribution: ATTR,
      },
      plain: {
        type: "raster",
        tiles: [gibsTiles("OSM_Land_Water_Map", "GoogleMapsCompatible_Level9", "png")],
        tileSize: 256,
        maxzoom: 9,
        attribution: ATTR,
      },
      reference: {
        type: "raster",
        tiles: [gibsTiles("Reference_Features_15m", "GoogleMapsCompatible_Level13", "png")],
        tileSize: 256,
        maxzoom: 13,
      },
      regions: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "paper", type: "background", paint: { "background-color": "#F4F3EF" } },
      { id: "relief", type: "raster", source: "relief", paint: { "raster-saturation": -0.25, "raster-contrast": -0.05 } },
      { id: "plain", type: "raster", source: "plain", layout: { visibility: "none" }, paint: { "raster-brightness-min": 0.45, "raster-saturation": -1 } },
      { id: "reference", type: "raster", source: "reference", paint: { "raster-opacity": 0.55 } },
      {
        id: "region-fill",
        type: "fill",
        source: "regions",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 },
      },
      {
        id: "region-line",
        type: "line",
        source: "regions",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "active"], 2.5, 1.5] },
      },
    ],
  };
}

function markerEl(slot: Slot, active: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = `region-marker${active ? " is-active" : ""}`;
  el.style.setProperty("--c", COLORS[slot]);
  el.textContent = slot;
  el.setAttribute("aria-label", `Región ${slot}`);
  return el;
}

export function createMap(container: HTMLElement, ev: MapEvents): MapApi {
  const map = new MlMap({
    container,
    style: style(),
    center: [-79.5, 9],
    zoom: 1.7,
    minZoom: 0.8,
    maxZoom: 10,
    attributionControl: { compact: true },
    dragRotate: false,
    renderWorldCopies: false,
  });
  map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");

  const draw = new MaplibreTerradrawControl({
    modes: ["render", "point", "rectangle"],
    open: true,
    showDeleteConfirmation: false,
  });
  map.addControl(draw, "top-right");

  // Una tesela de GIBS que falla (500, timeout) no debe ensuciar la consola ni romper nada.
  map.on("error", (e) => {
    if ((e as unknown as { sourceId?: string }).sourceId || (e as unknown as { tile?: unknown }).tile) return;
    console.error(e.error);
  });

  let contextId: string | null = null;
  const markers: Marker[] = [];

  // Al terminar un dibujo: normaliza, avisa y borra la figura de terra-draw
  // (las regiones A/B se dibujan con nuestras propias capas y colores).
  map.on("load", () => {
    const td = draw.getTerraDrawInstance();
    if (!td) return;
    td.on("finish", (id) => {
      const f = td.getSnapshot().find((x) => x.id === id);
      if (!f) return;
      if (f.geometry.type === "Point") {
        const [lon, lat] = f.geometry.coordinates as number[];
        ev.onPick("point", clampLat(lat), normLon(lon));
      } else if (f.geometry.type === "Polygon") {
        const ring = (f.geometry.coordinates as number[][][])[0] as [number, number][];
        const res = normalizeBbox(ring);
        if (res.ok) {
          const [w, s, e, n] = res.bbox;
          ev.onPick("bbox", (s + n) / 2, (w + e) / 2, res.bbox);
        } else ev.onError(res.reason);
      }
      // retirar la figura en el siguiente ciclo para no interferir con terra-draw
      setTimeout(() => {
        try {
          td.removeFeatures([id]);
        } catch {
          /* ya eliminada */
        }
      }, 0);
    });
  });

  // Clic simple en el globo (sin herramienta activa) = elegir punto.
  map.on("click", (e) => {
    const td = draw.getTerraDrawInstance();
    const mode = td?.getMode?.();
    // "static"/"render" = ninguna herramienta de dibujo activa
    if (mode && mode !== "static" && mode !== "render") return;
    ev.onPick("point", clampLat(e.lngLat.lat), normLon(e.lngLat.lng));
  });

  const api: MapApi = {
    setRegions(regions, active, mode) {
      const features: Feature[] = [];
      for (const m of markers) m.remove();
      markers.length = 0;
      const slots: Slot[] = mode === "dipole" ? ["A", "B"] : ["A"];
      for (const slot of slots) {
        const r = regions[slot];
        if (!r) continue;
        const isActive = mode === "dipole" && slot === active;
        if (r.kind === "bbox" && r.bbox) {
          const [w, s, e, n] = r.bbox;
          features.push({
            type: "Feature",
            properties: { color: COLORS[slot], active: isActive },
            geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
          });
        }
        markers.push(new Marker({ element: markerEl(slot, isActive) }).setLngLat([r.lon, r.lat]).addTo(map));
      }
      const apply = () => (map.getSource("regions") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      if (map.isStyleLoaded()) apply();
      else map.once("load", apply);
    },

    setContext(variableId) {
      if (variableId === contextId) return;
      contextId = variableId;
      const apply = () => {
        if (map.getLayer("context")) map.removeLayer("context");
        if (map.getSource("context")) map.removeSource("context");
        if (!variableId) return;
        const c = GIBS_CONTEXT[variableId];
        if (!c) return;
        const maxzoom = +(c.matrix.match(/Level(\d+)/)?.[1] ?? 6);
        map.addSource("context", { type: "raster", tiles: [gibsTiles(c.layer, c.matrix, "png")], tileSize: 256, maxzoom, attribution: ATTR });
        map.addLayer({ id: "context", type: "raster", source: "context", paint: { "raster-opacity": 0.7 } }, "reference");
      };
      if (map.isStyleLoaded()) apply();
      else map.once("load", apply);
    },

    setBase(b) {
      const apply = () => {
        map.setLayoutProperty("relief", "visibility", b === "relief" ? "visible" : "none");
        map.setLayoutProperty("plain", "visibility", b === "plain" ? "visible" : "none");
      };
      if (map.isStyleLoaded()) apply();
      else map.once("load", apply);
    },

    flyTo(r) {
      if (r.kind === "bbox" && r.bbox) {
        const [w, s, e, n] = r.bbox;
        map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 5.5, duration: 900 });
      } else {
        map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 3), duration: 900 });
      }
    },

    fitBoth(a, b) {
      const lons = [a.lon, b.lon];
      const lats = [a.lat, b.lat];
      map.flyTo({
        center: [(lons[0] + lons[1]) / 2, (lats[0] + lats[1]) / 2],
        zoom: Math.abs(lons[0] - lons[1]) > 90 || Math.abs(lats[0] - lats[1]) > 60 ? 1.2 : 2.2,
        duration: 900,
      });
    },

    resize() {
      map.resize();
    },
  };
  return api;
}
