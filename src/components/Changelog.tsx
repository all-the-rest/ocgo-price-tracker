import { For, Show, createSignal, onMount } from "solid-js";
import type { Lang, Translation } from "../i18n";
import { HEADING_IDS } from "../headings";
import Heading, { AnchorLink } from "./Heading";
import type { Change, ChangelogEntry, Plan, PlanId, PriceField, PricingType, UsageMap } from "../types";
import { fmt, formatFreeModelName } from "../util";
import { planLabel } from "../plans";
import { capCount, fmtCaps } from "../capabilities";
import { privacyLabelWithValidUntil, privacyRank } from "../privacy";

interface ChangelogProps {
  entries: ChangelogEntry[];
  t: Translation;
  lang: Lang;
  /** Alle Pläne — plan-übergreifende Labels (die Preiszeile nennt jeden Plan). */
  plans: Plan[];
  /**
   * Aktiver Plan: grenzt die plan-spezifischen `usage_changed`-Events ein. Die
   * Changelog ist damit effektiv **pro Plan** — unter „Go Plus" sieht man keine
   * Go-Nutzungsänderungen mehr (und umgekehrt). Alle übrigen Event-Typen
   * (Preise, Datenschutz, Fähigkeiten, Free-Modelle) sind plan-unabhängig und
   * stehen in beiden Ansichten.
   */
  planId: PlanId;
}

/**
 * Schränkt ein Event auf den aktiven Plan ein, oder liefert `null`, wenn es
 * für diesen Plan nicht existiert. Plan-spezifisch sind `usage_changed` und
 * `plan_added` (letzteres erscheint nur unter dem hinzugekommenen Plan).
 */
function planScopedChange(change: Change, planId: PlanId): Change | null {
  // Ein neuer Plan wird nur in seiner eigenen Ansicht gefeiert.
  if (change.type === "plan_added") return change.plan === planId ? change : null;
  if (change.type !== "usage_changed") return change;
  const plans = change.plans.filter((p) => p.plan === planId);
  return plans.length > 0 ? { ...change, plans } : null;
}

// Einträge pro Changelog-Seite (Pagination).
const PAGE_SIZE = 20;

// Leitet aus einem Run-`id` (z.B. 2026-08-19T06-00-00Z) die Uhrzeit ab (MEZ/MESZ); für
// Vorschema-Einträge (id = Datum) wird null geliefert (keine Zeitangabe).
function entryTime(id: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/.exec(id);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return date.toLocaleTimeString([], {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Nutzungswert kompakt: `$15`, `∞` bei unbegrenzt/unbekannt. */
const fmtUsageVal = (u: number | null | undefined): string => (u == null ? "∞" : `$${u}`);

/** Nutzungswert als JSX; `bold` markiert geänderte Werte. */
const usageValue = (u: number | null | undefined, bold: boolean) =>
  bold ? <strong class="font-bold">{fmtUsageVal(u)}</strong> : <span>{fmtUsageVal(u)}</span>;

export default function Changelog(props: ChangelogProps) {
  /**
   * Einträge nach Plan gefiltert: plan-spezifische Events auf den aktiven Plan
   * eingeschränkt, Einträge ohne verbleibendes Event ganz entfernt (keine leeren
   * Datums-Überschriften). Paginierung und Deep-Links arbeiten auf dieser Liste.
   */
  const scopedEntries = (): ChangelogEntry[] =>
    props.entries
      .map((entry) => {
        const changes = entry.changes
          .map((c) => planScopedChange(c, props.planId))
          .filter((c): c is Change => c !== null);
        return changes.length > 0 ? { ...entry, changes } : null;
      })
      .filter((e): e is ChangelogEntry => e !== null);

  const totalPages = () => Math.max(1, Math.ceil(scopedEntries().length / PAGE_SIZE));
  const [page, setPage] = createSignal(1);

  // Deep-Link auf einen Eintrag (#<entry-id>): direkt auf die passende Seite.
  onMount(() => {
    const hash = window.location.hash.slice(1);
    const idx = scopedEntries().findIndex((e) => e.id === hash);
    if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE) + 1);
  });

  // Klemmt die Seite, falls die Liste schrumpft (z. B. nach Daten-Patch oder
  // beim Planwechsel, der Einträge ausblendet).
  const clampedPage = () => Math.min(Math.max(1, page()), totalPages());
  const visibleEntries = () =>
    scopedEntries().slice((clampedPage() - 1) * PAGE_SIZE, clampedPage() * PAGE_SIZE);

  // Plan-Ids in Anzeige-Reihenfolge: die `plans`-Liste zuerst, unbekannte danach.
  const orderedUsage = (usage: UsageMap): [string, number | null][] => {
    const order: string[] = props.plans.map((p) => p.id);
    return (Object.entries(usage) as [string, number | null][]).sort(
      (a, b) => (order.indexOf(a[0]) + 1 || Infinity) - (order.indexOf(b[0]) + 1 || Infinity)
    );
  };

  /** Nutzung als JSX: Plan-Map mit Plan-Label je Eintrag. */
  const usageNode = (usage: UsageMap, bold: boolean) => (
    <>
      {orderedUsage(usage).map(([id, v], i) => (
        <>
          {i > 0 && " / "}
          {planLabel(id, props.t)} {usageValue(v, bold)}
        </>
      ))}
    </>
  );

  const fmtPricing = (p: PricingType, fields: PriceField[], boldUsage = false) => {
    const order: PriceField[] = ["input", "output", "cachedRead"];
    if (p.cachedWrite !== null) order.push("cachedWrite");
    return (
      <>
        {order.map((f, i) => (
          <>
            {i > 0 && " / "}
            {fields.includes(f) ? <strong class="font-bold">{fmt(p[f])}</strong> : <span>{fmt(p[f])}</span>}
          </>
        ))}{" "}
        @ {usageNode(p.usage, boldUsage)}
      </>
    );
  };

  const fmtPricingString = (p: PricingType) => {
    const parts = [fmt(p.input), fmt(p.output), fmt(p.cachedRead)];
    if (p.cachedWrite !== null) parts.push(fmt(p.cachedWrite));
    return `${parts.join(" / ")} @ ${usageString(p.usage)}`;
  };

  /** Nutzung als Klartext (model_added/model_removed), Plan-Map mit Labels. */
  const usageString = (usage: UsageMap): string => {
    const rows = orderedUsage(usage);
    if (rows.length === 0) return "∞";
    return rows.map(([id, v]) => `${planLabel(id, props.t)} ${fmtUsageVal(v)}`).join(" / ");
  };

  // Richtung des Preis-Badges: rohe Preissumme (plan-unabhängig). Die Changelog-
  // Zeile ist plan-übergreifend — sie darf nicht still nur den aktiven Plan
  // zeigen (Vorbild cc-price-tracker).
  const pricingSum = (p: PricingType): number =>
    (p.input ?? 0) + (p.output ?? 0) + (p.cachedRead ?? 0) + (p.cachedWrite ?? 0);

  const changeBadge = (c: Change) => {
    const baseCls = "badge badge-sm shrink-0";
    switch (c.type) {
      case "model_added":
      case "free_added":
      case "plan_added":
        return <span class={`${baseCls} badge-success`}>+</span>;
      case "model_removed":
      case "free_removed":
        return <span class={`${baseCls} badge-error`}>−</span>;
      case "price_changed": {
        const diff = pricingSum(c.to) - pricingSum(c.from);
        if (diff > 1e-9) return <span class={`${baseCls} badge-error`}>↑</span>;
        if (diff < -1e-9) return <span class={`${baseCls} badge-success`}>↓</span>;
        return <span class={`${baseCls} badge-ghost`}>≈</span>;
      }
      case "usage_changed": {
        // Ein Event pro Modell, alle geänderten Pläne im Array.
        // Richtung über alle Pläne; ∞ (null) zählt als größter Wert.
        const score = (u: number | null) => (u === null ? Infinity : u);
        const increased = c.plans.some((p) => score(p.to) > score(p.from));
        const decreased = c.plans.some((p) => score(p.to) < score(p.from));
        if (increased && !decreased) return <span class={`${baseCls} badge-success`}>↑</span>;
        if (decreased && !increased) return <span class={`${baseCls} badge-error`}>↓</span>;
        return <span class={`${baseCls} badge-ghost`}>≈</span>;
      }
      case "capabilities_changed": {
        const diff = capCount(c.to) - capCount(c.from);
        if (diff > 0) return <span class={`${baseCls} badge-success`}>+</span>;
        if (diff < 0) return <span class={`${baseCls} badge-error`}>−</span>;
        return <span class={`${baseCls} badge-ghost`}>≈</span>;
      }
      case "privacy_changed": {
        const diff = privacyRank(c.to) - privacyRank(c.from);
        if (diff > 0) return <span class={`${baseCls} badge-success`}>+</span>;
        if (diff < 0) return <span class={`${baseCls} badge-error`}>−</span>;
        return <span class={`${baseCls} badge-ghost`}>≈</span>;
      }
      case "text":
        return <span class={`${baseCls} badge-ghost`}>i</span>;
    }
  };

  const changeText = (c: Change) => {
    switch (c.type) {
      case "text":
        return <span>{c.lang[props.lang]}</span>;
      case "model_added":
        return (
          <span>
            {props.t.chgModelAdded.replace("{model}", c.model).replace("{pricing}", fmtPricingString(c.pricing))}
          </span>
        );
      case "model_removed":
        return (
          <span>
            {props.t.chgModelRemoved
              .replace("{model}", c.model)
              .replace("{pricing}", fmtPricingString(c.pricing))
              .replace("{days}", String(c.days))}
          </span>
        );
      case "price_changed": {
        // Nutzungswerte in beiden Zeilen fett, wenn sie sich unterscheiden
        // (Plan-Map-Vergleich über JSON).
        const boldUsage =
          JSON.stringify(c.from.usage ?? null) !== JSON.stringify(c.to.usage ?? null);
        return (
          <span>
            {c.model}: {fmtPricing(c.from, c.fields, boldUsage)} →{" "}
            {fmtPricing(c.to, c.fields, boldUsage)}
          </span>
        );
      }
      case "usage_changed":
        // Pro Plan Plan-Label + alte/neue Nutzung fett.
        return (
          <span>
            {props.t.chgUsagePlans.replace("{model}", c.model).replace("{plans}", "")}
            <For each={c.plans}>
              {(p, i) => (
                <span>
                  {i() > 0 ? ", " : " "}
                  {planLabel(p.plan, props.t)}{" "}
                  <strong class="font-bold">{fmtUsageVal(p.from)}</strong> →{" "}
                  <strong class="font-bold">{fmtUsageVal(p.to)}</strong>
                </span>
              )}
            </For>
          </span>
        );
      case "capabilities_changed": {
        const [beforeFrom, afterFrom] = props.t.chgCaps.split("{from}");
        const [modelPart, middlePart] = beforeFrom.split("{model}");
        const [arrowPart, afterTo] = afterFrom.split("{to}");
        return (
          <span>
            {modelPart}
            {c.model}
            {middlePart}
            <strong class="font-bold">{fmtCaps(c.from, props.t)}</strong>
            {arrowPart}
            <strong class="font-bold">{fmtCaps(c.to, props.t)}</strong>
            {afterTo}
          </span>
        );
      }
      case "privacy_changed": {
        const [beforeFrom, afterFrom] = props.t.chgPrivacy.split("{from}");
        const [modelPart, middlePart] = beforeFrom.split("{model}");
        const [arrowPart, afterTo] = afterFrom.split("{to}");
        return (
          <span>
            {modelPart}
            {c.model}
            {middlePart}
            <strong class="font-bold">{privacyLabelWithValidUntil(c.from, props.t, props.lang)}</strong>
            {arrowPart}
            <strong class="font-bold">{privacyLabelWithValidUntil(c.to, props.t, props.lang)}</strong>
            {afterTo}
          </span>
        );
      }
      case "free_added":
        return (
          <span>
            {props.t.chgFreeAdded.replace("{model}", formatFreeModelName({ id: c.model, name: c.name }))}
          </span>
        );
      case "free_removed": {
        const days = Math.max(
          0,
          Math.round((Date.parse(c.until) - Date.parse(c.availableFrom)) / 86_400_000)
        );
        return (
          <span>
            {props.t.chgFreeRemoved
              .replace("{model}", formatFreeModelName({ id: c.model, name: c.name }))
              .replace("{days}", String(days))
              .replace("{from}", c.availableFrom)}
          </span>
        );
      }
      case "plan_added": {
        // Preis und Guthaben im Locale der Seite (z. B. $40 / $240).
        const nf = new Intl.NumberFormat(props.lang === "de" ? "de-DE" : "en-US");
        return (
          <span>
            {props.t.chgPlanAdded
              .replace("{plan}", planLabel(c.plan, props.t))
              .replace("{price}", `$${nf.format(c.priceMonthly)}`)
              .replace("{credits}", `$${nf.format(c.creditsMonthly)}`)}
          </span>
        );
      }
    }
  };

  return (
    <section id={HEADING_IDS.changelog} class="mt-10">
      <Heading anchor={HEADING_IDS.changelog}>{props.t.headingChangelog}</Heading>
      <div class="mt-2 max-w-3xl text-sm leading-relaxed text-base-content/80">
        <For each={visibleEntries()}>
          {(entry) => (
            <div id={entry.id} class="mt-4 scroll-mt-24">
              <h3 class="text-sm font-semibold text-base-content/70">
                {entry.date}
                <Show when={entryTime(entry.id) !== null}>
                  <span class="ml-2 font-normal text-base-content/50">{entryTime(entry.id)}</span>
                </Show>
                <AnchorLink id={entry.id} label="Direktlink zu diesem Changelog-Eintrag" />
              </h3>
              <Show when={entry.changes.length > 0} fallback={<p class="mt-1">{props.t.chgNone}</p>}>
                <ul class="mt-1 space-y-1">
                  {/* Anzeigereihenfolge = Erstellungsreihenfolge aus `buildChanges`
                      (plan_added, model_added/-removed, price_changed/usage_changed,
                      capabilities_changed, privacy_changed, free_*). Wer sie ändern
                      will, ändert sie dort — nicht hier umsortieren. */}
                  <For each={entry.changes}>
                    {(c) => (
                      <li class="flex items-center gap-2">
                        {changeBadge(c)}
                        {changeText(c)}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          )}
        </For>
      </div>
      <Show when={totalPages() > 1}>
        <nav class="mt-6 flex items-center justify-center gap-2" aria-label="Changelog pagination">
          <button
            type="button"
            class="btn btn-sm"
            disabled={clampedPage() <= 1}
            onClick={() => setPage(clampedPage() - 1)}
          >
            ‹ {props.t.chgPrev}
          </button>
          <span class="text-sm text-base-content/60">
            {props.t.chgPage.replace("{page}", String(clampedPage())).replace("{total}", String(totalPages()))}
          </span>
          <button
            type="button"
            class="btn btn-sm"
            disabled={clampedPage() >= totalPages()}
            onClick={() => setPage(clampedPage() + 1)}
          >
            {props.t.chgNext} ›
          </button>
        </nav>
      </Show>
    </section>
  );
}
