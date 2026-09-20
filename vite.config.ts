import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Einmaliger Build-Stempel für Client UND SSR. `scripts/prerender.mjs` setzt
// `BUILD_STAMP` vor beiden Builds; läuft Vite direkt (`pnpm dev`/Tests), wird
// ersatzweise der Startzeitpunkt verwendet.
const buildTimeIso = process.env.BUILD_STAMP ?? new Date().toISOString();

function stampFetchedAt(raw: string): string {
  const data = JSON.parse(raw);
  data.fetchedAt = buildTimeIso;
  return JSON.stringify(data, null, 2);
}

export default defineConfig({
  // Absolute Basis: die Sprach-Subroute `/de/` ist eine verschachtelte
  // HTML-Datei — relative `./assets/…`-Pfade würden dort brechen.
  base: "/",
  define: {
    __BUILD_TIME_ISO__: JSON.stringify(buildTimeIso),
  },
  plugins: [
    // `ssr: true` aktiviert für den CLIENT-Build die hydratationsfähige
    // DOM-Ausgabe (`generate: "dom", hydratable: true`) — Voraussetzung für
    // `hydrate()` im Browser. Für den SSR-Build (scripts/prerender.mjs) wird
    // derselbe Schalter verwendet, dort greift automatisch `generate: "ssr"`.
    solid({ ssr: true }),
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
