import type { Lang } from "../i18n";

interface HeaderProps {
  lang: Lang;
  setLang: (l: Lang) => void;
  dark: boolean;
  setDark: (v: boolean) => void;
  onReset: () => void;
}

export default function Header(props: HeaderProps) {
  return (
    <header class="navbar sticky top-0 z-10 bg-base-200 px-6 shadow-sm">
      <div class="navbar-start">
        <a
          href={window.location.pathname}
          class="inline-flex items-center"
          aria-label={
            props.lang === "de" ? "Preis-Tracking für OpenCode Go — Start" : "Price Tracking for OpenCode Go — Home"
          }
          onClick={(e) => {
            e.preventDefault();
            props.onReset();
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
          <span class="ml-2 text-lg font-bold">
            {props.lang === "de" ? "Preis-Tracking für OpenCode Go" : "Price Tracking for OpenCode Go"}
          </span>
        </a>
      </div>
      <div class="navbar-end gap-2">
        <div class="join">
          <button
            class="join-item btn btn-sm"
            classList={{ "btn-active": props.lang === "de" }}
            onClick={() => props.setLang("de")}
          >
            DE
          </button>
          <button
            class="join-item btn btn-sm"
            classList={{ "btn-active": props.lang === "en" }}
            onClick={() => props.setLang("en")}
          >
            EN
          </button>
        </div>
        <label class="swap swap-rotate p-1">
          <input
            type="checkbox"
            class="theme-controller"
            value="dark"
            checked={props.dark}
            onChange={(e) => props.setDark(e.currentTarget.checked)}
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
  );
}
