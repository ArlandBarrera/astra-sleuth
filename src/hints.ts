// Micro-acciones 1 y 2 de contexto.md, resueltas con reglas físicas explícitas
// (deterministas, sin IA generativa): pista de hipótesis y región contraparte.
import type { Region } from "./geo";
import { normLon } from "./geo";
import { L } from "./i18n";

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
    return L(
      "De enero a marzo los vientos alisios empujan el agua superficial del Golfo de Panamá y sube agua fría y rica en nutrientes (afloramiento). Prueba la temperatura del mar o la clorofila solo en JFM.",
      "From January to March the trade winds push surface water out of the Gulf of Panama and cold, nutrient-rich water rises (upwelling). Try sea temperature or chlorophyll in JFM only.",
    );
  if (inBox(r, PANAMA))
    return L(
      "Panamá vive el efecto de El Niño: en años Niño suele llover menos y el Canal tiene menos agua. Compara la lluvia de aquí con la costa de Perú en Modo Dipolo.",
      "Panama feels El Niño: in Niño years it usually rains less and the Canal has less water. Compare rainfall here with the coast of Peru in Dipole mode.",
    );
  if (r.lat >= 60)
    return L(
      "Las regiones polares se calientan más rápido que el promedio del planeta (amplificación ártica). Mide la temperatura del aire y compárala con una región tropical.",
      "Polar regions warm faster than the global average (Arctic amplification). Measure air temperature and compare it with a tropical region.",
    );
  if (r.lat <= -60)
    return L(
      "La Antártida responde de forma distinta en su costa y en su interior. Revisa si la tendencia cambia según la estación (DJF frente a JJA).",
      "Antarctica responds differently on its coast and in its interior. Check whether the trend changes by season (DJF versus JJA).",
    );
  if (inBox(r, SAHEL) && r.surface !== "ocean")
    return L(
      "El Sahel sufrió sequías fuertes en los años 70 y 80 y luego una recuperación parcial de lluvias. Busca un salto brusco con la prueba de Pettitt en la precipitación.",
      "The Sahel suffered severe droughts in the 1970s and 80s, then a partial recovery of rainfall. Look for an abrupt shift with the Pettitt test on precipitation.",
    );
  if (inBox(r, AMAZON) && r.surface !== "ocean")
    return L(
      "En la Amazonía la deforestación y las sequías pueden secar el suelo. Compara precipitación con humedad del suelo: ¿siguen moviéndose juntas?",
      "In the Amazon, deforestation and droughts can dry out the soil. Compare precipitation with soil moisture: do they still move together?",
    );
  if (inBox(r, MIDWEST))
    return L(
      "En el norte de EE. UU. el humo de incendios lejanos (Canadá, 2023) puede oscurecer el cielo en verano. Prueba aerosoles (AOD) en JJA junto con la radiación solar.",
      "In the northern US, smoke from distant fires (Canada, 2023) can darken summer skies. Try aerosols (AOD) in JJA together with solar radiation.",
    );
  if (inBox(r, NINO34))
    return L(
      "Estás en la región Niño 3.4, el termómetro de El Niño. Su temperatura del mar cambia mucho de un año a otro: revisa cuántos años hacen falta para ver una tendencia.",
      "You are in the Niño 3.4 region, El Niño's thermometer. Its sea temperature varies a lot from year to year: check how many years it takes to see a trend.",
    );
  if (Math.abs(r.lat) < 23.5)
    return r.surface === "ocean"
      ? L(
          "En el océano tropical, El Niño y La Niña cambian la temperatura cada 2 a 7 años. ¿La tendencia sobrevive a esa variación natural?",
          "In the tropical ocean, El Niño and La Niña shift temperatures every 2 to 7 years. Does the trend survive that natural variability?",
        )
      : L(
          "En el trópico la estación de lluvias marca el año. Filtra por estación para ver si la temporada seca o la lluviosa cambian más.",
          "In the tropics the rainy season shapes the year. Filter by season to see whether the dry or the rainy season changes more.",
        );
  return r.surface === "ocean"
    ? L(
        "En latitudes medias el mar guarda calor de un verano al siguiente. Compara el verano con el invierno de tu hemisferio.",
        "At mid-latitudes the sea stores heat from one summer to the next. Compare summer with winter in your hemisphere.",
      )
    : L(
        "En latitudes medias, el verano y el invierno pueden cambiar a ritmos distintos. Analiza JJA y DJF por separado.",
        "At mid-latitudes, summer and winter can change at different rates. Analyze JJA and DJF separately.",
      );
}

/** Región B sugerida para el Modo Dipolo, con su justificación. */
export function counterpart(a: Region): { lat: number; lon: number; name: string; name_en: string; why: string } {
  if (inBox(a, PANAMA))
    return {
      lat: -5.2,
      lon: -80.63,
      name: "Piura, costa norte de Perú",
      name_en: "Piura, northern coast of Peru",
      why: L(
        "Con El Niño, Panamá tiende a secarse mientras la costa norte de Perú recibe lluvias extremas: es un dipolo clásico.",
        "During El Niño, Panama tends to dry out while Peru's northern coast gets extreme rain: a classic dipole.",
      ),
    };
  if (a.lat >= 60)
    return {
      lat: 13.5,
      lon: 2.1,
      name: "Niamey, Sahel",
      name_en: "Niamey, Sahel",
      why: L("Comparar el Ártico con el Sahel muestra cómo el calentamiento no es igual en todas las latitudes.", "Comparing the Arctic with the Sahel shows that warming is not equal at every latitude."),
    };
  if (inBox(a, SAHEL))
    return {
      lat: 78.2,
      lon: 15.6,
      name: "Svalbard, Ártico",
      name_en: "Svalbard, Arctic",
      why: L("El Ártico es la región que más rápido se calienta: un buen contraste con el Sahel.", "The Arctic is the fastest-warming region: a good contrast with the Sahel."),
    };
  if (inBox(a, NINO34))
    return {
      lat: -5,
      lon: 120,
      name: "Pacífico occidental (Indonesia)",
      name_en: "Western Pacific (Indonesia)",
      why: L(
        "El Niño enfría el Pacífico occidental cuando calienta el oriental: forman los dos polos de la oscilación.",
        "El Niño cools the western Pacific while it warms the eastern Pacific: they are the two poles of the oscillation.",
      ),
    };
  if (Math.abs(a.lat) < 23.5)
    return {
      lat: a.lat,
      lon: normLon(a.lon + 150),
      name: "Misma latitud, otra cuenca",
      name_en: "Same latitude, another basin",
      why: L(
        "Misma latitud pero lejos en longitud: si ambas cambian igual, la causa es más global que local.",
        "Same latitude but far away in longitude: if both change alike, the cause is more global than local.",
      ),
    };
  return {
    lat: -a.lat,
    lon: a.lon,
    name: "Hemisferio opuesto",
    name_en: "Opposite hemisphere",
    why: L(
      "Mismo meridiano en el otro hemisferio: las estaciones están invertidas, útil para separar efectos estacionales.",
      "Same meridian in the other hemisphere: the seasons are reversed, useful for separating seasonal effects.",
    ),
  };
}
