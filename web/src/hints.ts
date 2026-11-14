// Micro-acciones 1 y 2 de contexto.md, resueltas con reglas físicas explícitas
// (deterministas, sin IA generativa): pista de hipótesis y región contraparte.
import type { Region } from "./geo";
import { normLon } from "./geo";

interface Box {
  s: number;
  n: number;
  w: number;
  e: number;
}
const inBox = (r: Region, b: Box) => r.lat >= b.s && r.lat <= b.n && r.lon >= b.w && r.lon <= b.e;

const PANAMA: Box = { s: 6, n: 10.5, w: -83.5, e: -77 };
const GULF_PANAMA: Box = { s: 6.5, n: 9.2, w: -80.5, e: -78 };
const SAHEL: Box = { s: 10, n: 20, w: -18, e: 38 };
const AMAZON: Box = { s: -15, n: 5, w: -75, e: -45 };
const MIDWEST: Box = { s: 37, n: 49, w: -104, e: -80 };
const NINO34: Box = { s: -5, n: 5, w: -170, e: -120 };

export function hypothesis(r: Region): string {
  if (inBox(r, GULF_PANAMA) && r.surface !== "land")
    return "De enero a marzo los vientos alisios empujan el agua superficial del Golfo de Panamá y sube agua fría y rica en nutrientes (afloramiento). Prueba la temperatura del mar o la clorofila solo en JFM.";
  if (inBox(r, PANAMA))
    return "Panamá vive el efecto de El Niño: en años Niño suele llover menos y el Canal tiene menos agua. Compara la lluvia de aquí con la costa de Perú en Modo Dipolo.";
  if (r.lat >= 60)
    return "Las regiones polares se calientan más rápido que el promedio del planeta (amplificación ártica). Mide la temperatura del aire y compárala con una región tropical.";
  if (r.lat <= -60) return "La Antártida responde de forma distinta en su costa y en su interior. Revisa si la tendencia cambia según la estación (DJF frente a JJA).";
  if (inBox(r, SAHEL) && r.surface !== "ocean")
    return "El Sahel sufrió sequías fuertes en los años 70 y 80 y luego una recuperación parcial de lluvias. Busca un salto brusco con la prueba de Pettitt en la precipitación.";
  if (inBox(r, AMAZON) && r.surface !== "ocean")
    return "En la Amazonía la deforestación y las sequías pueden secar el suelo. Compara precipitación con humedad del suelo: ¿siguen moviéndose juntas?";
  if (inBox(r, MIDWEST))
    return "En el norte de EE. UU. el humo de incendios lejanos (Canadá, 2023) puede oscurecer el cielo en verano. Prueba aerosoles (AOD) en JJA junto con la radiación solar.";
  if (inBox(r, NINO34)) return "Estás en la región Niño 3.4, el termómetro de El Niño. Su temperatura del mar cambia mucho de un año a otro: revisa cuántos años hacen falta para ver una tendencia.";
  if (Math.abs(r.lat) < 23.5)
    return r.surface === "ocean"
      ? "En el océano tropical, El Niño y La Niña cambian la temperatura cada 2 a 7 años. ¿La tendencia sobrevive a esa variación natural?"
      : "En el trópico la estación de lluvias marca el año. Filtra por estación para ver si la temporada seca o la lluviosa cambian más.";
  return r.surface === "ocean"
    ? "En latitudes medias el mar guarda calor de un verano al siguiente. Compara el verano con el invierno de tu hemisferio."
    : "En latitudes medias, el verano y el invierno pueden cambiar a ritmos distintos. Analiza JJA y DJF por separado.";
}

/** Región B sugerida para el Modo Dipolo, con su justificación. */
export function counterpart(a: Region): { lat: number; lon: number; name: string; why: string } {
  if (inBox(a, PANAMA))
    return { lat: -5.2, lon: -80.63, name: "Piura, costa norte de Perú", why: "Con El Niño, Panamá tiende a secarse mientras la costa norte de Perú recibe lluvias extremas: es un dipolo clásico." };
  if (a.lat >= 60)
    return { lat: 13.5, lon: 2.1, name: "Niamey, Sahel", why: "Comparar el Ártico con el Sahel muestra cómo el calentamiento no es igual en todas las latitudes." };
  if (inBox(a, SAHEL))
    return { lat: 78.2, lon: 15.6, name: "Svalbard, Ártico", why: "El Ártico es la región que más rápido se calienta: un buen contraste con el Sahel." };
  if (inBox(a, NINO34))
    return { lat: -5, lon: 120, name: "Pacífico occidental (Indonesia)", why: "El Niño enfría el Pacífico occidental cuando calienta el oriental: forman los dos polos de la oscilación." };
  if (Math.abs(a.lat) < 23.5)
    return { lat: a.lat, lon: normLon(a.lon + 150), name: "Misma latitud, otra cuenca", why: "Misma latitud pero lejos en longitud: si ambas cambian igual, la causa es más global que local." };
  return { lat: -a.lat, lon: a.lon, name: "Hemisferio opuesto", why: "Mismo meridiano en el otro hemisferio: las estaciones están invertidas, útil para separar efectos estacionales." };
}
