import { For, Show } from "solid-js";
import type { Lang, Translation } from "../i18n";
import type { Change, ChangelogEntry, PriceField, PricingType } from "../types";
import { fmt, formatModelName } from "../util";
import { capCount, fmtCaps } from "../capabilities";
import { privacyLabelWithValidUntil, privacyRank } from "../privacy";

interface ChangelogProps {
  entries: ChangelogEntry[];
  t: Translation;
  lang: Lang;
  monthlyCredit: number;
}

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

export default function Changelog(props: ChangelogProps) {
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
        @ {boldUsage ? <strong class="font-bold">{fmt(p.usage)}</strong> : fmt(p.usage)}
      </>
    );
  };

  const fmtPricingString = (p: PricingType) => {
    const parts = [fmt(p.input), fmt(p.output), fmt(p.cachedRead)];
    if (p.cachedWrite !== null) parts.push(fmt(p.cachedWrite));
    return `${parts.join(" / ")} @ $${p.usage}`;
  };

  const priceEffective = (p: PricingType): number => {
    const mult = props.monthlyCredit / p.usage;
    const val = (x: number | null) => (x === null ? 0 : x * mult);
    return val(p.input) + val(p.output) + val(p.cachedRead) + val(p.cachedWrite);
  };

  const changeBadge = (c: Change) => {
    const baseCls = "badge badge-sm shrink-0";
    switch (c.type) {
      case "model_added":
      case "free_added":
        return <span class={`${baseCls} badge-success`}>+</span>;
      case "model_removed":
      case "free_removed":
        return <span class={`${baseCls} badge-error`}>−</span>;
      case "price_changed": {
        const diff = priceEffective(c.to) - priceEffective(c.from);
        if (diff > 1e-9) return <span class={`${baseCls} badge-error`}>↑</span>;
        if (diff < -1e-9) return <span class={`${baseCls} badge-success`}>↓</span>;
        return <span class={`${baseCls} badge-ghost`}>≈</span>;
      }
      case "usage_changed": {
        if (c.to > c.from) return <span class={`${baseCls} badge-success`}>↓</span>;
        if (c.to < c.from) return <span class={`${baseCls} badge-error`}>↑</span>;
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
        if (diff > 0) return <span class={`${baseCls} badge-success`}>↓</span>;
        if (diff < 0) return <span class={`${baseCls} badge-error`}>↑</span>;
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
      case "price_changed":
        return (
          <span>
            {c.model}: {fmtPricing(c.from, c.fields, c.from.usage !== c.to.usage)} →{" "}
            {fmtPricing(c.to, c.fields, c.from.usage !== c.to.usage)}
          </span>
        );
      case "usage_changed": {
        const phrase = props.t.chgUsage
          .split("{model}:")[1]
          ?.split("{from}")[0]
          ?.trim();
        return (
          <span>
            {c.model}: {phrase}{" "}
            <strong class="font-bold">{fmt(c.from)}</strong> →{" "}
            <strong class="font-bold">{fmt(c.to)}</strong>
          </span>
        );
      }
      case "capabilities_changed":
        return (
          <span>
            {props.t.chgCaps
              .replace("{model}", c.model)
              .replace("{from}", fmtCaps(c.from, props.t))
              .replace("{to}", fmtCaps(c.to, props.t))}
          </span>
        );
      case "privacy_changed":
        return (
          <span>
            {props.t.chgPrivacy
              .replace("{model}", c.model)
              .replace("{from}", privacyLabelWithValidUntil(c.from, props.t, props.lang))
              .replace("{to}", privacyLabelWithValidUntil(c.to, props.t, props.lang))}
          </span>
        );
      case "free_added":
        return <span>{props.t.chgFreeAdded.replace("{model}", formatModelName(c.model))}</span>;
      case "free_removed": {
        const days = Math.max(
          0,
          Math.round((Date.parse(c.until) - Date.parse(c.availableFrom)) / 86_400_000)
        );
        return (
          <span>
            {props.t.chgFreeRemoved
              .replace("{model}", formatModelName(c.model))
              .replace("{days}", String(days))
              .replace("{from}", c.availableFrom)}
          </span>
        );
      }
    }
  };

  return (
    <section class="mt-10">
      <h2 class="text-lg font-bold tracking-tight">{props.t.headingChangelog}</h2>
      <div class="mt-2 max-w-3xl text-sm leading-relaxed text-base-content/80">
        <For each={props.entries}>
          {(entry) => (
            <div class="mt-4">
              <h3 class="text-sm font-semibold text-base-content/70">
                {entry.date}
                <Show when={entryTime(entry.id) !== null}>
                  <span class="ml-2 font-normal text-base-content/50">{entryTime(entry.id)}</span>
                </Show>
              </h3>
              <Show when={entry.changes.length > 0} fallback={<p class="mt-1">{props.t.chgNone}</p>}>
                <ul class="mt-1 space-y-1">
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
    </section>
  );
}
