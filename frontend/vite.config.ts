import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` proxies the API to a running `hep-pad serve --no-browser`.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../src/heppad/server/static", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
});
