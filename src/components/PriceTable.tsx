import { createMemo, For, onCleanup, onMount, Show } from "solid-js";
import type { Translation } from "../i18n";
import Heading from "./Heading";
import type { Basis, Model, PeakHours } from "../types";
import { fmt, fmtContextWindow, fmtPricing } from "../util";
import { fieldPrice, formatTokens, formatReqPerMonth, requestCost, requestsPerMonth } from "../weighted";
import { CapabilityBadges, CapabilityFilter, capsOf, type CapId } from "../capabilities";
import { setupDragScroll } from "../dragscroll";
import Tooltip from "./Tooltip";
import ModelId from "./ModelId";
import PeakIndicator, { isPeakTier, isTierActive, peakRangesFor, usePeakClock } from "./PeakIndicator";
import type { SortField, SortState } from "../sort";

interface PriceTableProps {
  models: Model[];
  t: Translation;
  lang: "de" | "en";
  basis: Basis;
  setBasis: (b: Basis) => void;
  sort: SortState;
  setSort: (u: (prev: SortState) => SortState) => void;
  caps: CapId[];
  setCaps: (u: (prev: CapId[]) => CapId[]) => void;
  showTraining: boolean;
  setShowTraining: (v: boolean) => void;
  monthlyCredit: number;
  monthlyCost: number;
  peakHours?: PeakHours;
}

const formatMult = (n: number, lang: "de" | "en") =>
  new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 2 }).format(n);

const factorPhrase = (mult: number, lang: "de" | "en", kind: "price" | "value"): string => {
  const n = formatMult(mult, lang);
  if (kind === "price") {
    if (mult === 1) return lang === "de" ? "Listenpreis" : "list price";
    if (mult === 0.5) return lang === "de" ? "halber Preis" : "half price";
    return lang === "de" ? `${n}-facher Preis` : `${n}× the price`;
  }
  return `${n}×`;
};

export default function PriceTable(props: PriceTableProps) {
  let scroller: HTMLDivElement | undefined;
  const now = usePeakClock();
  onMount(() => {
    if (!scroller) return;
    const dispose = setupDragScroll(scroller);
    onCleanup(dispose);
  });

  const sortValue = (m: Model, f: SortField): number | string | null => {
    if (f === "cost") return requestCost(m, props.basis, props.monthlyCost);
    if (f === "requests")
      return requestsPerMonth(m, props.basis, props.monthlyCredit, props.monthlyCost);
    if (f === "name") return m.name.toLowerCase();
    if (f === "usage") return m.usage ?? Infinity; // unbegrenzte Nutzung = bester Wert
    if (f === "input" || f === "output" || f === "cachedRead" || f === "cachedWrite") {
      return fieldPrice(m, f, props.basis, props.monthlyCost);
    }
    return m[f];
  };

  const sorted = createMemo(() => {
    const { field, dir } = props.sort;
    let models = props.models;
    if (!props.showTraining) {
      models = models.filter((m) => !(m.privacy && m.privacy.training === true));
    }
    if (props.caps.length > 0) {
      models = models.filter((m) => {
        const s = capsOf(m);
        return props.caps.some((cap) => s.has(cap));
      });
    }
    return [...models].sort((a, b) => {
      const va = sortValue(a, field);
      const vb = sortValue(b, field);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir;
    });
  });

  const thSort = (field: SortField, label: string, right?: boolean, tooltip?: string) => {
    const active = props.sort.field === field;
    return (
      <th class={right ? "text-right" : ""}>
        <button
          class="inline-flex items-center gap-1 whitespace-nowrap"
          classList={{ "text-primary": active }}
          aria-label={`${label} (${active ? (props.sort.dir === 1 ? "desc" : "asc") : "sort"})`}
          onClick={() => props.setSort((s) => ({ field, dir: s.field === field ? (s.dir === 1 ? -1 : 1) : 1 }))}
        >
          <span>{label}</span>
          <Show when={tooltip}>
            {(tip) => (
              <Tooltip tip={tip()} class="inline-flex">
                <svg
                  class="h-3.5 w-3.5 text-base-content/70"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </Tooltip>
            )}
          </Show>
          {active ? <span aria-hidden="true">{props.sort.dir === 1 ? "▲" : "▼"}</span> : null}
        </button>
      </th>
    );
  };

  const patternTooltip = (m: Model) => {
    const p = m.pattern;
    if (!p) return "";
    return props.t.patternTooltip
      .replace("{input}", formatTokens(p.input, props.lang))
      .replace("{cached}", formatTokens(p.cachedRead, props.lang))
      .replace("{output}", formatTokens(p.output, props.lang));
  };

  const usageBadge = (usage: number) => {
    if (usage / props.monthlyCost <= 1) return "badge-error";
    if (usage > props.monthlyCredit) return "badge-success";
    if (usage < props.monthlyCredit) return usage < props.monthlyCredit / 2 ? "badge-error" : "badge-warning";
    return "badge-success";
  };

  const usagePct = (usage: number) => Math.round((usage / props.monthlyCredit) * 100);

  const factorNote = createMemo(() => {
    if (props.basis === "list") return "";
    const usages = [...new Set(props.models.map((m) => m.usage))].filter((u): u is number => u !== null).sort((a, b) => a - b);
    if (props.basis === "paid") {
      const rows = usages
        .map((u) => `$${u} → ${factorPhrase(u / props.monthlyCost, props.lang, "value")}`)
        .join(" · ");
      return props.t.paidNote.replace("{paid}", String(props.monthlyCost)).replace("{rows}", rows);
    }
    const rows = usages
      .map((u) => `$${u} → ${factorPhrase(props.monthlyCredit / u, props.lang, "price")}`)
      .join(" · ");
    return props.t.factorNote.replace("{credit}", String(props.monthlyCredit)).replace("{rows}", rows);
  });

  const priceCell = (n: number | null | undefined) => {
    const s = fmt(n);
    const isNull = s === "–";
    return (
      <span class="grid w-full grid-cols-[1.5rem_1fr]">
        <span class="text-right">{isNull ? "" : "$"}</span>
        <span class="text-right tabular-nums">{isNull ? "–" : s.slice(1)}</span>
      </span>
    );
  };

  return (
    <section id="prices" class="mt-10">
      <Heading anchor="prices">{props.t.headingPrices}</Heading>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span>{props.t.basisLabel}</span>
        <div class="join">
          <button
            class="join-item btn btn-sm text-xs sm:text-sm whitespace-nowrap"
            classList={{ "btn-active": props.basis === "list", "btn-primary": props.basis === "list" }}
            onClick={() => props.setBasis("list")}
          >
            {props.t.basisList}
          </button>
          <button
            class="join-item btn btn-sm text-xs sm:text-sm whitespace-nowrap"
            classList={{ "btn-active": props.basis === "full", "btn-primary": props.basis === "full" }}
            onClick={() => props.setBasis("full")}
          >
            {fmtPricing(props.t.basisFull, props.monthlyCredit, props.monthlyCost)}
          </button>
          <button
            class="join-item btn btn-sm text-xs sm:text-sm whitespace-nowrap"
            classList={{ "btn-active": props.basis === "paid", "btn-primary": props.basis === "paid" }}
            onClick={() => props.setBasis("paid")}
          >
            {fmtPricing(props.t.basisPaid, props.monthlyCredit, props.monthlyCost)}
          </button>
        </div>
        <Show when={props.basis === "full" || props.basis === "paid"}>
          <span class="text-sm text-base-content/70">{factorNote()}</span>
        </Show>
      </div>

      <CapabilityFilter
        value={() => props.caps}
        setter={props.setCaps}
        t={props.t}
        trailing={
          <label class="label cursor-pointer gap-2 order-first lg:order-last">
            <span class="label-text">{props.t.trainingFilter}</span>
            <input
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
              checked={props.showTraining}
              onChange={(e) => props.setShowTraining(e.currentTarget.checked)}
            />
          </label>
        }
      />

      <div ref={scroller} class="mt-4 max-w-full overflow-x-auto">
        <table class="table table-zebra table-sm table-pin-rows">
          <thead>
            <tr>
              {thSort("name", props.t.colModel)}
              <th>{props.t.capsLabel}</th>
              {thSort("input", props.t.colInput, true)}
              {thSort("output", props.t.colOutput, true)}
              {thSort("cachedRead", props.t.colCachedRead, true)}
              {thSort("cachedWrite", props.t.colCachedWrite, true)}
              {thSort("usage", props.t.colUsage, true)}
              {thSort("cost", props.t.colWeighted, true, props.t.tooltipWeighted)}
              {thSort("requests", props.t.colRequests, true, props.t.requestsTooltip)}
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th class="text-right font-normal text-base-content/70">{props.t.per1m}</th>
              <th class="text-right font-normal text-base-content/70">{props.t.per1m}</th>
              <th class="text-right font-normal text-base-content/70">{props.t.per1m}</th>
              <th class="text-right font-normal text-base-content/70">{props.t.per1m}</th>
              <th></th>
              <th class="text-right font-normal text-base-content/70">{props.t.perReq}</th>
              <th class="text-right font-normal text-base-content/70">{props.t.perMonth}</th>
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(m) => (
                <tr
                  classList={{
                    "opacity-50":
                      isPeakTier(m.tier) &&
                      peakRangesFor(props.peakHours, m.name).length > 0 &&
                      !isTierActive(m.tier, now(), peakRangesFor(props.peakHours, m.name)),
                  }}
                >
                  <th class="font-medium">
                    <span class="block">
                      {m.name}
                      <Show when={m.id}>
                        {(id) => <ModelId id={id()} t={props.t} />}
                      </Show>
                    </span>
                    <Show when={m.provider || m.contextWindow != null}>
                      <span class="block text-xs font-normal text-base-content/70">
                        {[
                          m.provider,
                          m.contextWindow != null
                            ? `${fmtContextWindow(m.contextWindow)} ${props.t.contextTokens}`
                            : null,
                        ]
                          .filter((s): s is string => Boolean(s))
                          .join(" · ")}
                      </span>
                    </Show>
                    <Show when={m.tier}>
                      {(tier) => (
                        <Show
                          when={isPeakTier(tier()) && peakRangesFor(props.peakHours, m.name).length > 0}
                          fallback={<span class="block text-xs font-normal text-base-content/70">{tier()}</span>}
                        >
                          <span class="flex items-center text-xs font-normal text-base-content/70">
                            <PeakIndicator
                              tier={tier()}
                              ranges={peakRangesFor(props.peakHours, m.name)}
                              now={now()}
                              t={props.t}
                            />
                          </span>
                        </Show>
                      )}
                    </Show>
                  </th>
                  <td>
                    <CapabilityBadges m={m} t={props.t} />
                  </td>
                  <td>{priceCell(fieldPrice(m, "input", props.basis, props.monthlyCost))}</td>
                  <td>{priceCell(fieldPrice(m, "output", props.basis, props.monthlyCost))}</td>
                  <td>{priceCell(fieldPrice(m, "cachedRead", props.basis, props.monthlyCost))}</td>
                  <td>{priceCell(fieldPrice(m, "cachedWrite", props.basis, props.monthlyCost))}</td>
                  <td class="text-right whitespace-nowrap">
                    <Show
                      when={m.usage}
                      fallback={
                        <Tooltip tip={props.t.usageUnlimited} class="inline-block">
                          <span class="badge badge-sm badge-success font-bold">∞</span>
                        </Tooltip>
                      }
                    >
                      {(usage) => (
                        <Tooltip
                          tip={props.t.usageTooltip
                            .replace("{pct}", String(usagePct(usage())))
                            .replace("{usage}", String(usage()))
                            .replace("{credit}", String(props.monthlyCredit))
                            .replace("{mult}", formatMult(usage() / props.monthlyCost, props.lang))
                            .replace("{paid}", String(props.monthlyCost))}
                          class="inline-block"
                        >
                          <span
                            class={`badge badge-sm ${usageBadge(usage())}`}
                            classList={{ "font-bold": usage() > props.monthlyCredit }}
                          >
                            ${usage()} · {formatMult(usage() / props.monthlyCost, props.lang)}×
                          </span>
                        </Tooltip>
                      )}
                    </Show>
                  </td>
                  <td>
                    <Show when={m.pattern} fallback={priceCell(requestCost(m, props.basis, props.monthlyCost))}>
                      <Tooltip tip={patternTooltip(m)} class="block">
                        {priceCell(requestCost(m, props.basis, props.monthlyCost))}
                      </Tooltip>
                    </Show>
                  </td>
                  <td class="text-right tabular-nums whitespace-nowrap">
                    <Show
                      when={requestsPerMonth(m, props.basis, props.monthlyCredit, props.monthlyCost)}
                      fallback={priceCell(null)}
                    >
                      {(rpm) => <span>{formatReqPerMonth(rpm(), props.lang)}</span>}
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
}
