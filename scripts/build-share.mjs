// Static share-card snapshot → public/share/top.svg (copied to dist/ by Vite).
// Layout mirror of src/share.ts for the OG landscape card
// (top 5, total requests at list basis, dark, OG 1200×630, no constraints).
// Regenerate: `node scripts/build-share.mjs`.
// Kept dependency-free (plain node) so the build never needs a TS step.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function formatReq(n) {
  if (n === null) return "–";
  if (!Number.isFinite(n)) return "∞";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function requestCostList(m) {
  if (!m.pattern) return m.usage === null ? 0 : null;
  const input = m.input;
  const cached = m.cachedRead;
  const writeRaw = m.cachedWrite;
  const output = m.output;
  if (input === null || cached === null || output === null) return null;
  const write = writeRaw ?? input;
  const inputEff = 0.05 * input + 0.95 * write;
  return (inputEff * m.pattern.input + cached * m.pattern.cachedRead + output * m.pattern.output) / 1e6;
}

const data = JSON.parse(readFileSync("data/latest.json", "utf8"));
const rows = data.models
  .map((m) => {
    if (m.usage === null) return { name: m.name, tier: m.tier, value: Infinity };
    const cost = requestCostList(m);
    return { name: m.name, tier: m.tier, value: cost ? m.usage / cost : null };
  })
  .sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : b.value - a.value))
  .slice(0, 5);

const W = 1200;
const H = 630;
const SITE = "ocgo-pricing.all-the.rest";
const p = { bg: "#0f172a", card: "#1e293b", text: "#f1f5f9", muted: "#94a3b8", accent: "#38bdf8" };
const pad = 56;
const headerH = 150;
const footerH = 84;
const rowH = Math.floor((H - headerH - footerH) / rows.length);
const rowW = W - pad * 2;
const date = new Date(data.fetchedAt).toISOString().slice(0, 10);
const time = new Date(data.fetchedAt).toISOString().slice(11, 16);

const rowSvg = rows
  .map((r, i) => {
    const y = headerH + i * rowH;
    const medal = i === 0 ? p.accent : p.muted;
    const name = esc(r.tier ? `${r.name} (${r.tier})` : r.name);
    const cy = y + (rowH - 10) / 2;
    return (
      `<g data-row="${i + 1}"><rect x="${pad}" y="${y}" width="${rowW}" height="${rowH - 10}" rx="12" fill="${p.card}"/>` +
      `<circle cx="${pad + 38}" cy="${cy}" r="17" fill="none" stroke="${medal}" stroke-width="2.5"/>` +
      `<text x="${pad + 38}" y="${cy + 7}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="${medal}">${i + 1}</text>` +
      `<text x="${pad + 70}" y="${cy + 7}" font-family="system-ui,sans-serif" font-size="24" font-weight="600" fill="${p.text}">${name}</text>` +
      `<text x="${pad + rowW - 24}" y="${cy + 7}" text-anchor="end" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="${p.text}">${esc(formatReq(r.value))}</text></g>`
    );
  })
  .join("");

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top 5 OpenCode Go requests">` +
  `<rect width="${W}" height="${H}" fill="${p.bg}"/><rect x="0" y="0" width="${W}" height="8" fill="${p.accent}"/>` +
  `<text x="${pad}" y="72" font-family="system-ui,sans-serif" font-size="40" font-weight="800" fill="${p.text}">Top 5 · OpenCode Go requests</text>` +
  `<text x="${pad}" y="110" font-family="system-ui,sans-serif" font-size="22" fill="${p.muted}">Total requests</text>` +
  rowSvg +
  `<text data-footer-left="1" x="${pad}" y="${H - 28}" font-family="system-ui,sans-serif" font-size="20" fill="${p.muted}">${SITE}</text>` +
  `<text data-footer-right="1" x="${W - pad}" y="${H - 28}" text-anchor="end" font-family="system-ui,sans-serif" font-size="20" fill="${p.muted}">As of ${date} ${time} UTC</text></svg>`;

mkdirSync("public/share", { recursive: true });
writeFileSync("public/share/top.svg", svg);
console.log(`public/share/top.svg written (${rows.length} rows)`);
