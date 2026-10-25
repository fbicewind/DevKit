import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "safari15",
    minify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            "codemirror",
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/lang-json",
          ],
        },
      },
    },
  },
});
