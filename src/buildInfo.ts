declare const __BUILD_TIME_ISO__: string | undefined;

/**
 * Gemeinsamer Build-Zeitstempel für Client UND Prerender/SSR.
 *
 * Er kommt per Vite-`define` aus `vite.config.ts` und wird von
 * `scripts/prerender.mjs` einmalig über `process.env.BUILD_STAMP` gesetzt.
 * Dadurch rendern Server und Client exakt denselben Wert (der Footer-„Stand“
 * und die Share-Card-Zeit sind damit hydration-stabil) — anders als ein pro
 * Build neu erzeugter `data.fetchedAt`-Stempel.
 */
export const BUILD_TIME_ISO: string =
  typeof __BUILD_TIME_ISO__ !== "undefined" ? __BUILD_TIME_ISO__ : new Date().toISOString();
