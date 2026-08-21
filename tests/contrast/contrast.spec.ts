import { expect, test } from "@playwright/test";

// Color-contrast matrix for daisyUI semantic components.
//
// Every semantic badge/alert color's FOREGROUND vs its BACKGROUND (alert bg is
// composited over the page surface, exactly as it renders) must meet WCAG AA in
// BOTH the light and the dark theme. This guards against theme/color regressions
// that would make status badges (e.g. the red "Modell training" privacy badge)
// or notice text unreadable — and it must hold for dark AND light mode alike.
//
// The test injects daisyUI-classed elements into the live page (app CSS loaded),
// resolves each color's real rendered RGB via a canvas (daisyUI v5 uses oklch,
// which the browser composites for us), and computes the WCAG contrast ratio.
const COLORS = ["error", "success", "warning", "info", "primary", "secondary", "accent", "neutral"];

function lum(rgb: number[]): number {
  const a = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ratio(fg: number[], bg: number[]): number {
  const l1 = lum(fg), l2 = lum(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolve any CSS color (oklch/rgb/alpha) to its rendered [r,g,b] via canvas. */
async function resolve(page: import("@playwright/test").Page, color: string): Promise<number[]> {
  return page.evaluate((s) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d");
    x.fillStyle = s;
    x.fillRect(0, 0, 1, 1);
    return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, color);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`theme=${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    });

    test("badge foreground vs background meets WCAG AA", async ({ page }) => {
      for (const c of COLORS) {
        const rgb = await page.evaluate((cls) => {
          const el = document.createElement("div");
          el.className = `badge badge-${cls}`;
          el.textContent = "x";
          document.body.appendChild(el);
          const cs = getComputedStyle(el);
          const r = { bg: cs.backgroundColor, fg: cs.color };
          el.remove();
          return r;
        }, c);
        const r = ratio(await resolve(page, rgb.fg), await resolve(page, rgb.bg));
        expect(r, `badge-${c} (${theme}) fg/bg contrast ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test("alert foreground vs (surface-composited) background meets WCAG AA", async ({ page }) => {
      for (const c of COLORS) {
        const rgb = await page.evaluate((cls) => {
          const wrap = document.createElement("div");
          wrap.className = "bg-base-100";
          const el = document.createElement("div");
          el.className = `alert alert-${cls}`;
          el.textContent = "x";
          wrap.appendChild(el);
          document.body.appendChild(wrap);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const g = canvas.getContext("2d")!;
          g.fillStyle = getComputedStyle(wrap).backgroundColor;
          g.fillRect(0, 0, 1, 1);
          g.fillStyle = getComputedStyle(el).backgroundColor;
          g.fillRect(0, 0, 1, 1);
          const comp = [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
          const fg = getComputedStyle(el).color;
          wrap.remove();
          return { comp, fg };
        }, c);
        const r = ratio(await resolve(page, rgb.fg), rgb.comp);
        expect(r, `alert-${c} (${theme}) text/composited-bg contrast ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test("body and link text on base surface meet WCAG AA", async ({ page }) => {
      const rgb = await page.evaluate(() => {
        const wrap = document.createElement("div");
        wrap.className = "bg-base-100";
        const p = document.createElement("p");
        p.textContent = "x";
        wrap.appendChild(p);
        const a = document.createElement("a");
        a.className = "link link-primary";
        a.textContent = "x";
        wrap.appendChild(a);
        document.body.appendChild(wrap);
        const r = {
          body: getComputedStyle(p).color,
          link: getComputedStyle(a).color,
          surf: getComputedStyle(wrap).backgroundColor,
        };
        wrap.remove();
        return r;
      });
      const bodyR = ratio(await resolve(page, rgb.body), await resolve(page, rgb.surf));
      expect(bodyR, `body text vs base-100 (${theme}) ${bodyR.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      const linkR = ratio(await resolve(page, rgb.link), await resolve(page, rgb.surf));
      expect(linkR, `link-primary vs base-100 (${theme}) ${linkR.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    });
  });
}
