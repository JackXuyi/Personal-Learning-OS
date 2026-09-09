import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev server port (matches devUrl in src-tauri/tauri.conf.json)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // shadcn/ui 生成层（src/components/ui、src/lib/utils）使用 @/* alias；业务代码仍相对导入
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
