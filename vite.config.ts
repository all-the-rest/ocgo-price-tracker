import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function stampFetchedAt(raw: string): string {
  const data = JSON.parse(raw);
  data.fetchedAt = new Date().toISOString();
  return JSON.stringify(data, null, 2);
}

export default defineConfig({
  base: "./",
  plugins: [
    solid(),
    tailwindcss(),
    {
      name: "stamp-build-time",
      enforce: "pre",
      apply: "build",
      transform(code, id) {
        if (id.endsWith("data/latest.json")) {
          return stampFetchedAt(code);
        }
      },
    },
    {
      name: "copy-price-data",
      apply: "build",
      closeBundle() {
        mkdirSync("dist/data", { recursive: true });
        writeFileSync(
          "dist/data/latest.json",
          stampFetchedAt(readFileSync("data/latest.json", "utf8"))
        );
      },
    },
  ],
});
