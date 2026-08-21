export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (n >= 1) return "$" + n.toFixed(2);
  const s = n.toFixed(6);
  return "$" + s.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Ersetzt die dynamischen Platzhalter `{credit}`/`{cost}` (mit `$`) sowie
 * `{creditNum}`/`{costNum}` (nackte Zahlen) in i18n-Texten durch die tatsächlich
 * gefetchten Monatsguthaben/-preis-Werte.
 */
export function fmtPricing(tpl: string, credit: number, cost: number): string {
  return tpl
    .replaceAll("{credit}", "$" + credit)
    .replaceAll("{cost}", "$" + cost)
    .replaceAll("{creditNum}", String(credit))
    .replaceAll("{costNum}", String(cost));
}

export function fmtDate(iso: string, lang: "de" | "en"): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
}

export function fmtDateOnly(iso: string, lang: "de" | "en"): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
}

export function formatModelName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Anzeigename für ein kostenloses Zen-Modell: optionaler öffentlicher Name aus
 * models.dev (z. B. x-preview-f-free → „Ox Alpha Free“), sonst pretty-printed ID.
 */
export function formatFreeModelName(f: { id: string; name?: string }): string {
  return f.name ?? formatModelName(f.id);
}
