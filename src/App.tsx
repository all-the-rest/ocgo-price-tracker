import { createEffect, createSignal, onMount, Show } from "solid-js";
import type { Basis, ChangelogData, PlanId, PriceData } from "./types";
import { i18n, type Lang } from "./i18n";
import { BUILD_TIME_ISO } from "./buildInfo";
import { VALID_SORT, type FreeSortState, type PrivacySortState, type SortState } from "./sort";
import { CAP_IDS, type CapId } from "./capabilities";
import { DEFAULT_PLAN_ID, TAB_PLAN_IDS, isTabPlan, resolvePlan } from "./plans";
import Header from "./components/Header";
import Hero from "./components/Hero";
import PlanTabs from "./components/PlanTabs";
import PriceTable from "./components/PriceTable";
import FreeModelsTable from "./components/FreeModelsTable";
import PrivacyTable from "./components/PrivacyTable";
import Changelog from "./components/Changelog";
import Legal from "./components/Legal";
import Footer from "./components/Footer";
import ShareDialog from "./components/ShareDialog";
import dataJson from "../data/latest.json";
import changelogJson from "./data/changelog.json";

const data = dataJson as unknown as PriceData;
const changelogData = changelogJson as unknown as ChangelogData;

// `typeof window` statt `typeof localStorage`: In Node (SSR-Build) würde der
// Zugriff auf das globale `localStorage` eine Experimental-Warnung auslösen.
const storedLang = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
const storedTheme = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
const browserLang =
  typeof navigator !== "undefined" ? (navigator.language || "").toLowerCase() : "";
const defaultLang: Lang =
  storedLang === "de" || storedLang === "en" ? storedLang : browserLang.startsWith("de") ? "de" : "en";

function readParams(): {
  plan: PlanId | null;
  sort: SortState | null;
  fsort: FreeSortState | null;
  psort: PrivacySortState | null;
  basis: Basis | null;
  lang: "de" | "en" | null;
  theme: "dark" | "light" | null;
  cap: CapId[] | null;
  fcap: CapId[] | null;
} {
  const p =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const planRaw = p.get("plan");
  const plan = isTabPlan(planRaw) ? planRaw : null;
  const [f, d] = (p.get("sort") ?? "").split(":");
  const sort =
    VALID_SORT.includes(f as SortState["field"]) && (d === "asc" || d === "desc")
      ? { field: f as SortState["field"], dir: (d === "asc" ? 1 : -1) as 1 | -1 }
      : null;
  const [ff, fd] = (p.get("fsort") ?? "").split(":");
  const fsort =
    (ff === "model" || ff === "availableFrom") && (fd === "asc" || fd === "desc")
      ? { field: ff as FreeSortState["field"], dir: (fd === "asc" ? 1 : -1) as 1 | -1 }
      : null;
  const [pf, pd] = (p.get("psort") ?? "").split(":");
  const psort =
    (pf === "model" || pf === "tier") && (pd === "asc" || pd === "desc")
      ? { field: pf as PrivacySortState["field"], dir: (pd === "asc" ? 1 : -1) as 1 | -1 }
      : null;
  const b = p.get("basis");
  const basis: Basis | null = b === "list" || b === "full" || b === "paid" ? b : null;
  const l = p.get("lang");
  const lang: "de" | "en" | null = l === "de" || l === "en" ? l : null;
  const themeRaw = p.get("theme");
  const theme: "dark" | "light" | null =
    themeRaw === "dark" || themeRaw === "light" ? themeRaw : null;
  const parseCaps = (raw: string | null): CapId[] | null =>
    raw === null
      ? null
      : Array.from(new Set(raw.split(",").filter((x): x is CapId => (CAP_IDS as readonly string[]).includes(x))));
  const cap = parseCaps(p.get("cap"));
  const fcap = parseCaps(p.get("fcap"));
  return { plan, sort, fsort, psort, basis, lang, theme, cap, fcap };
}

function prefersDarkSystem(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveInitialDark(
  themeParam: "dark" | "light" | null,
  stored: string | null,
): boolean {
  if (themeParam === "dark") return true;
  if (themeParam === "light") return false;
  if (stored === "dark") return true;
  if (stored === "light") return false;
  return prefersDarkSystem();
}

/**
 * Kanonischer Pfad für eine Sprache: Englisch ohne Präfix, Deutsch unter `/de`.
 * Die Seiten werden beim Build für beide Sprachen vorgerendert
 * (`dist/index.html`, `dist/de/index.html`).
 */
function langPath(lang: Lang): string {
  const raw = typeof window !== "undefined" ? window.location.pathname : "/";
  const stripped = raw.replace(/^\/de(?=\/|$)/, "") || "/";
  if (lang === "en") return stripped;
  return stripped === "/" ? "/de/" : "/de" + stripped;
}

/** Sprache aus dem Pfadpräfix — synchron, damit die Hydration zum File passt. */
function pathLang(): Lang {
  if (typeof window === "undefined") return "en";
  return /^\/de(\/|$)/.test(window.location.pathname) ? "de" : "en";
}

/** Vom Inline-Script in index.html gesetztes Theme (vermeidet Hell-Flackern). */
function initialDark(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { __OCGO_THEME_DARK__?: boolean }).__OCGO_THEME_DARK__ === true
  );
}

interface AppProps {
  /** Beim Prerender erzwungene Sprache (Server). Client leitet sie aus dem Pfad ab. */
  initialLang?: Lang;
}

export default function App(props: AppProps = {}) {
  // SSR- und Client-Erstrender müssen identisch sein: Default `en` (bzw. die
  // beim Prerender erzwungene Sprache). Gespeicherte Sprache/Browser-Locale und
  // `?lang=…`/Sortierung/Filter werden erst NACH der Hydration angewendet.
  const [lang, setLang] = createSignal<Lang>(props.initialLang ?? pathLang());
  const [dark, _setDark] = createSignal<boolean>(initialDark());
  // Explicit user toggle: always persist, so first load (system default)
  // leaves localStorage untouched until the user actually toggles.
  const setDark = (v: boolean) => {
    _setDark(v);
    try {
      localStorage.setItem("theme", v ? "dark" : "light");
    } catch {
      // ignore (private mode etc.)
    }
  };
  const [basis, setBasis] = createSignal<Basis>("full");
  const [planId, setPlanId] = createSignal<PlanId>(DEFAULT_PLAN_ID);
  const [sort, setSort] = createSignal<SortState>({ field: "requests", dir: -1 });
  const [freeSort, setFreeSort] = createSignal<FreeSortState>({ field: "availableFrom", dir: -1 });
  const [privacySort, setPrivacySort] = createSignal<PrivacySortState>({ field: "tier", dir: 1 });
  const [caps, setCaps] = createSignal<CapId[]>([]);
  const [freeCaps, setFreeCaps] = createSignal<CapId[]>([]);
  const [showTraining, setShowTraining] = createSignal(true);

  const t = () => i18n[lang()];

  onMount(() => {
    // Gespeicherte Sprache, `?lang=…` und alle weiteren Query-Parameter erst
    // nach der Hydration anwenden — vorher rendert der Client exakt das
    // vorgerenderte Markup.
    const p = readParams();
    // Reihenfolge: explizites `?lang=` gewinnt, sonst die gespeicherte Wahl,
    // sonst bleibt die aus dem Pfadpräfix abgeleitete Sprache bestehen.
    // Sprache: Der Pfad (`/de/`) ist die Quelle der Wahrheit; `?lang=` gewinnt
    // als expliziter Alias. Auf der präfixlosen Standardseite wird eine frühere
    // Wahl aus localStorage angewandt, sonst (ohne Wahl) die Browser-Sprache
    // (`de*` → `/de/`). Beides läuft erst nach der Hydration und führt über den
    // URL-Effekt auf die kanonische Pfadform — nicht umgekehrt, sonst würde
    // `/de/` überschrieben. Crawler (ohne navigator) bleiben auf Englisch.
    const stored: Lang | null = storedLang === "de" || storedLang === "en" ? storedLang : null;
    const browserDe =
      typeof navigator !== "undefined" && (navigator.language || "").toLowerCase().startsWith("de");
    if (p.lang) setLang(p.lang);
    else if (pathLang() === "en" && stored) setLang(stored);
    else if (pathLang() === "en" && browserDe) setLang("de");
    if (p.plan) setPlanId(p.plan);
    if (p.basis) setBasis(p.basis);
    if (p.sort) setSort(p.sort);
    if (p.fsort) setFreeSort(p.fsort);
    if (p.psort) setPrivacySort(p.psort);
    if (p.cap) setCaps(p.cap);
    if (p.fcap) setFreeCaps(p.fcap);
    _setDark(resolveInitialDark(p.theme, storedTheme));
  });

  // Aktuell genau ein Tab-Plan → keine sichtbaren Tabs; die Hülle ist bereit
  // für weitere Pläne (dann: Tabs einblenden, Modelle pro Plan filtern).
  const tabPlans = () => (data.plans ?? []).filter((p) => (TAB_PLAN_IDS as readonly string[]).includes(p.id));
  const plan = () => resolvePlan(data, planId());

  createEffect(() => {
    document.documentElement.lang = lang();
    localStorage.setItem("lang", lang());
  });

  createEffect(() => {
    const el = document.documentElement;
    if (dark()) {
      el.setAttribute("data-theme", "dark");
    } else {
      el.removeAttribute("data-theme");
    }
  });

  // Follow OS theme while the user has no explicit choice
  // (no localStorage entry and no ?theme param).
  if (typeof window !== "undefined" && typeof window.matchMedia !== "undefined") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem("theme") !== null) return;
      if (readParams().theme !== null) return;
      _setDark(e.matches);
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
  }

  const defaultBasis: Basis = "full";

  createEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (planId() === DEFAULT_PLAN_ID) p.delete("plan");
    else p.set("plan", planId());
    const s = sort();
    if (s.field === "cost" && s.dir === 1) p.delete("sort");
    else p.set("sort", `${s.field}:${s.dir === 1 ? "asc" : "desc"}`);
    const fs = freeSort();
    if (fs.field === "availableFrom" && fs.dir === -1) p.delete("fsort");
    else p.set("fsort", `${fs.field}:${fs.dir === 1 ? "asc" : "desc"}`);
    const ps = privacySort();
    if (ps.field === "tier" && ps.dir === 1) p.delete("psort");
    else p.set("psort", `${ps.field}:${ps.dir === 1 ? "asc" : "desc"}`);
    if (basis() === defaultBasis) p.delete("basis");
    else p.set("basis", basis());
    // Sprache steckt jetzt im Pfad (`/` bzw. `/de/`) — den Alias `?lang`
    // entfernen, damit die kanonische URL eindeutig bleibt (alte Links werden
    // beim Laden weiterhin akzeptiert, siehe onMount).
    p.delete("lang");
    if (caps().length === 0) p.delete("cap");
    else p.set("cap", caps().join(","));
    if (freeCaps().length === 0) p.delete("fcap");
    else p.set("fcap", freeCaps().join(","));
    const qs = p.toString();
    const base = langPath(lang());
    const url = (qs ? base + "?" + qs : base) + window.location.hash;
    history.replaceState(null, "", url);
  });

  const resetAll = () => {
    setPlanId(DEFAULT_PLAN_ID);
    setSort({ field: "cost", dir: 1 });
    setFreeSort({ field: "availableFrom", dir: -1 });
    setPrivacySort({ field: "tier", dir: 1 });
    setBasis(defaultBasis);
    setLang(defaultLang);
    setCaps([]);
    setFreeCaps([]);
    history.replaceState(null, "", langPath(defaultLang));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div class="min-h-screen w-full bg-base-100 text-base-content">
      <Header lang={lang()} setLang={setLang} dark={dark()} setDark={setDark} onReset={resetAll} t={t()} />
      <main class="mx-auto max-w-6xl px-4 py-8">
        <Hero
          t={t()}
          modelCount={data.models.length}
          plan={plan()}
        />
        <Show when={tabPlans().length > 1}>
          <PlanTabs plans={tabPlans()} active={planId()} onSelect={setPlanId} t={t()} />
        </Show>
        <ShareDialog
          models={data.models}
          lang={lang()}
          dark={dark()}
          fetchedAt={BUILD_TIME_ISO}
          site="ocgo-pricing.all-the.rest"
          peakHours={data.peakHours}
          caps={caps()}
        />
        <PriceTable
          models={data.models}
          t={t()}
          lang={lang()}
          basis={basis()}
          setBasis={setBasis}
          sort={sort()}
          setSort={setSort}
          caps={caps()}
          setCaps={setCaps}
          showTraining={showTraining()}
          setShowTraining={setShowTraining}
          plan={plan()}
          peakHours={data.peakHours}
        />
        <FreeModelsTable
          freeModels={data.freeModels}
          t={t()}
          lang={lang()}
          sort={freeSort()}
          setSort={setFreeSort}
          caps={freeCaps()}
          setCaps={setFreeCaps}
        />
        <PrivacyTable
          models={data.models}
          freeModels={data.freeModels}
          t={t()}
          lang={lang()}
          sort={privacySort()}
          setSort={setPrivacySort}
        />
        <Changelog entries={changelogData.entries} t={t()} lang={lang()} plan={plan()} />
        <Legal t={t()} />
      </main>
      <Footer t={t()} data={data} lang={lang()} />
    </div>
  );
}
