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
  server: { port: 5173, strictPort: true },
});
