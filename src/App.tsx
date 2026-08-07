import { createEffect, createSignal } from "solid-js";
import type { ChangelogData, PriceData } from "./types";
import { i18n, type Lang } from "./i18n";
import { VALID_SORT, type FreeSortState, type SortState } from "./sort";
import { CAP_IDS, type CapId } from "./capabilities";
import Header from "./components/Header";
import Hero from "./components/Hero";
import PriceTable from "./components/PriceTable";
import FreeModelsTable from "./components/FreeModelsTable";
import Changelog from "./components/Changelog";
import Legal from "./components/Legal";
import Footer from "./components/Footer";
import dataJson from "../data/latest.json";
import changelogJson from "./data/changelog.json";

const data = dataJson as unknown as PriceData;
const changelogData = changelogJson as unknown as ChangelogData;

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
    VALID_SORT.includes(f as SortState["field"]) && (d === "asc" || d === "desc")
      ? { field: f as SortState["field"], dir: (d === "asc" ? 1 : -1) as 1 | -1 }
      : null;
  const [ff, fd] = (p.get("fsort") ?? "").split(":");
  const fsort =
    (ff === "model" || ff === "availableFrom") && (fd === "asc" || fd === "desc")
      ? { field: ff as FreeSortState["field"], dir: (fd === "asc" ? 1 : -1) as 1 | -1 }
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

  return (
    <div class="min-h-screen w-full bg-base-100 text-base-content">
      <Header lang={lang()} setLang={setLang} dark={dark()} setDark={setDark} onReset={resetAll} />
      <main class="mx-auto max-w-5xl px-4 py-8">
        <Hero t={t()} modelCount={data.models.length} />
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
          monthlyCredit={data.monthlyCredit}
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
        <Changelog entries={changelogData.entries} t={t()} lang={lang()} monthlyCredit={data.monthlyCredit} />
        <Legal t={t()} />
      </main>
      <Footer t={t()} data={data} lang={lang()} />
    </div>
  );
}
