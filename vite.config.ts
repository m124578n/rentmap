import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

// 一個 Vite 專案同時 build 前端 SPA 與 Worker;`vite dev` 就有本地 D1 模擬。
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/client"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
    },
  },
  // maplibre-gl v6 的 web worker 在 Vite 預打包後載不到(dev 模式圖磚全空),排除掉讓它走原生 ESM
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: { port: 5173, strictPort: true },
});
