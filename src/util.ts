export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  if (n >= 1) return "$" + n.toFixed(2);
  const s = n.toFixed(6);
  return "$" + s.replace(/0+$/, "").replace(/\.$/, "");
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
