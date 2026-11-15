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
import { L } from "../i18n";
import type { Slot } from "../state";

setWorkerUrl(maplibreWorkerUrl);

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const gibsTiles = (layer: string, matrix: string, ext: "png" | "jpeg", time = "default") =>
  `${GIBS}/${layer}/default/${time}/${matrix}/{z}/{y}/{x}.${ext}`;
const ATTR = '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a> · Natural Earth';

export const COLORS: Record<Slot, string> = { A: "#005A8D", B: "#C84B31" };

export type BaseLayer = "relief" | "plain";

/** Color de la esfera antes de que carguen las teselas (océano de Blue Marble). */
const OCEAN = "#0E2A47";

export interface MapApi {
  setRegions(r: Record<Slot, Region | null>, active: Slot, mode: "single" | "dipole"): void;
  setContext(variableId: string | null): void;
  setBase(b: BaseLayer): void;
  flyTo(r: Region): void;
  fitBoth(a: Region, b: Region): void;
  resize(): void;
  /** Vuelve a poner los textos de la barra de dibujo en el idioma activo. */
  relabel(): void;
}

/** Herramienta de dibujo activa: null = ninguna (clic simple elige un punto). */
export type DrawTool = "point" | "rectangle" | null;

export interface MapEvents {
  /** El usuario dibujó/eligió una región (ya normalizada). */
  onPick(kind: "point" | "bbox", lat: number, lon: number, bbox?: [number, number, number, number]): void;
  onError(msg: string): void;
  /** El usuario activó o desactivó una herramienta de la barra de dibujo. */
  onTool(tool: DrawTool): void;
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
      //adding countries tags support
      labels: {
        type: "raster",
        tiles: [gibsTiles("Reference_Labels", "GoogleMapsCompatible_Level9", "png")],
        tileSize: 256,
        maxzoom: 9,
        attribution: ATTR,
      },
      regions: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      // En proyección globo el fondo pinta la esfera mientras llegan las teselas de GIBS:
      // un tono de océano profundo (como Blue Marble) evita el destello blanco al cargar.
      { id: "paper", type: "background", paint: { "background-color": OCEAN } },
      { id: "relief", type: "raster", source: "relief", paint: { "raster-saturation": -0.25, "raster-contrast": -0.05 } },
      { id: "plain", type: "raster", source: "plain", layout: { visibility: "none" }, paint: { "raster-brightness-min": 0.45, "raster-saturation": -1 } },
      { id: "reference", type: "raster", source: "reference", paint: { "raster-opacity": 0.55 } },
      { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.9 } },
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
  el.setAttribute("aria-label", `${L("Región", "Region")} ${slot}`);
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

  // El globo aparece con un fundido cuando el relieve ya tiene teselas (o a los 4 s como
  // máximo, por si GIBS tarda): así no se ve la esfera vacía mientras carga.
  container.classList.add("is-loading");
  let shown = false;
  const reveal = () => {
    if (shown) return;
    shown = true;
    container.classList.remove("is-loading");
    map.off("sourcedata", onSource);
  };
  const onSource = (e: { sourceId?: string; isSourceLoaded?: boolean; tile?: unknown }) => {
    // `tile` evita disparar con el evento de metadatos, que llega antes que cualquier tesela
    if (e.sourceId === "relief" && e.tile && e.isSourceLoaded) reveal();
  };
  map.on("sourcedata", onSource);
  map.once("idle", reveal);
  window.setTimeout(reveal, 4000);

  const draw = new MaplibreTerradrawControl({
    modes: ["render", "point", "rectangle"],
    open: true,
    showDeleteConfirmation: false,
  });
  map.addControl(draw, "top-right");

  // Textos de la barra de dibujo (la librería los trae en inglés y sin explicar).
  const relabel = () => {
    const set = (cls: string, text: string) => {
      const b = container.querySelector<HTMLButtonElement>(`.${cls}`);
      if (!b) return;
      b.title = text;
      b.setAttribute("aria-label", text);
    };
    set("maplibregl-terradraw-add-point-button", L("Punto: haz clic en el globo para elegir un lugar", "Point: click on the globe to pick a place"));
    set("maplibregl-terradraw-add-rectangle-button", L("Rectángulo: clic en una esquina y clic en la esquina opuesta", "Rectangle: click one corner, then the opposite corner"));
    set("maplibregl-terradraw-render-button", L("Mostrar u ocultar las herramientas de dibujo", "Show or hide the drawing tools"));
  };
  relabel();

  // Aviso al usuario cuando cambia la herramienta activa.
  let tool: DrawTool = null;
  draw.on("mode-changed", (e) => {
    const m = e.mode as string;
    const next: DrawTool = m === "point" ? "point" : m === "rectangle" ? "rectangle" : null;
    if (next === tool) return;
    tool = next;
    container.classList.toggle("is-drawing", !!tool);
    ev.onTool(tool);
  });

  // Una tesela de GIBS que falla (500, timeout) no debe ensuciar la consola ni romper nada.
  map.on("error", (e) => {
    if ((e as unknown as { sourceId?: string }).sourceId || (e as unknown as { tile?: unknown }).tile) return;
    console.error(e.error);
  });

  let contextId: string | null = null;
  const markers: Marker[] = [];

  // parallax movement 
  const sky = container.parentElement!;
  const syncSky = () => {
    const c = map.getCenter();
    const velocity = 70;
    //the bg movemnt is slow than the earth model
    const x = velocity - (c.lng / 360) * 100;
    const y = velocity + (c.lat / 180) * 100;
    sky.style.backgroundPosition = `${x}% ${y}%`;
  };
  map.on("move", syncSky);
  syncSky();

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

    relabel,
  };
  return api;
}
