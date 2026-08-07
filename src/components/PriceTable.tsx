import { createMemo, For, Show } from "solid-js";
import type { Translation } from "../i18n";
import type { Model } from "../types";
import { fmt } from "../util";
import { fieldPrice, formatTokens, requestCost } from "../weighted";
import { CapabilityBadges, CapabilityFilter, capsOf, type CapId } from "../capabilities";
import type { SortField, SortState } from "../sort";

interface PriceTableProps {
  models: Model[];
  t: Translation;
  lang: "de" | "en";
  basis: "list" | "full";
  setBasis: (b: "list" | "full") => void;
  sort: SortState;
  setSort: (u: (prev: SortState) => SortState) => void;
  caps: CapId[];
  setCaps: (u: (prev: CapId[]) => CapId[]) => void;
  monthlyCredit: number;
}

export default function PriceTable(props: PriceTableProps) {
  const sortValue = (m: Model, f: SortField): number | string | null => {
    if (f === "cost") return requestCost(m, props.basis);
    if (f === "name") return m.name.toLowerCase();
    return m[f];
  };

  const sorted = createMemo(() => {
    const { field, dir } = props.sort;
    let models = props.models;
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
          title={tooltip}
          onClick={() => props.setSort((s) => ({ field, dir: s.field === field ? (s.dir === 1 ? -1 : 1) : 1 }))}
        >
          {label}
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

  return (
    <section class="mt-10">
      <h2 class="text-lg font-bold tracking-tight">{props.t.headingPrices}</h2>

      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span>{props.t.basisLabel}</span>
        <div class="join">
          <button
            class="join-item btn btn-sm"
            classList={{ "btn-active": props.basis === "list" }}
            onClick={() => props.setBasis("list")}
          >
            {props.t.basisList}
          </button>
          <button
            class="join-item btn btn-sm"
            classList={{ "btn-active": props.basis === "full" }}
            onClick={() => props.setBasis("full")}
          >
            {props.t.basisFull}
          </button>
        </div>
        <Show when={props.basis === "full"}>
          <span class="text-sm text-base-content/50">
            {props.t.factorNote.replace("{n}", String(props.monthlyCredit / 15))}
          </span>
        </Show>
      </div>

      <CapabilityFilter value={() => props.caps} setter={props.setCaps} t={props.t} />

      <div class="mt-4 max-w-full overflow-x-auto">
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
            </tr>
            <tr>
              <th></th>
              <th></th>
              <th class="text-right font-normal text-base-content/40">{props.t.per1m}</th>
              <th class="text-right font-normal text-base-content/40">{props.t.per1m}</th>
              <th class="text-right font-normal text-base-content/40">{props.t.per1m}</th>
              <th class="text-right font-normal text-base-content/40">{props.t.per1m}</th>
              <th></th>
              <th class="text-right font-normal text-base-content/40">{props.t.perReq}</th>
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(m) => (
                <tr>
                  <th class="font-medium">
                    <span class="block">{m.name}</span>
                    <Show when={m.tier}>
                      <span class="block text-xs font-normal text-base-content/50">{m.tier}</span>
                    </Show>
                  </th>
                  <td>
                    <CapabilityBadges m={m} t={props.t} />
                  </td>
                  <td class="text-right tabular-nums">{fmt(fieldPrice(m, "input", props.basis))}</td>
                  <td class="text-right tabular-nums">{fmt(fieldPrice(m, "output", props.basis))}</td>
                  <td class="text-right tabular-nums">{fmt(fieldPrice(m, "cachedRead", props.basis))}</td>
                  <td class="text-right tabular-nums">{fmt(fieldPrice(m, "cachedWrite", props.basis))}</td>
                  <td class="text-right whitespace-nowrap">
                    <span
                      classList={{
                        "badge badge-sm": true,
                        "badge-success": m.usage >= 60,
                        "badge-warning": m.usage < 60,
                      }}
                    >
                      {m.usage}
                    </span>
                    <Show when={props.basis === "full" && m.multiplier > 1}>
                      <span class="badge badge-ghost badge-sm ml-1">×{m.multiplier}</span>
                    </Show>
                  </td>
                  <td class="text-right tabular-nums">
                    <Show when={m.pattern} fallback={props.t.noValue}>
                      <span title={patternTooltip(m)}>{fmt(requestCost(m, props.basis))}</span>
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

