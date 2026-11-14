# CLAUDE.md — Earth Sleuth Orbis (NASA Space Apps)

## 1. Misión del Producto y Flujo Central
Herramienta web científica **100% global** (con casos insignia nacidos en **Panamá** y el caso oficial del Dr. James Acker en **Wisconsin**) para investigar tendencias multidecadales en datos de observación terrestre de la NASA/NOAA.

La experiencia sigue estrictamente los **5 pasos del reto**:
1. **Variable(s):** Elegir las variables del archivo variables.json (básicas y especializadas) con definiciones simples.
2. **Región:** Seleccionar punto o Bounding Box en un **Globo 3D global**, en modo **1 Región** o **2 Regiones (Dipolo A vs. B)**.
3. **Periodo & Estación:** Series mensuales multidecadales (`1981–2026` o `2002–2026`), con filtro opcional de estación específica (`ALL`, `JFM`, `MAM`, `JJA`, `SON`, `DJF`).
4. **Serie Temporal & Acoplamiento:** Valores crudos, anomalías desestacionalizadas, *Significance Horizon* y *Regime Decoupling Plot* (pares físicos).
5. **Significancia Estadística:** Veredicto determinístico calculado en **Rust → WebAssembly** dentro de un **Web Worker**.

---

## 2. Stack Tecnológico Obligatorio (Cero Bloat)
- **Frontend:** TypeScript + Vite + Tailwind CSS (o CSS Variables estrictas).
- **Globo 3D & GIS:** `maplibre-gl` (v5+) usando `projection: { type: 'globe' }` + `@watergis/maplibre-gl-terradraw` + `maplibre-gl-nasa-earthdata` (capas NASA GIBS WMTS).
  - *Regla crítica MapLibre:* En MapLibre v5 el globo se activa con `style.projection = { type: 'globe' }` (NO usar la sintaxis string `'globe'` de Mapbox).
  - *Fix Antimeridiano:* Al usar `terra-draw`, normalizar longitudes al rango `[-180, 180]` y limitar dibujo a punto o polígono/rectángulo regional.
- **Gráficas Científicas:**
  - `uPlot` para series temporales (maneja valores negativos de anomalías nativamente en `bands` de intervalo de confianza 95% y `cursor.sync` para sincronizar Región A y Región B en Modo Dipolo). **NO usar Apache ECharts** para bandas con valores negativos.
  - `@observablehq/plot` (SVG vectorial exportable) para el **Regime Decoupling Plot** y la curva **Significance Horizon**.
- **Motor Estadístico:** Crate de **Rust** compilado a `wasm32-unknown-unknown` con `wasm-bindgen`, ejecutado siempre en un **Web Worker** para mantener la UI a 60 FPS.

---

## 3. Estándar Visual: "NASA JPL Telemetry & Swiss Field Manual" (ANTI-AI SLOP)

### Prohibiciones Estrictas de UI
- **PROHIBIDO:** Temas oscuros con gradientes morados/azules/neón, efectos *glow/bloom*, o *glassmorphism* (`backdrop-filter: blur`).
- **PROHIBIDO:** Tarjetas con `border-radius >= 8px` o sombras difusas (`box-shadow`).
- **PROHIBIDO:** Emojis en la interfaz analítica, KPI cards genéricas de 4 columnas arriba, o chats flotantes abiertos.
- **PROHIBIDO:** Paletas rojo/verde puras (inaccesibles para daltonismo).

A considerar: Asegurate de cumplir que la pagina la pueda entender un estudiante de secundaria y que tambien sea para cientificos.
