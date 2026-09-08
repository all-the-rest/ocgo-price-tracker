import { createEffect, createMemo, createSignal, For, onMount } from "solid-js";
import type { Model, PeakHours } from "../types";
import type { CapId } from "../capabilities";
import type { Lang } from "../i18n";
import {
  DEFAULT_SHARE,
  SHARE_SIZES,
  autoTopN,
  buildShareSvg,
  buildShareUrl,
  downloadTextFile,
  isPortraitSize,
  shareI18n,
  svgToPngBlob,
  topModels,
  type ShareConfig,
  type ShareLang,
  type ShareSize,
  type ShareTheme,
} from "../share";

interface ShareDialogProps {
  models: Model[];
  lang: Lang;
  dark: boolean;
  fetchedAt: string;
  site: string;
  peakHours?: PeakHours;
  /** Page capability filter (OR-semantics, like the table): card default, always in sync. */
  caps: CapId[];
}

const DIALOG_ID = "share_modal";

export function openShareDialog(): void {
  const el = document.getElementById(DIALOG_ID) as HTMLDialogElement | null;
  el?.showModal();
}

export default function ShareDialog(props: ShareDialogProps) {
  // Initial config: explicit ?shareTheme/shareSize params win (shared links),
  // otherwise fall back to the page state. The metric is always total
  // requests; old ?metric=cost/input/output links coerce to it. TopN is
  // automatic per preset (OG/Twitter Top 5, IG Top 10, Story Top 15) — a legacy ?topN=
  // param is tolerated but ignored. Old ?shareSize=square|wide links coerce
  // to OG.
  const qp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const qpTheme = qp?.get("shareTheme");
  const qpSize = qp?.get("shareSize");
  const [theme, setTheme] = createSignal<ShareTheme>(
    qpTheme === "dark" || qpTheme === "light" ? qpTheme : props.dark ? "dark" : "light",
  );
  const [size, setSize] = createSignal<ShareSize>(
    qpSize === "og" || qpSize === "twitter" || qpSize === "ig" || qpSize === "story"
      ? qpSize
      : DEFAULT_SHARE.size,
  );
  const [notice, setNotice] = createSignal<string>("");

  // Dialog language, independent from the main UI language:
  // explicit ?lang param (shared links) wins, then the stored share choice,
  // otherwise the current UI language. An explicit choice (param, stored
  // value, or manual switch) is never overridden by later UI-lang changes.
  const qpLang = qp?.get("lang");
  let storedShareLang: string | null = null;
  try {
    storedShareLang = typeof localStorage !== "undefined" ? localStorage.getItem("ocgo-share-lang") : null;
  } catch {
    storedShareLang = null;
  }
  const initialShareLang: ShareLang =
    qpLang === "de" || qpLang === "en"
      ? qpLang
      : storedShareLang === "de" || storedShareLang === "en"
        ? storedShareLang
        : props.lang;
  const [shareLang, setShareLang] = createSignal<ShareLang>(initialShareLang);
  const [shareLangExplicit, setShareLangExplicit] = createSignal<boolean>(
    qpLang === "de" || qpLang === "en" || storedShareLang === "de" || storedShareLang === "en",
  );
  const setShareLangChoice = (l: ShareLang) => {
    setShareLangExplicit(true);
    setShareLang(l);
  };
  // Follow the UI language until the user makes an explicit share choice.
  createEffect(() => {
    if (!shareLangExplicit()) setShareLang(props.lang);
  });
  // Persist the explicit choice for the next visit.
  createEffect(() => {
    if (!shareLangExplicit()) return;
    try {
      localStorage.setItem("ocgo-share-lang", shareLang());
    } catch {
      // ignore (private mode etc.)
    }
  });

  const st = () => shareI18n[shareLang()];

  onMount(() => {
    if (typeof window !== "undefined" && window.location.hash === "#share") openShareDialog();
  });

  const cfg = createMemo<ShareConfig>(() => ({
    metric: DEFAULT_SHARE.metric,
    // Automatic TopN per preset (OG/Twitter Top 5, IG Top 10, Story Top 15),
    // rendered live from the current data/sort — never hardcoded.
    topN: autoTopN(size()),
    theme: theme(),
    size: size(),
  }));

  const rows = createMemo(() => topModels(props.models, cfg().topN, props.caps));

  const svg = createMemo(() =>
    buildShareSvg({
      rows: rows(),
      cfg: cfg(),
      lang: shareLang(),
      fetchedAt: props.fetchedAt,
      site: props.site,
      peakHours: props.peakHours,
    }),
  );

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 2000);
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    flash(st().shareCopied);
  };

  const onDownloadPng = async () => {
    const { w, h } = SHARE_SIZES[size()];
    const blob = await svgToPngBlob(svg(), w, h);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `top${cfg().topN}-${size()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onCopyLink = () =>
    copyText(buildShareUrl(window.location.origin, window.location.pathname, cfg(), shareLang(), props.caps));

  return (
    <dialog id={DIALOG_ID} class="modal" aria-labelledby="share-title">
        <div class="modal-box relative max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <form method="dialog">
            <button
              aria-label={st().shareClose}
              class="btn btn-circle btn-ghost btn-sm absolute right-2 top-2"
            >
              <span class="icon-[material-symbols--close] h-5 w-5" aria-hidden="true" />
            </button>
          </form>
          <div class="flex items-start justify-between gap-2 pr-10">
            <h3 id="share-title" class="text-lg font-bold">
              {st().shareTitle}
            </h3>
          </div>
          <p class="py-2 text-sm text-base-content/70">{st().shareDesc}</p>

          <div class="grid gap-4 sm:grid-cols-3">
            <fieldset>
              <legend class="label">{st().shareLang}</legend>
              <div class="join join-vertical sm:join-horizontal" role="group" aria-label={st().shareLang}>
                <button
                  class="join-item btn btn-sm"
                  classList={{ "btn-active": shareLang() === "de" }}
                  onClick={() => setShareLangChoice("de")}
                >
                  DE
                </button>
                <button
                  class="join-item btn btn-sm"
                  classList={{ "btn-active": shareLang() === "en" }}
                  onClick={() => setShareLangChoice("en")}
                >
                  EN
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend class="label">{st().shareTheme}</legend>
              <div class="join join-vertical sm:join-horizontal">
                <button
                  class="join-item btn btn-sm"
                  classList={{ "btn-active": theme() === "dark" }}
                  onClick={() => setTheme("dark")}
                >
                  {st().shareThemeDark}
                </button>
                <button
                  class="join-item btn btn-sm"
                  classList={{ "btn-active": theme() === "light" }}
                  onClick={() => setTheme("light")}
                >
                  {st().shareThemeLight}
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend class="label">{st().shareSize}</legend>
              <select
                id="share-size"
                class="select select-bordered select-sm w-full"
                value={size()}
                onChange={(e) => setSize(e.currentTarget.value as ShareSize)}
              >
                <For each={Object.entries(SHARE_SIZES)}>
                  {([key, v]) => <option value={key}>{v.label}</option>}
                </For>
              </select>
            </fieldset>
          </div>

          <h4 class="mt-4 text-sm font-semibold">{st().sharePreview}</h4>
          <p class="text-xs text-base-content/70">{st().sharePreviewCaption}</p>
          {/* Preview image is contain-fit into 55vh: the wrapper caps the
              height (overflow hidden) and the SVG scales down to the bound
              (portrait: height-bound, width auto; landscape: width-bound),
              so image and dialog always fit the viewport. Exports use the
              native card size and are untouched. */}
          <div
            id="share-preview"
            class="mt-2 flex max-h-[55vh] justify-center overflow-hidden rounded-box border border-base-300"
          >
            <div
              innerHTML={svg()}
              class="min-h-0 min-w-0"
              classList={{
                "[&>svg]:block [&>svg]:h-auto [&>svg]:w-full": !isPortraitSize(size()),
                "[&>svg]:block [&>svg]:h-auto [&>svg]:w-auto [&>svg]:max-h-[55vh] [&>svg]:max-w-full":
                  isPortraitSize(size()),
              }}
            />
          </div>

          {notice() && (
            <div role="status" class="alert alert-success mt-3 py-2 text-sm">
              {notice()}
            </div>
          )}

          <div class="modal-action flex flex-wrap gap-2">
            <button class="btn btn-sm" onClick={() => void copyText(svg())}>
              {st().shareCopySvg}
            </button>
            <button
              class="btn btn-sm"
              onClick={() => downloadTextFile(`top${cfg().topN}-${size()}.svg`, svg(), "image/svg+xml")}
            >
              {st().shareDownloadSvg}
            </button>
            <button class="btn btn-sm btn-primary" onClick={() => void onDownloadPng()}>
              {st().shareDownloadPng}
            </button>
            <button class="btn btn-sm" onClick={() => void onCopyLink()}>
              {st().shareCopyLink}
            </button>
            <form method="dialog">
              <button class="btn btn-sm">{st().shareClose}</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button aria-label={st().shareClose}>close</button>
        </form>
      </dialog>
  );
}
