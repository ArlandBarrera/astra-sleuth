// Traducción mínima: cada texto se escribe junto a su versión en inglés (L("es", "en")).
// Sin claves ni archivos aparte: el texto vive donde se usa y la interfaz se vuelve a
// renderizar cuando cambia `state.lang`.
import { getState, type Lang } from "./state";

export const lang = (): Lang => getState().lang;

/** Devuelve el texto en el idioma activo. */
export function L(es: string, en: string): string {
  return getState().lang === "en" ? en : es;
}

/** Locale para números y fechas. */
export const locale = (): string => (getState().lang === "en" ? "en-US" : "es");

/** Separador decimal del idioma activo ("0,05" frente a "0.05"). */
export const dec = (s: string): string => (getState().lang === "en" ? s : s.replace(".", ","));
