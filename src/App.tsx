import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Capabilities, Change, ChangelogData, Model, PriceData, PricingType } from "./types";
import { i18n, type Lang } from "./i18n";
import { fmt, fmtDate, fmtDateOnly, formatModelName } from "./util";
import { fieldPrice, formatTokens, requestCost } from "./weighted";
import dataJson from "../data/latest.json";
import changelogJson from "./data/changelog.json";

const data = dataJson as unknown as PriceData;
const changelogData = changelogJson as unknown as ChangelogData;

type SortField = "name" | "input" | "output" | "cachedRead" | "cachedWrite" | "usage" | "cost";
type SortState = { field: SortField; dir: 1 | -1 };
type FreeSortField = "model" | "availableFrom";
type FreeSortState = { field: FreeSortField; dir: 1 | -1 };
type CapId = "image" | "video" | "audio" | "pdf";

const VALID_SORT: readonly SortField[] = ["name", "input", "output", "cachedRead", "cachedWrite", "usage", "cost"];
const CAP_IDS: readonly CapId[] = ["image", "video", "audio", "pdf"];

const storedLang = typeof localStorage !== "undefined" ? localStorage.getItem("lang") : null;
const storedTheme = typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null;
const storedBasis = typeof localStorage !== "undefined" ? localStorage.getItem("basis") : null;
const browserLang =
  typeof navigator !== "undefined" ? (navigator.language || "").toLowerCase() : "";
const defaultLang: Lang =
  storedLang === "de" || storedLang === "en" ? storedLang : browserLang.startsWith("de") ? "de" : "en";

function readParams(): {
  sort: SortState | null;
  fsort: FreeSortState | null;
  basis: "list" | "full" | null;
  lang: "de" | "en" | null;
  cap: CapId[] | null;
  fcap: CapId[] | null;
} {
  const p =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [f, d] = (p.get("sort") ?? "").split(":");
  const sort =
    VALID_SORT.includes(f as SortField) && (d === "asc" || d === "desc")
      ? { field: f as SortField, dir: (d === "asc" ? 1 : -1) as 1 | -1 }
      : null;
  const [ff, fd] = (p.get("fsort") ?? "").split(":");
  const fsort =
    (ff === "model" || ff === "availableFrom") && (fd === "asc" || fd === "desc")
      ? { field: ff as FreeSortField, dir: (fd === "asc" ? 1 : -1) as 1 | -1 }
      : null;
  const b = p.get("basis");
  const basis: "list" | "full" | null = b === "list" || b === "full" ? b : null;
  const l = p.get("lang");
  const lang: "de" | "en" | null = l === "de" || l === "en" ? l : null;
  const parseCaps = (raw: string | null): CapId[] | null =>
    raw === null
      ? null
      : Array.from(new Set(raw.split(",").filter((x): x is CapId => (CAP_IDS as readonly string[]).includes(x))));
  const cap = parseCaps(p.get("cap"));
  const fcap = parseCaps(p.get("fcap"));
  return { sort, fsort, basis, lang, cap, fcap };
}
const params = readParams();

function scrollToSection(id: string, e: MouseEvent) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function App() {
  const [lang, setLang] = createSignal<Lang>(params.lang ?? defaultLang);
  const [dark, setDark] = createSignal(storedTheme === "dark");
  const [basis, setBasis] = createSignal<"list" | "full">(
    params.basis ?? (storedBasis === "list" ? "list" : "full")
  );
  const [sort, setSort] = createSignal<SortState>(params.sort ?? { field: "cost", dir: 1 });
  const [freeSort, setFreeSort] = createSignal<FreeSortState>(
    params.fsort ?? { field: "availableFrom", dir: -1 }
  );
  const [caps, setCaps] = createSignal<CapId[]>(params.cap ?? []);
  const [freeCaps, setFreeCaps] = createSignal<CapId[]>(params.fcap ?? []);

  const t = () => i18n[lang()];

  const capsOf = (m: { capabilities: Capabilities | null }): Set<CapId> => {
    const c = m.capabilities;
    if (!c) return new Set<CapId>();
    return new Set(c.input.filter((mod): mod is CapId => mod !== "text"));
  };

  const capLabel = (id: CapId): string =>
    id === "pdf" ? t().capDocs : id === "image" ? t().capImage : id === "video" ? t().capVideo : t().capAudio;

  const capsBadges = (m: { capabilities: Capabilities | null }) => (
    <Show when={capsOf(m).size > 0} fallback={<span>{t().noValue}</span>}>
      <div class="flex flex-wrap gap-1">
        <For each={CAP_IDS}>
          {(id) => (
            <Show when={capsOf(m).has(id)}>
              <span class="badge badge-sm badge-ghost">{capLabel(id)}</span>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );

  const capsFilterRow = (value: () => CapId[], setter: (u: (prev: CapId[]) => CapId[]) => void) => (
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <span>{t().capsLabel}</span>
      <For each={CAP_IDS}>
        {(id) => (
          <label class="label cursor-pointer gap-2">
            <span class="label-text">{capLabel(id)}</span>
            <input
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
              checked={value().includes(id)}
              onChange={(e) =>
                setter((prev) =>
                  e.currentTarget.checked
                    ? prev.includes(id)
                      ? prev
                      : [...prev, id]
                    : prev.filter((x) => x !== id)
                )
              }
            />
          </label>
        )}
      </For>
    </div>
  );

  const fmtCaps = (c: Capabilities | null): string => {
    if (!c) return t().noValue;
    const parts: string[] = [];
    for (const id of CAP_IDS) {
      if (c.input.includes(id)) parts.push(capLabel(id));
    }
    return parts.length > 0 ? parts.join(", ") : t().noValue;
  };

  createEffect(() => {
    document.documentElement.lang = lang();
    localStorage.setItem("lang", lang());
  });

  createEffect(() => {
    const el = document.documentElement;
    if (dark()) {
      el.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      el.removeAttribute("data-theme");
      localStorage.setItem("theme", "light");
    }
  });

  createEffect(() => {
    localStorage.setItem("basis", basis());
  });

  const defaultBasis: "list" | "full" = storedBasis === "list" ? "list" : "full";

  createEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = sort();
    if (s.field === "cost" && s.dir === 1) p.delete("sort");
    else p.set("sort", `${s.field}:${s.dir === 1 ? "asc" : "desc"}`);
    const fs = freeSort();
    if (fs.field === "availableFrom" && fs.dir === -1) p.delete("fsort");
    else p.set("fsort", `${fs.field}:${fs.dir === 1 ? "asc" : "desc"}`);
    if (basis() === defaultBasis) p.delete("basis");
    else p.set("basis", basis());
    if (lang() === defaultLang) p.delete("lang");
    else p.set("lang", lang());
    if (caps().length === 0) p.delete("cap");
    else p.set("cap", caps().join(","));
    if (freeCaps().length === 0) p.delete("fcap");
    else p.set("fcap", freeCaps().join(","));
    const qs = p.toString();
    const url = (qs ? window.location.pathname + "?" + qs : window.location.pathname) + window.location.hash;
    history.replaceState(null, "", url);
  });

  const resetAll = () => {
    setSort({ field: "cost", dir: 1 });
    setFreeSort({ field: "availableFrom", dir: -1 });
    setBasis(defaultBasis);
    setLang(defaultLang);
    setCaps([]);
    setFreeCaps([]);
    history.replaceState(null, "", window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const sortValue = (m: Model, f: SortField): number | string | null => {
    if (f === "cost") return requestCost(m, basis());
    if (f === "name") return m.name.toLowerCase();
    return m[f];
  };

  const sorted = createMemo(() => {
    const { field, dir } = sort();
    const selected = caps();
    let models = data.models;
    if (selected.length > 0) {
      models = models.filter((m) => {
        const s = capsOf(m);
        return selected.some((cap) => s.has(cap));
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

  const sortedFree = createMemo(() => {
    const { field, dir } = freeSort();
    const selected = freeCaps();
    let models = data.freeModels;
    if (selected.length > 0) {
      models = models.filter((f) => {
        const s = capsOf(f);
        return selected.some((cap) => s.has(cap));
      });
    }
    return [...models].sort((a, b) => {
      const cmp =
        field === "availableFrom" ? a.availableFrom.localeCompare(b.availableFrom) : a.id.localeCompare(b.id);
      return cmp !== 0 ? cmp * dir : a.id.localeCompare(b.id);
    });
  });

  const thSort = (field: SortField, label: string, right?: boolean, tooltip?: string) => {
    const active = sort().field === field;
    return (
      <th class={right ? "text-right" : ""}>
        <button
          class="inline-flex items-center gap-1 whitespace-nowrap"
          classList={{ "text-primary": active }}
          aria-label={`${label} (${active ? (sort().dir === 1 ? "desc" : "asc") : "sort"})`}
          title={tooltip}
          onClick={() => setSort((s) => ({ field, dir: s.field === field ? (s.dir === 1 ? -1 : 1) : 1 }))}
        >
          {label}
          {active ? <span aria-hidden="true">{sort().dir === 1 ? "▲" : "▼"}</span> : null}
        </button>
      </th>
    );
  };

  const thFreeSort = (field: FreeSortField, label: string, right?: boolean) => {
    const active = freeSort().field === field;
    return (
      <th class={right ? "text-right" : ""}>
        <button
          class="inline-flex items-center gap-1 whitespace-nowrap"
          classList={{ "text-primary": active }}
          onClick={() =>
            setFreeSort((s) => ({ field, dir: s.field === field ? (s.dir === 1 ? -1 : 1) : 1 }))
          }
        >
          {label}
          {active ? <span aria-hidden="true">{freeSort().dir === 1 ? "▲" : "▼"}</span> : null}
        </button>
      </th>
    );
  };

  const patternTooltip = (m: Model) => {
    const p = m.pattern;
    if (!p) return "";
    return t()
      .patternTooltip.replace("{input}", formatTokens(p.input, lang()))
      .replace("{cached}", formatTokens(p.cachedRead, lang()))
      .replace("{output}", formatTokens(p.output, lang()));
  };

  const fmtPricing = (p: PricingType) =>
    `${fmt(p.input)} / ${fmt(p.output)} / ${fmt(p.cachedRead)} / ${fmt(p.cachedWrite)} @ $${p.usage}`;

  const priceEffective = (p: PricingType): number => {
    const mult = data.monthlyCredit / p.usage;
    const val = (x: number | null) => (x === null ? 0 : x * mult);
    return val(p.input) + val(p.output) + val(p.cachedRead) + val(p.cachedWrite);
  };

  const capCount = (c: Capabilities | null): number =>
    c ? c.input.length + c.output.length + (c.reasoning ? 1 : 0) + (c.toolCall ? 1 : 0) : 0;

  const changeBadge = (c: Change) => {
    const baseCls = "badge badge-sm shrink-0";
    switch (c.type) {
      case "model_added":
      case "free_added":
        return <span class={`${baseCls} badge-success`}>+</span>;
      case "model_removed":
      case "free_removed":
        return <span class={`${baseCls} badge-error`}>−</span>;
      case "pricing_changed": {
        const diff = priceEffective(c.to) - priceEffective(c.from);
        if (diff > 1e-9) return <span class={`${baseCls} badge-error`}>↑</span>;
        if (diff < -1e-9) return <span class={`${baseCls} badge-success`}>↓</span>;
        return <span class={`${baseCls} badge-ghost`}>≈</span>;
      }
      case "capabilities_changed": {
        const diff = capCount(c.to) - capCount(c.from);
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
        return <span>{c.lang[lang()]}</span>;
      case "model_added":
        return (
          <span>
            {t()
              .chgModelAdded.replace("{model}", c.model)
              .replace("{pricing}", fmtPricing(c.pricing))}
          </span>
        );
      case "model_removed":
        return <span>{t().chgModelRemoved.replace("{model}", c.model).replace("{days}", String(c.days))}</span>;
      case "pricing_changed":
        return (
          <span>
            {t()
              .chgPricing.replace("{model}", c.model)
              .replace("{from}", fmtPricing(c.from))
              .replace("{to}", fmtPricing(c.to))}
          </span>
        );
      case "capabilities_changed":
        return (
          <span>
            {t()
              .chgCaps.replace("{model}", c.model)
              .replace("{from}", fmtCaps(c.from))
              .replace("{to}", fmtCaps(c.to))}
          </span>
        );
      case "free_added":
        return <span>{t().chgFreeAdded.replace("{model}", formatModelName(c.model))}</span>;
      case "free_removed": {
        const days = Math.max(
          0,
          Math.round((Date.parse(c.until) - Date.parse(c.availableFrom)) / 86_400_000)
        );
        return (
          <span>
            {t()
              .chgFreeRemoved.replace("{model}", formatModelName(c.model))
              .replace("{days}", String(days))
              .replace("{from}", c.availableFrom)}
          </span>
        );
      }
    }
  };

  return (
    <div class="min-h-screen w-full bg-base-100 text-base-content">
      <header class="navbar sticky top-0 z-10 bg-base-200 px-6 shadow-sm">
        <div class="navbar-start">
          <a
            href={window.location.pathname}
            class="inline-flex items-center"
            aria-label="Price Tracking for OpenCode Go — Home"
            onClick={(e) => {
              e.preventDefault();
              resetAll();
            }}
          >
            <svg
              class="h-5 w-5 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M22 7l-8.5 8.5-5-5L2 17" />
              <path d="M16 7h6v6" />
            </svg>
            <span class="ml-2 text-lg font-bold">{lang() === "de" ? "Preis-Tracking für OpenCode Go" : "Price Tracking for OpenCode Go"}</span>
          </a>
        </div>
        <div class="navbar-end gap-2">
          <div class="join">
            <button
              class="join-item btn btn-sm"
              classList={{ "btn-active": lang() === "de" }}
              onClick={() => setLang("de")}
            >
              DE
            </button>
            <button
              class="join-item btn btn-sm"
              classList={{ "btn-active": lang() === "en" }}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>
          <label class="swap swap-rotate">
            <input
              type="checkbox"
              class="theme-controller"
              value="dark"
              checked={dark()}
              onChange={(e) => setDark(e.currentTarget.checked)}
            />
            <svg
              class="swap-on"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            <svg
              class="swap-off"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </label>
        </div>
      </header>

      <main class="mx-auto max-w-5xl px-4 py-8">
        <section>
          <h1 class="text-2xl font-bold tracking-tight">{t().title}</h1>
          <p class="text-base-content/60">{t().subtitle}</p>
          <p class="mt-3 max-w-3xl text-sm leading-relaxed text-base-content/70">{t().intro}</p>

          <div class="stats stats-vertical mt-6 w-full shadow sm:stats-horizontal sm:w-auto">
            <div class="stat">
              <div class="stat-title">{t().statsCreditTitle}</div>
              <div class="stat-value">{t().statsCreditValue}</div>
              <div class="stat-desc">{t().statsCreditDesc}</div>
            </div>
            <div class="stat">
              <div class="stat-title">{t().statsSubTitle}</div>
              <div class="stat-value">{t().plan}</div>
              <div class="stat-desc">{t().statsSubDesc}</div>
            </div>
            <div class="stat">
              <div class="stat-title">{t().statsModelsTitle}</div>
              <div class="stat-value">{data.models.length}</div>
              <div class="stat-desc">{t().statsModelsDesc}</div>
            </div>
          </div>
        </section>

        <section class="mt-10">
          <h2 class="text-lg font-bold tracking-tight">{t().headingPrices}</h2>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <span>{t().basisLabel}</span>
            <div class="join">
              <button
                class="join-item btn btn-sm"
                classList={{ "btn-active": basis() === "list" }}
                onClick={() => setBasis("list")}
              >
                {t().basisList}
              </button>
              <button
                class="join-item btn btn-sm"
                classList={{ "btn-active": basis() === "full" }}
                onClick={() => setBasis("full")}
              >
                {t().basisFull}
              </button>
            </div>
            <Show when={basis() === "full"}>
              <span class="text-sm text-base-content/50">
                {t().factorNote.replace("{n}", String(data.monthlyCredit / 15))}
              </span>
            </Show>
          </div>

          {capsFilterRow(caps, setCaps)}

          <div class="mt-4 max-w-full overflow-x-auto">
            <table class="table table-zebra table-sm table-pin-rows">
              <thead>
                <tr>
                  {thSort("name", t().colModel)}
                  <th>{t().capsLabel}</th>
                  {thSort("input", t().colInput, true)}
                  {thSort("output", t().colOutput, true)}
                  {thSort("cachedRead", t().colCachedRead, true)}
                  {thSort("cachedWrite", t().colCachedWrite, true)}
                  {thSort("usage", t().colUsage, true)}
                  {thSort("cost", t().colWeighted, true, t().tooltipWeighted)}
                </tr>
                <tr>
                  <th></th>
                  <th></th>
                  <th class="text-right font-normal text-base-content/40">{t().per1m}</th>
                  <th class="text-right font-normal text-base-content/40">{t().per1m}</th>
                  <th class="text-right font-normal text-base-content/40">{t().per1m}</th>
                  <th class="text-right font-normal text-base-content/40">{t().per1m}</th>
                  <th></th>
                  <th class="text-right font-normal text-base-content/40">{t().perReq}</th>
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
                      <td>{capsBadges(m)}</td>
                      <td class="text-right tabular-nums">{fmt(fieldPrice(m, "input", basis()))}</td>
                      <td class="text-right tabular-nums">{fmt(fieldPrice(m, "output", basis()))}</td>
                      <td class="text-right tabular-nums">{fmt(fieldPrice(m, "cachedRead", basis()))}</td>
                      <td class="text-right tabular-nums">{fmt(fieldPrice(m, "cachedWrite", basis()))}</td>
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
                        <Show when={basis() === "full" && m.multiplier > 1}>
                          <span class="badge badge-ghost badge-sm ml-1">×{m.multiplier}</span>
                        </Show>
                      </td>
                      <td class="text-right tabular-nums">
                        <Show when={m.pattern} fallback={t().noValue}>
                          <span title={patternTooltip(m)}>
                            {fmt(requestCost(m, basis()))}
                          </span>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </section>

        <Show when={data.freeModels.length > 0}>
          <section class="mt-10">
            <h2 class="text-lg font-bold tracking-tight">{t().headingFree}</h2>
            <p class="mt-1 text-sm text-base-content/50">{t().freeModelsNote}</p>
            {capsFilterRow(freeCaps, setFreeCaps)}
            <div class="mt-4 w-full overflow-x-auto">
              <table class="table table-sm table-zebra">
                <thead>
                  <tr>
                    {thFreeSort("model", t().colModel)}
                    <th>{t().capsLabel}</th>
                    {thFreeSort("availableFrom", t().colAvailableFrom, true)}
                  </tr>
                </thead>
                <tbody>
                  <For each={sortedFree()}>
                    {(f) => (
                      <tr>
                        <td class="font-medium">{formatModelName(f.id)}</td>
                        <td>{capsBadges(f)}</td>
                        <td class="text-right tabular-nums">
                          {fmtDateOnly(`${f.availableFrom}T00:00:00.000Z`, lang())}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </section>
        </Show>

        <section class="mt-10">
          <h2 class="text-lg font-bold tracking-tight">{t().headingChangelog}</h2>
          <div class="mt-2 max-w-3xl text-sm leading-relaxed text-base-content/80">
            <For each={changelogData.entries}>
              {(entry) => (
                <div class="mt-4">
                  <h3 class="text-sm font-semibold text-base-content/70">{entry.date}</h3>
                  <Show when={entry.changes.length > 0} fallback={<p class="mt-1">{t().chgNone}</p>}>
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

        <section id="impressum" class="mt-10">
          <h2 class="text-lg font-bold tracking-tight">{t().impressum}</h2>
          <div class="mt-2 text-sm leading-relaxed text-base-content/80">
            <p class="font-medium">Florian Reisinger</p>
            <p>Robert-Stolz-Straße 8</p>
            <p>4020 Linz, Österreich</p>
            <p>
              E-Mail:
              <a href="mailto:hello@all-the.rest" class="link link-primary">
                hello@all-the.rest
              </a>
            </p>
            <p class="mt-3 text-base-content/50">Angaben gemäß § 5 ECG. Privates, nicht-kommerzielles Projekt.</p>
          </div>
        </section>

        <section id="datenschutz" class="mt-10">
          <h2 class="text-lg font-bold tracking-tight">{t().datenschutz}</h2>
          <div class="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-base-content/80">
            <p>
              Diese Seite verwendet die selbst gehostete, datenschutzfreundliche Analyse-Software
              unter stats.all-the.rest. Es werden ausschließlich anonymisierte Statistikdaten
              erfasst (aufgerufene Seiten, Titel, Referrer, Bildschirmgröße, Sprache). Keine
              Cookies, keine gespeicherten IP-Adressen; Besuchererkennung über Einweg-Hash.
              Rückschlüsse auf einzelne Personen sind nicht möglich. Rechtsgrundlage:
              Art. 6 Abs. 1 lit. f DSGVO.
            </p>
            <p>
              Ihre Rechte: Auskunft, Berichtigung, Löschung, Einschränkung und Widerspruch — Kontakt
              über hello@all-the.rest. Weiters Beschwerderecht bei der österreichischen
              Datenschutzbehörde (Barichgasse 40–42, 1030 Wien).
            </p>
          </div>
        </section>
      </main>

      <footer class="mx-auto max-w-5xl px-4 pb-10">
        <div class="flex flex-col gap-2 border-t border-base-300 pt-4 text-xs text-base-content/40">
          <p class="max-w-3xl">{t().metricNote}</p>
          <p class="max-w-3xl">{t().freeAvailableNote}</p>
          <span>
            {t().fetchedAt}: {fmtDate(data.fetchedAt, lang())}
          </span>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" class="underline">
              {t().sourceLink}
            </a>
            <a href={data.freeModelsSourceUrl} target="_blank" rel="noopener noreferrer" class="underline">
              {t().sourceZen}
            </a>
            <a href={data.capabilitiesSourceUrl} target="_blank" rel="noopener noreferrer" class="underline">
              {t().sourceCaps}
            </a>
            <a href="#impressum" class="underline" onClick={(e) => scrollToSection("impressum", e)}>
              {t().impressum}
            </a>
            <a href="#datenschutz" class="underline" onClick={(e) => scrollToSection("datenschutz", e)}>
              {t().datenschutz}
            </a>
          </div>
          <span>{t().footer}</span>
        </div>
      </footer>
    </div>
  );
}
