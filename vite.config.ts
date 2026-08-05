import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, mkdirSync } from "node:fs";

export default defineConfig({
  base: "./",
  plugins: [
    solid(),
    tailwindcss(),
    {
      name: "copy-price-data",
      apply: "build",
      closeBundle() {
        mkdirSync("dist/data", { recursive: true });
        copyFileSync("data/latest.json", "dist/data/latest.json");
      },
    },
  ],
});
