// Statisches Pre-Rendering der SPA (SEO).
//
// Ablauf:
//   1. Client-Build (Vite) → dist/ inkl. dist/data/latest.json
//   2. SSR-Build der App → .ssr-build/ (Solid `renderToString`)
//   3. Für jede Sprache (en → dist/index.html, de → dist/de/index.html) das
//      vorgerenderte Markup in `#root` einsetzen und die SEO-Head-Tags
//      (hreflang, RSS, JSON-LD) sowie Titel/Description/Canonical setzen.
//   4. robots.txt + sitemap.xml schreiben.
//
// Client und SSR teilen sich `BUILD_STAMP`, damit der Footer-„Stand“ und die
// Share-Card-Zeit hydration-stabil sind.
import { build } from "vite";
import solid from "vite-plugin-solid";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SSR_OUT = join(ROOT, ".ssr-build");
const SITE = "https://ocgo-pricing.all-the.rest";
const REPO = "all-the-rest/ocgo-price-tracker";
const RSS = `https://github.com/${REPO}/releases.atom`;

process.env.BUILD_STAMP ??= new Date().toISOString();
const STAMP = process.env.BUILD_STAMP;

const data = JSON.parse(readFileSync(join(ROOT, "data", "latest.json"), "utf8"));
const faq = JSON.parse(readFileSync(join(ROOT, "src", "data", "faq.json"), "utf8"));
const plan = (data.plans ?? [])[0] ?? {
  creditsMonthly: data.monthlyCredit,
  priceMonthly: data.monthlyCost,
};

const META = {
  en: {
    lang: "en",
    title: "OpenCode Go Pricing & Models (2026) — Credit Multiplier & Request Costs",
    description:
      "Live price tracker for OpenCode Go: all models with input/output/cached prices, the monthly credit multiplier and the cost per request — updated daily.",
    ogLocale: "en_US",
    canonical: `${SITE}/`,
  },
  de: {
    lang: "de",
    title: "OpenCode Go Preise & Modelle (2026) — Guthaben-Faktor & Kosten pro Anfrage",
    description:
      "Live-Preis-Tracker für OpenCode Go: alle Modelle mit Input-/Output-/Cache-Preisen, Guthaben-Faktor und Kosten pro Anfrage — täglich aktualisiert.",
    ogLocale: "de_DE",
    canonical: `${SITE}/de/`,
  },
};

function substitute(text) {
  return String(text)
    .replaceAll("{credit}", "$" + plan.creditsMonthly)
    .replaceAll("{cost}", "$" + plan.priceMonthly);
}

function buildJsonLd(lang) {
  const meta = META[lang];
  const name = lang === "de" ? "OpenCode Go Preis-Tracker" : "OpenCode Go Price Tracker";
  const items = (data.models ?? []).map((m, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: m.name,
    // Kanonischer Abschnitt-Anker — Wert aus `src/headings.ts` (HEADING_IDS.prices).
    url: meta.canonical + "#prices",
  }));
  const faqItems = (faq[lang] ?? []).map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: substitute(f.a) },
  }));
  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name,
      url: meta.canonical,
      description: meta.description,
      inLanguage: lang,
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: lang === "de" ? "OpenCode Go Modelle" : "OpenCode Go models",
      itemListElement: items,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems,
    },
  ];
  // `<` escapen, damit ein "</script>" in Daten das Tag nicht schließen kann.
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

function seoHead(lang) {
  const altEn = `${SITE}/`;
  const altDe = `${SITE}/de/`;
  return [
    `<link rel="alternate" hreflang="en" href="${altEn}" />`,
    `<link rel="alternate" hreflang="de" href="${altDe}" />`,
    `<link rel="alternate" hreflang="x-default" href="${altEn}" />`,
    `<link rel="alternate" type="application/rss+xml" title="Changelog (RSS)" href="${RSS}" />`,
    `<script type="application/ld+json">${buildJsonLd(lang)}</script>`,
  ].join("\n    ");
}

function setMeta(html, lang) {
  const meta = META[lang];
  let out = html
    .replace(/<html lang="[^"]*"/, `<html lang="${lang}"`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${meta.title}</title>`);
  const setContent = (attr, key, value) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
    if (re.test(out)) out = out.replace(re, `$1${escaped}$2`);
  };
  setContent("name", "description", meta.description);
  setContent("property", "og:locale", meta.ogLocale);
  setContent("property", "og:title", meta.title);
  setContent("property", "og:description", meta.description);
  setContent("property", "og:url", meta.canonical);
  setContent("name", "twitter:title", meta.title);
  setContent("name", "twitter:description", meta.description);
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${meta.canonical}$2`);
  return out;
}

function writeRobots() {
  writeFileSync(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
  );
}

function writeSitemap() {
  const alternates =
    `<xhtml:link rel="alternate" hreflang="en" href="${SITE}/" />` +
    `<xhtml:link rel="alternate" hreflang="de" href="${SITE}/de/" />` +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/" />`;
  const locs = [`${SITE}/`, `${SITE}/de/`];
  const body = locs
    .map((loc) => `  <url>\n    <loc>${loc}</loc>\n    ${alternates}\n  </url>`)
    .join("\n");
  writeFileSync(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      `${body}\n</urlset>\n`,
  );
}

async function main() {
  // 1) Client-Build (nutzt vite.config.ts, inkl. Data-/Share-Plugins).
  await build({ root: ROOT, logLevel: "info" });

  // 2) SSR-Build der kompletten App.
  rmSync(SSR_OUT, { recursive: true, force: true });
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "error",
    define: { __BUILD_TIME_ISO__: JSON.stringify(STAMP) },
    plugins: [solid({ ssr: true, generate: "ssr" })],
    build: {
      ssr: "src/ssr-entry.tsx",
      outDir: SSR_OUT,
      emptyOutDir: true,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
    },
  });

  const entryFile = readdirSync(SSR_OUT).find((f) => /^ssr-entry\.m?js$/.test(f));
  if (!entryFile) throw new Error(`SSR-Einstieg nicht gefunden in ${SSR_OUT}`);
  const mod = await import(pathToFileURL(join(SSR_OUT, entryFile)).href);
  if (typeof mod.renderApp !== "function") {
    throw new Error("SSR-Bundle exportiert kein renderApp()");
  }

  const template = readFileSync(join(DIST, "index.html"), "utf8");

  const hydrationScript = mod.generateHydrationScript();

  const renderFile = (lang) => {
    let html = setMeta(template, lang);
    html = html.replace("</head>", `    ${hydrationScript}\n    ${seoHead(lang)}\n  </head>`);
    const body = mod.renderApp(META[lang].lang);
    if (!html.includes('<div id="root"></div>')) {
      throw new Error("index.html enthält keinen leeren #root-Container");
    }
    return html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  };

  mkdirSync(join(DIST, "de"), { recursive: true });
  writeFileSync(join(DIST, "index.html"), renderFile("en"));
  writeFileSync(join(DIST, "de", "index.html"), renderFile("de"));

  writeRobots();
  writeSitemap();

  rmSync(SSR_OUT, { recursive: true, force: true });

  const enBytes = readFileSync(join(DIST, "index.html"), "utf8").length;
  const deBytes = readFileSync(join(DIST, "de", "index.html"), "utf8").length;
  console.log(
    `[prerender] en=${enBytes}B de=${deBytes}B · robots.txt + sitemap.xml · Stand ${STAMP}`,
  );
}

main().catch((err) => {
  console.error(`[prerender] FEHLER: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
