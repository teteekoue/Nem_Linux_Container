import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
  server: {
    host: "0.0.0.0",
  },
});
