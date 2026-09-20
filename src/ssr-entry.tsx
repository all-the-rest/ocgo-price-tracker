import { generateHydrationScript, renderToString } from "solid-js/web";
import App from "./App";
import type { Lang } from "./i18n";

// `window._$HY` (Event-Delegation + Hydration-Runtime) muss im HTML stehen,
// bevor das Client-Bundle lädt — sonst scheitert `hydrate()` beim Start.
export { generateHydrationScript };

/**
 * Prerender-Einstieg (nur Build-Zeit, läuft in Node): rendert die komplette App
 * zu HTML, damit Crawler (und AI-Bots) ohne JS-Ausführung alle Inhalte sehen.
 *
 * Es wird pro Sprache einmal gerendert — Englisch für `dist/index.html`,
 * Deutsch für `dist/de/index.html`. Der Client leitet die Startsprache synchron
 * aus dem Pfadpräfix ab und wendet gespeicherte Sprache/`?lang=…`, Sortierung
 * und Filter erst NACH der Hydration an, damit Server- und Client-Markup
 * übereinstimmen (siehe `src/App.tsx`).
 */
export function renderApp(lang: Lang = "en"): string {
  return renderToString(() => <App initialLang={lang} />);
}
