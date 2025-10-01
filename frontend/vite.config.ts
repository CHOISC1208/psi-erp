import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 認証
      "^/(auth)(/|$)": { target: "http://localhost:8000", changeOrigin: true },
      // PSI / セッション / マスター系など、使ってるAPIを全部ここに
      "^/(psi|psi-metrics|sessions|masters|api|warehouses|category-rank-parameters|channel-transfers|psi-edits|users)(/|$)": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
  },
});
