import { defineConfig } from "vite";

export default defineConfig({
  // MapLibre v6 resuelve su worker relativo a su propio módulo: no se pre-empaqueta
  // para que en desarrollo la URL apunte al archivo real de node_modules.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1600 },
  server: { port: 5173 },
});
