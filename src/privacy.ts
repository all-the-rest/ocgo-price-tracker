import type { Translation } from "./i18n";
import type { Privacy } from "./types";
import { fmtDateOnly } from "./util";

export type PrivacyTier = "training" | "retention" | "zdr" | null;

export function privacyTier(p: Privacy | null | undefined): PrivacyTier {
  if (!p) return null;
  if (p.training) return "training";
  const r = p.retentionDays;
  if (r === false) return "retention"; // Kein ZDR → Daten werden aufbewahrt (Dauer unbekannt)
  if (typeof r === "number") return r > 0 ? "retention" : "zdr"; // 0 nur Alt-Daten (früheres Encoding)
  if (r === true) return "zdr";
  return null; // unbekannt
}

export const privacyRank = (p: Privacy | null | undefined): number => {
  const tier = privacyTier(p);
  return tier === "training" ? 0 : tier === "retention" ? 1 : tier === "zdr" ? 2 : -1;
};

/** Sortierschlüssel für die Datenschutz-Tabelle: schlechteste Stufe zuerst (aufsteigend), unbekannt am Ende. */
export const privacySortKey = (p: Privacy | null | undefined): number => {
  const tier = privacyTier(p);
  return tier === "training" ? 0 : tier === "retention" ? 1 : tier === "zdr" ? 2 : 3;
};

export function privacyBadgeClass(p: Privacy | null | undefined): string {
  switch (privacyTier(p)) {
    case "training":
      return "badge-error";
    case "retention":
      return "badge-warning";
    case "zdr":
      return "badge-success";
    default:
      return "badge-ghost";
  }
}

export function privacyLabel(p: Privacy | null | undefined, t: Translation): string {
  const tier = privacyTier(p);
  if (tier === "training") return t.privacyTraining;
  if (tier === "retention") {
    if (p?.retentionDays === false) return t.privacyNoZdr;
    return t.privacyRetention.replace("{days}", String(p?.retentionDays));
  }
  if (tier === "zdr") return t.privacyZdr;
  return t.privacyUnknown;
}

export function privacyLabelWithValidUntil(
  p: Privacy | null | undefined,
  t: Translation,
  lang: "de" | "en"
): string {
  let s = privacyLabel(p, t);
  if (p?.validUntil) {
    // Gleicher Fall wie in PrivacyTable: abgelaufenes ZDR mit training:true
    // (Worst-Case nach nicht verlängerter Vereinbarung) → nicht "gültig bis …",
    // sondern "ZDR-Abkommen nicht verlängert".
    if (p.training) {
      s += ` · ${t.validUntilExpired}`;
    } else {
      s += ` · ${t.privacyValidUntil.replace("{date}", fmtDateOnly(`${p.validUntil}T00:00:00.000Z`, lang))}`;
    }
  }
  return s;
}
