import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OG_URL = "https://ocgo-pricing.all-the.rest/share/og.png";

test("index.html contains OG/Twitter SEO tags with absolute URLs", () => {
  const html = readFileSync("index.html", "utf8");
  assert.ok(
    html.includes(`<meta property="og:image" content="${OG_URL}"`),
    "og:image with absolute URL",
  );
  assert.ok(
    html.includes('<meta name="twitter:card" content="summary_large_image"'),
    "twitter:card summary_large_image",
  );
  assert.ok(
    html.includes('<meta name="twitter:image" content="' + OG_URL + '"'),
    "twitter:image with absolute URL",
  );
  assert.ok(
    html.includes('<link rel="canonical" href="https://ocgo-pricing.all-the.rest/"'),
    "canonical link",
  );
});

test("build-share.mjs generates public/share/og.png as 1200x630 PNG", () => {
  const out = execFileSync("node", ["scripts/build-share.mjs"], { encoding: "utf8" });
  assert.match(out, /public\/share\/og\.png written/);
  assert.ok(existsSync("public/share/og.png"), "og.png exists");
  const buf = readFileSync("public/share/og.png");
  assert.deepEqual(
    [...buf.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "PNG magic bytes",
  );
  assert.equal(buf.readUInt32BE(16), 1200, "IHDR width");
  assert.equal(buf.readUInt32BE(20), 630, "IHDR height");
});
