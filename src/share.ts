import type { Capabilities, Model, PeakHours } from "./types";
import { formatReqPerMonth, requestsPerMonth } from "./weighted";
import { PEAK_PRICING_RULES } from "./config/peakPricing";

export type ShareMetric = "requests";
export type ShareSize = "og" | "twitter" | "ig" | "story";
export type ShareTheme = "dark" | "light";

export interface ShareConfig {
  metric: ShareMetric;
  topN: number;
  theme: ShareTheme;
  size: ShareSize;
}

export const SHARE_SIZES: Record<ShareSize, { w: number; h: number; label: string }> = {
  og: { w: 1200, h: 630, label: "OG 1200×630" },
  twitter: { w: 1200, h: 675, label: "Twitter 1200×675" },
  ig: { w: 1080, h: 1350, label: "IG 4:5 1080×1350" },
  story: { w: 1080, h: 1920, label: "Story 9:16 1080×1920" },
};

/** Automatic TopN per preset: landscape OG/Twitter = Top 5, IG portrait 4:5 = Top 10, Story 9:16 = Top 15. */
export const SHARE_TOP_N: Record<ShareSize, number> = { og: 5, twitter: 5, ig: 10, story: 15 };

/** Automatic TopN per preset — no manual selection, rendered live from data/sort. */
export function autoTopN(size: ShareSize): number {
  return SHARE_TOP_N[size];
}

export const DEFAULT_SHARE: ShareConfig = {
  metric: "requests",
  topN: 5,
  theme: "dark",
  size: "og",
};

export type ShareLang = "de" | "en";

/**
 * Dialog strings keyed by the dialog's own language choice (shareLang),
 * deliberately separate from the main UI i18n dict so toggling the page
 * language never overrides an explicit share-language choice.
 * Values mirror the share-* and basis* keys in src/i18n.ts.
 */
export const shareI18n = {
  de: {
    shareTitle: "Top-Modelle teilen",
    shareDesc: "Konfiguriere die Share-Card mit den günstigsten Modellen (TOP-Liste nach Anzahl der Anfragen).",
    shareLang: "Sprache",
    shareTheme: "Stil",
    shareThemeDark: "Dunkel",
    shareThemeLight: "Hell",
    shareSize: "Format",
    sharePreview: "Vorschau",
    sharePreviewCaption: "Gesamt-Anfragen pro Monat je Modell (Live-Stand der Tabelle).",
    shareCopySvg: "SVG kopieren",
    shareDownloadSvg: "SVG laden",
    shareDownloadPng: "PNG laden",
    shareCopyLink: "Link kopieren",
    shareCopied: "In die Zwischenablage kopiert",
    shareClose: "Schließen",
    shareDays: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
    shareDaily: "täglich",
    shareBeijingTz: "Peking-Zeit",
    shareConstraintTpl: "{tier} · {windows} UTC · {scope}",
    shareRulesTpl: "Peak {windows} UTC · {scope} · {weekend} · Peak = 2× Off-Peak",
    shareWeekendOffTpl: "{days} durchgehend Off-Peak",
    shareRulesNoWindows: "Keine Peak-Zeiten dokumentiert (Quellenstand)",
    shareUpdatedTpl: "Stand {datetime} UTC",
  },
  en: {
    shareTitle: "Share top models",
    shareDesc: "Configure the share card with the cheapest models (TOP list by total requests).",
    shareLang: "Language",
    shareTheme: "Style",
    shareThemeDark: "Dark",
    shareThemeLight: "Light",
    shareSize: "Size",
    sharePreview: "Preview",
    sharePreviewCaption: "Total requests per month per model (live table state).",
    shareCopySvg: "Copy SVG",
    shareDownloadSvg: "Download SVG",
    shareDownloadPng: "Download PNG",
    shareCopyLink: "Copy link",
    shareCopied: "Copied to clipboard",
    shareClose: "Close",
    shareDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    shareDaily: "daily",
    shareBeijingTz: "Beijing time",
    shareConstraintTpl: "{tier} · {windows} UTC · {scope}",
    shareRulesTpl: "Peak {windows} UTC · {scope} · {weekend} · peak = 2× off-peak",
    shareWeekendOffTpl: "{days} off-peak all day",
    shareRulesNoWindows: "No peak windows documented (source state)",
    shareUpdatedTpl: "As of {datetime} UTC",
  },
} as const;

export type ShareStrings = (typeof shareI18n)[ShareLang];

export interface RankedModel {
  name: string;
  tier: string | null;
  /** Total requests per month (Infinity = free/unlimited). */
  value: number | null;
}

/**
 * Capability set of a model (mirror of `capsOf` in capabilities.tsx, kept
 * local so share.ts stays free of UI imports).
 */
export function shareCapsOf(m: { capabilities: Capabilities | null }): Set<string> {
  const c = m.capabilities;
  if (!c) return new Set<string>();
  return new Set(c.input.filter((mod) => mod !== "text"));
}

/** OR-semantics like the main table: a model passes if it has any selected cap. */
export function matchesShareCaps(
  m: { capabilities: Capabilities | null },
  caps: readonly string[],
): boolean {
  if (caps.length === 0) return true;
  const s = shareCapsOf(m);
  return caps.some((cap) => s.has(cap));
}

/**
 * Total requests per month — the EXACT value the main table sorts and
 * displays (`requestsPerMonth` at list basis): usage ÷ list-cost per request,
 * free models (usage = null) → Infinity (top rank, displayed as ∞). No
 * card-side special path: ranking and display value are identical to the
 * table cell. (The zeros are unused params of the shared table function.)
 */
export function shareRequests(m: Model): number | null {
  return requestsPerMonth(m, "list", 0, 0);
}

/**
 * TOP information = the models with the most requests per month, ranked
 * exactly like the main table (requests desc) and pre-filtered by the page's
 * capability filter (OR-semantics, same as the table).
 */
export function topModels(
  models: Model[],
  topN: number,
  caps: readonly string[] = [],
): RankedModel[] {
  const valued = models
    .filter((m) => matchesShareCaps(m, caps))
    .map((m) => ({
      name: m.name,
      tier: m.tier,
      value: shareRequests(m),
    }));
  valued.sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return (b.value as number) - (a.value as number);
  });
  return valued.slice(0, topN);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PALETTES: Record<ShareTheme, { bg: string; card: string; text: string; muted: string; accent: string; row: string }> = {
  // Fixed hex so the exported SVG looks identical on every platform
  // (theme-independent, per daisyUI color rules for static graphics).
  dark: { bg: "#0f172a", card: "#1e293b", text: "#f1f5f9", muted: "#94a3b8", accent: "#38bdf8", row: "#16213a" },
  light: { bg: "#ffffff", card: "#f1f5f9", text: "#0f172a", muted: "#64748b", accent: "#0284c7", row: "#f8fafc" },
};

export function metricLabel(lang: "de" | "en"): string {
  return lang === "de" ? "Anfragen gesamt" : "Total requests";
}

export interface ShareCardInput {
  rows: RankedModel[];
  cfg: ShareConfig;
  lang: "de" | "en";
  fetchedAt: string;
  site: string;
  peakHours?: PeakHours;
}

export const isPortraitSize = (size: ShareSize): boolean => size === "ig" || size === "story";

/**
 * Localized last-update timestamp (fetchedAt has intraday runs, so the time
 * is included). Rendered in UTC for determinism across platforms.
 */
export function formatShareDateTime(iso: string, lang: "de" | "en"): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
}

/** Unified footer line: LEFT = site domain, RIGHT = last-update date+time. */
export function shareUpdatedLine(lang: "de" | "en", fetchedAt: string): string {
  return shareI18n[lang].shareUpdatedTpl.replace("{datetime}", formatShareDateTime(fetchedAt, lang));
}
/** Local copy of the PeakIndicator normal form (share.ts must stay Solid-free). */
export const normalizeShareModel = (name: string): string => name.toLowerCase().replace(/[\s-]+/g, "");

export const isSharePeakTier = (tier: string | null): boolean =>
  /^(?:off[- ]?peak|peak)$/i.test(tier ?? "");

export function peakRangesForShare(peakHours: PeakHours | undefined, name: string): [number, number][] {
  return peakHours?.[normalizeShareModel(name)] ?? [];
}

function formatShareWindows(ranges: [number, number][]): string {
  return ranges.map(([s, e]) => `${String(s).padStart(2, "0")}:00–${String(e).padStart(2, "0")}:00`).join(", ");
}

/**
 * Wochentags-Abdeckung der Peak-Fenster, abgeleitet aus der Quelle
 * (`PEAK_PRICING_RULES.weekendOffPeakDaysBeijing`): Komplement der
 * Off-Peak-Wochenendtage. Kein Wochenend-Off-Peak → "täglich"/"daily"
 * (immer, 24/7). Die Quelle nennt die Tage explizit — der Text folgt ihr,
 * statt sie fest zu verdrahten.
 */
export function shareWeekdayScope(lang: "de" | "en"): string {
  const t = shareI18n[lang];
  const weekend = [...PEAK_PRICING_RULES.weekendOffPeakDaysBeijing].sort((a, b) => a - b);
  if (weekend.length === 0) return t.shareDaily;
  const days = t.shareDays;
  const weekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekend.includes(d as 0 | 6));
  if (weekdays.length === 0) return t.shareDaily;
  const contiguous =
    weekdays.length > 1 && weekdays.every((d, i) => i === 0 || d === weekdays[i - 1] + 1);
  const range = contiguous
    ? `${days[weekdays[0] as 0]}–${days[weekdays[weekdays.length - 1] as 0]}`
    : weekdays.map((d) => days[d as 0]).join(", ");
  return `${range} (${t.shareBeijingTz})`;
}

/** "Sa/So" aus den Quell-Wochenendtagen (gleiche Quelle wie der Scope). */
export function shareWeekendDays(lang: "de" | "en"): string {
  const t = shareI18n[lang];
  const weekend = [...PEAK_PRICING_RULES.weekendOffPeakDaysBeijing].sort((a, b) => a - b);
  return weekend.map((d) => t.shareDays[d]).join("/");
}

/**
 * Single constraint line per row (portrait cards only): tier badge +
 * peak window (UTC) + weekday scope. Never a bare "OFF-PEAK".
 */
export function shareConstraintLine(tier: string, ranges: [number, number][], lang: "de" | "en"): string {
  return shareI18n[lang].shareConstraintTpl
    .replace("{tier}", tier)
    .replace("{windows}", formatShareWindows(ranges))
    .replace("{scope}", shareWeekdayScope(lang));
}

/**
 * Compact constraints block for portrait cards: peak/off-peak rules with
 * UTC window + weekday scope. If the source documents no windows, mark the
 * line as source-state instead of guessing.
 */
export function shareRulesLine(lang: "de" | "en", ranges: [number, number][] | null): string {
  const t = shareI18n[lang];
  if (!ranges || ranges.length === 0) return t.shareRulesNoWindows;
  return t.shareRulesTpl
    .replace("{windows}", formatShareWindows(ranges))
    .replace("{scope}", shareWeekdayScope(lang))
    .replace("{weekend}", t.shareWeekendOffTpl.replace("{days}", shareWeekendDays(lang)));
}

/** First non-empty peak window set among the rows, else any known set (for the rules block). */
export function shareBlockRanges(rows: RankedModel[], peakHours: PeakHours | undefined): [number, number][] | null {
  for (const r of rows) {
    const ranges = peakRangesForShare(peakHours, r.name);
    if (isSharePeakTier(r.tier) && ranges.length > 0) return ranges;
  }
  for (const key of Object.keys(peakHours ?? {})) {
    const ranges = peakHours?.[key];
    if (ranges && ranges.length > 0) return ranges;
  }
  return null;
}

/** Self-contained SVG share card (no external fonts/assets). */
export function buildShareSvg(input: ShareCardInput): string {
  const { w, h } = SHARE_SIZES[input.cfg.size];
  const p = PALETTES[input.cfg.theme];
  const de = input.lang === "de";
  const portrait = isPortraitSize(input.cfg.size);
  // Landscape cards show the Top 5 without constraints; portrait cards
  // (IG Top 10, Story Top 15) fill their height with per-row constraint
  // lines plus a compact rules block instead of uninteresting filler models.
  const rows = portrait ? input.rows : input.rows.slice(0, autoTopN(input.cfg.size));
  const title = de ? `Top ${rows.length} · OpenCode Go Modelle` : `Top ${rows.length} · OpenCode Go models`;
  const subtitle = metricLabel(input.lang);
  const updated = shareUpdatedLine(input.lang, input.fetchedAt);
  // Dense cards (portrait Top 10/15) get a slimmer header so all rows fit.
  // Compact rows divide the remaining space (never overflows by
  // construction) down to a minimum readable size; roomy cards cap the row
  // height and center the rows block between header and footer/block.
  const dense = rows.length > 5;
  const headerH = dense ? 118 : 150;
  const blockH = portrait ? 116 : 0;
  const footerH = portrait ? 0 : dense ? 60 : 84;
  const availH = h - headerH - blockH - footerH;
  const MAX_ROW_H = portrait ? 240 : 180;
  const rowH = Math.max(64, Math.min(MAX_ROW_H, Math.floor(availH / Math.max(1, rows.length))));
  const startY = headerH + Math.max(0, Math.floor((availH - rows.length * rowH) / 2));
  const compact = rowH < 96;
  const large = rowH > 150;
  const nameFs = compact ? 20 : large ? 30 : 24;
  const countFs = compact ? 19 : large ? 28 : 22;
  const constraintFs = compact ? 14 : large ? 18 : 16;
  const medalR = large ? 22 : 17;
  const medalFs = large ? 26 : 20;
  const titleY = dense ? 62 : 72;
  const subtitleY = dense ? 94 : 110;
  const titleFs = dense ? 32 : 40;
  const pad = 56;
  const rowW = w - pad * 2;

  const rowSvg = rows
    .map((r, i) => {
      const y = startY + i * rowH;
      const cy = y + (rowH - 10) / 2;
      const medal = i === 0 ? p.accent : p.muted;
      const name = esc(r.tier ? `${r.name} (${r.tier})` : r.name);
      const count =
        r.value === null ? "–" : !Number.isFinite(r.value) ? "∞" : formatReqPerMonth(r.value, input.lang);
      const ranges = portrait ? peakRangesForShare(input.peakHours, r.name) : [];
      const constraint =
        portrait && isSharePeakTier(r.tier) && ranges.length > 0 && r.tier
          ? shareConstraintLine(r.tier, ranges, input.lang)
          : null;
      // Max one constraint line per row: main line moves up, badge + window below.
      const mainY = constraint ? cy - 10 : cy + 7;
      const constraintText = constraint
        ? `<text data-constraint="1" x="${pad + 70}" y="${cy + 26}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${constraintFs}" fill="${p.muted}">${esc(constraint)}</text>`
        : "";
      return (
        `<g data-row="${i + 1}">` +
        `<rect x="${pad}" y="${y}" width="${rowW}" height="${rowH - 10}" rx="12" fill="${p.card}"/>` +
        `<circle cx="${pad + 38}" cy="${cy}" r="${medalR}" fill="none" stroke="${medal}" stroke-width="2.5"/>` +
        `<text x="${pad + 38}" y="${cy + 7}" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${medalFs}" font-weight="700" fill="${medal}">${i + 1}</text>` +
        `<text x="${pad + 70}" y="${mainY}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${nameFs}" font-weight="600" fill="${p.text}">${name}</text>` +
        `<text x="${pad + rowW - 24}" y="${mainY}" text-anchor="end" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${countFs}" font-weight="700" fill="${p.text}">${esc(count)}</text>` +
        constraintText +
        `</g>`
      );
    })
    .join("");

  // Unified footer on every preset, ALWAYS bottom-anchored (small TopN never
  // leave a floating footer, large TopN never overflow into it):
  // LEFT = site domain, RIGHT = last-update date+time. Portrait adds the
  // compact peak/off-peak rules line above it; landscape has no constraints.
  const footer = (y: number) =>
    `<text data-footer-left="1" x="${pad}" y="${y}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="20" fill="${p.muted}">${esc(input.site)}</text>` +
    `<text data-footer-right="1" x="${w - pad}" y="${y}" text-anchor="end" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="20" fill="${p.muted}">${esc(updated)}</text>`;
  const block = portrait
    ? `<g data-constraints="1">` +
      `<text x="${pad}" y="${h - 72}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="16" fill="${p.muted}">${esc(shareRulesLine(input.lang, shareBlockRanges(rows, input.peakHours)))}</text>` +
      footer(h - 40) +
      `</g>`
    : `<g>${footer(h - 28)}</g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">` +
    `<rect width="${w}" height="${h}" fill="${p.bg}"/>` +
    `<rect x="0" y="0" width="${w}" height="8" fill="${p.accent}"/>` +
    `<text x="${pad}" y="${titleY}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="${titleFs}" font-weight="800" fill="${p.text}">${esc(title)}</text>` +
    `<text x="${pad}" y="${subtitleY}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" font-size="22" fill="${p.muted}">${esc(subtitle)}</text>` +
    rowSvg +
    block +
    `</svg>`
  );
}

/** Shareable page URL that restores the same TOP configuration. */
export function buildShareUrl(
  origin: string,
  path: string,
  cfg: ShareConfig,
  lang: "de" | "en",
  caps: readonly string[] = [],
): string {
  const q = new URLSearchParams();
  q.set("metric", cfg.metric);
  q.set("topN", String(cfg.topN));
  q.set("shareTheme", cfg.theme);
  q.set("shareSize", cfg.size);
  q.set("lang", lang);
  // Capability filter round-trip: the page restores ?cap= for the table and
  // the dialog adopts the same default, so link and table never diverge.
  if (caps.length > 0) q.set("cap", caps.join(","));
  // NOTE: legacy ?wm=0 links are tolerated (param ignored) — the footer
  // always shows the domain now, so there is nothing left to toggle off.
  return `${origin}${path}?${q.toString()}#share`;
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Renders the SVG string to a PNG blob at native card size. */
export function svgToPngBlob(svg: string, w: number, h: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svg image load failed"));
    };
    img.src = url;
  });
}
