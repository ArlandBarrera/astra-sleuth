# Earth Sleuth Orbis

Herramienta web para investigar tendencias multidecadales en datos de observación
terrestre de NASA y NOAA, siguiendo los 5 pasos del reto (ver `contexto.md` y `CLAUDE.md`).

## Uso rápido (Linux, macOS, Windows)

Solo necesitas Node.js >= 20.19 (o >= 22.12) y npm. El WebAssembly ya viene compilado
en `src/wasm/pkg`, así que **no hace falta Rust** para ejecutar la app.

```bash
# EndeavourOS / Arch:  sudo pacman -S nodejs npm
npm install
npm run dev          # http://localhost:5173
```

Si copiaste la carpeta desde otro sistema operativo, borra primero `node_modules`
(contiene binarios nativos específicos de cada sistema): `rm -rf node_modules && npm install`.

## Producción

```bash
npm run build        # typecheck + build en dist/ (no requiere Rust)
npm run preview      # sirve dist/ en http://localhost:4173
```

`dist/index.html` no funciona abriéndolo con doble clic (`file://`): usa `npm run preview`.

## Recompilar el motor Rust (opcional)

Solo si modificas `engine/`:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130   # debe coincidir con engine/Cargo.lock
npm run build:full   # Rust → WASM + typecheck + build
npm run test:engine  # pruebas de Rust
```

## Correcciones (depuración, nov 2026)

- **Mapa:** el rectángulo del área, la capa NASA GIBS y el cambio de mapa base podían no
  aparecer nunca si se pedían mientras el globo descargaba teselas (`isStyleLoaded()` es
  falso durante la carga y el evento `load` no se repite). Los clics fuera del globo ya no
  eligen un punto del horizonte. El encuadre de dos regiones respeta el antimeridiano.
- **Análisis:** un análisis viejo (p. ej. al pulsar dos casos de ejemplo seguidos) ya no
  puede sobrescribir al más reciente.
- **NASA POWER:** si la API rechaza el año en curso (la meteorología mensual llega "hasta el
  año anterior"), se repite la consulta sin él. Las cajas cerca de los polos o de ±180° se
  desplazan en vez de recortarse por debajo de 2°.
- **Estadística:** el factor de Hamed y Rao se acota en ≥ 1. Con ruido blanco la corrección
  encogía la varianza y daba más falsos positivos (≈ 9 %) que la prueba sin corregir.
  Aplicado en `src/engine/client.ts` sobre el WASM incluido y en `engine/mann_kendall`
  (al recompilar con `npm run build:full` el resultado es idéntico).
- **Significance Horizon:** la curva siempre incluye el registro completo (antes podía
  terminar unos meses antes y contradecir el veredicto); el texto ya no dice "ninguna
  ventana alcanza p < 0,05" cuando algunas ventanas recientes sí lo hacen.
- **CSV:** se aceptan archivos de Excel en español (`;` y coma decimal) y valores entre
  comillas; si el CSV no trae unidades se usan las de la variable.
- **Textos:** los nombres de estación seca/lluviosa de Panamá ya no se aplican a todo el
  trópico; el dossier rotula correctamente "valores crudos"; el año en curso ya no está
  fijo en 2026.
- **Interfaz:** los desplegables abiertos y las coordenadas escritas no se pierden al
  actualizarse el panel; etiquetas de las gráficas sin recortes ni solapes.

## Estructura

```
variables.json            fuente única de verdad de las variables (la interfaz la lee directamente)
engine/
  mann_kendall/           librería original (sin cambios): MK, Hamed-Rao, Sen, Seasonal MK, Pettitt
  trend_wasm/             puente wasm-bindgen: analyze() y couple(), con pruebas nativas
scripts/build-wasm.sh     cargo build --target wasm32 + wasm-bindgen --target web
src/
  engine/worker.ts        Web Worker que carga el WASM (la UI nunca se bloquea)
  data/                   NASA POWER (punto y región), NOAA ERDDAP, importación CSV (Giovanni)
  ui/map.ts               globo MapLibre (projection globe) + NASA GIBS + terra-draw
  ui/charts.ts            uPlot: series, banda IC 95 %, quiebre de Pettitt, cursor.sync
  ui/plots.ts             Observable Plot: Significance Horizon y Regime Decoupling (SVG)
  ui/results.ts           pasos 4 y 5, veredicto en 3 líneas, glosario
  ui/dossier.ts           exportación HTML / CSV / JSON
prototipo/                prueba rápida anterior (Chart.js), conservada como referencia
```

## Qué calcula el motor (Rust)

- Limpieza de centinelas (≤ −999 → sin dato) y completitud.
- Anomalías respecto a la climatología mensual del periodo.
- Mann-Kendall sobre anomalías mensuales (o medias por estación y año si se filtra una
  estación), con y sin corrección de Hamed y Rao (1998).
- Pendiente de Sen con IC 95 % (por década), Seasonal Mann-Kendall sobre valores crudos.
- Pettitt (año y mes del quiebre).
- Significance Horizon: p-valor con los últimos 5, 6, … años.
- Años necesarios para detectar la tendencia (Weatherhead et al., 1998).
- Spearman ρ con p (t de Student) para el Modo Dipolo y el acoplamiento por régimen.

## Notas sobre las fuentes

- **NASA POWER**: verificado en vivo. La API regional exige cajas de 2° a 10° por lado y una
  variable por consulta; la app ajusta la caja y lo avisa.
- **AOD**: Giovanni no tiene API REST. Por defecto se usa `AOD_55` (MERRA-2) vía POWER
  (añadido como `fallback` en `variables.json`); la opción "MODIS Giovanni (CSV)" acepta el
  CSV exportado de "Time Series, Area-Averaged".
- **NOAA ERDDAP** (SST, clorofila): dimensiones y variable se descubren en tiempo de
  ejecución desde `/info/<dataset>/index.json`. Si el servidor no responde, la app lo dice y
  permite cargar un CSV propio.
- Las tres micro-acciones de "IA" de `contexto.md` (pista de hipótesis, región contraparte y
  conclusión en 3 líneas) están implementadas con reglas deterministas, sin modelo generativo.
