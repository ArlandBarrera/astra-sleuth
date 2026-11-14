1. Lo que exige el Dr. James Acker (La Rúbrica Real)
El flujo de tu app debe resolver exactamente sus 5 pasos, ni uno más, ni uno menos:
Elegir variable(s): Mezcla de familiares (temperatura, lluvia) y especializadas (humedad del suelo, evapotranspiración, SST, clorofila-a, AOD), con definiciones simples para estudiantes.
Elegir región: Global (Globo 3D en MapLibre + dibujo de punto/área), con soporte para comparar 2 regiones opuestas (Modo Dipolo).
Elegir periodo temporal: Series multidecadales largas (ideal 1981–2026 o mínimo 15–20 años) + opción de aislar una sola estación (ej. Solo Verano JJA o Solo Estación Seca JFM).
Generar y visualizar serie temporal: Valores crudos vs. anomalías desestacionalizadas, mostrando tasa de cambio por década.
Probar significancia estadística: Test de Mann-Kendall + Pendiente de Sen + 
p
p
-valor claro (< 0.05 = significativo; >= 0.05 = tendencia no significativa aún / requiere más años).
2. Reglas Concretas de los Datos
Resolución temporal óptima: Mensual por defecto (es la que el Dr. Acker recomienda por velocidad y limpieza frente a ruido horario/3-horario).
Calidad antes de graficar:
Limpiar valores centinela (ej. -999 de NASA POWER → NaN).
Calcular anomalías mensuales respecto a la media histórica del mes (para no confundir verano/invierno con una tendencia).
Mostrar siempre el % de completitud de datos y advertir si la serie tiene < 15 años.
Fuentes rápidas (Cero fallos en vivo):
NASA POWER API (1981–2026, sin API key, 1 solo GET trae 7 variables juntas).
NOAA/NASA ERDDAP (jplMURSST41mday y nesdisVHNSQchlaMonthly, sin API key en JSON).
NASA Giovanni / MODIS AOD (para el caso de incendios en Wisconsin del Dr. Acker).
Casos Demo en 1 clic (4 botones): Panamá Canal vs. Sudamérica (Dipolo ENSO), Golfo de Panamá Afloramiento (Estación Seca JFM), Wisconsin AOD 2002–2026 (Caso Dr. Acker), y Ártico vs. Sahel.
3. El "Sweet Spot" de Variables (9 + 1)
Organizadas en 3 dominios, filtradas automáticamente según si el usuario hace clic en Tierra o en Océano:
Atmósfera & Energía:
T2M — Temperatura del aire a 2m (°C) (Básica)
CLOUD_AMT — Fracción de nubosidad (0–1) (Básica)
ALLSKY_SFC_SW_DWN — Radiación solar superficial (MJ/m²/día) (Especializada)
+1 Insignia: AOD — Profundidad óptica de aerosoles / humo (MODIS-Aqua)
Tierra, Agua & Criosfera:
4. PRECTOTCORR — Precipitación total corregida (mm/día) (Básica)
5. GWETPROF — Humedad profunda del suelo (0–1) (Especializada)
6. EVPTRNS — Evapotranspiración (MJ/m²/día) (Especializada)
(Auto en zonas frías/montaña): SNODP — Profundidad de nieve (cm)
Océanos & Superficie:
7. analysed_sst — Temperatura superficial del mar (°C, JPL MUR) (Básica)
8. chlor_a — Clorofila-a oceánica (mg/m³, VIIRS/MODIS) (Especializada)
9. WS2M — Velocidad del viento a 2m (m/s) (Intermedia)
4. El Motor Estadístico en Rust → WASM (Su Diferencial Técnico)
Corriendo en un Web Worker para no congelar la UI:
Seasonal Mann-Kendall + opción de filtro por estación única (JFM, JJA, etc.).
Corrección Hamed & Rao (1998) por autocorrelación serial AR(1) (toggle visible en pantalla para comparar 
p
p
-valor crudo vs. 
p
p
-valor corregido).
Sen's Slope + Banda de Confianza 95% (en unidades/década).
Pettitt Test (marca con línea vertical el año exacto de quiebre abrupto).
Significance Horizon: Recalcula el 
p
p
-valor por ventanas retrospectivas (5, 10, 20, 40 años) para estimar cuántos años faltan si hoy aún es p >= 0.05.
En Modo 2 (Dipolo A vs. B): Correlación de Spearman (
ρ
ρ
) entre las anomalías de ambas regiones.
5. UI, MapLibre & IA (Sin Grasa)
Mapa: MapLibre GL JS con projection: { type: 'globe' } + @watergis/maplibre-gl-terradraw (clic o rectángulo) + capas de contexto de NASA GIBS.
Gráficas: uPlot (series temporales + bandas negativas limpias + cursor.sync en Modo Dipolo) + Observable Plot (SVG para Regime Decoupling: Lluvia vs. Humedad de Suelo, Temp vs. Evapotranspiración, SST vs. Clorofila, AOD vs. Radiación).
Estética (design.md): Papel técnico claro (#F4F3EF), bordes 1px, radio 0–2px, fuentes IBM Plex Sans/Mono con tabular-nums, paleta daltónico-segura (#005A8D vs #C84B31), cero gradientes neón.
IA (solo 3 micro-acciones, nunca matemáticas): (1) Sugerir hipótesis al hacer clic en una región, (2) Sugerir región contraparte para Modo Dipolo, y (3) Traducir el JSON estadístico de Rust a una conclusión clara de 3 líneas + Dossier exportable.
