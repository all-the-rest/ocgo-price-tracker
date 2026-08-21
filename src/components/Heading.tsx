import type { JSX } from "solid-js";

interface HeadingProps {
  /** Target element id (a `<section>` or any element) this heading links to. */
  anchor: string;
  class?: string;
  children: JSX.Element;
}

// Baut die kanonische Direkt-URL zu einem Ziel: aktueller Pfad + komplette
// Query-Parameter (Sprache, Theme, Sortierung, Filter, …) + `#id`. So ist der
// kopierte Link in exakt dem dargestellten Zustand teilbar.
// SSR-safe: im Server-Render (node --test sorting, renderToString) gibt es
// kein window — dort genügt der reine Hash-Anker.
export function directHref(id: string): string {
  if (typeof window === "undefined") return "#" + id;
  return window.location.pathname + window.location.search + "#" + id;
}

// Wiederkehrender `#`-Anker für ein beliebiges Ziel — neben den Abschnitts-
// überschriften auch für dynamische Ziele wie einzelne Changelog-Einträge.
// Dauerhaft sichtbar (Mobile hat kein Hover!), erbt die Schriftgröße der
// umgebenden Überschrift, p-1 hält die Hit-Area mobil tippbar.
export function AnchorLink(props: { id: string; label: string }) {
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    const url = directHref(props.id);
    // writeText lehnt asynchron ab (z.B. ohne Clipboard-Permission) — das
    // Promise muss selbst gefangen werden, ein try/catch reicht nicht.
    navigator.clipboard?.writeText(url).catch(() => {});
    window.history.replaceState(null, "", url);
    document.getElementById(props.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <a
      href={directHref(props.id)}
      onClick={onClick}
      aria-label={props.label}
      title="Direktlink kopieren"
      class="select-none p-1 text-base-content/40 transition-colors hover:text-primary focus:text-primary"
    >
      #
    </a>
  );
}

// Überschrift mit dauerhaft sichtbarem `#`-Anker: klickt den Direktlink
// (inkl. aller Query-Parameter), kopiert ihn in die Zwischenablage,
// aktualisiert die Adresszeile und scrollt zum Abschnitt. Der Anker fließt
// INLINE nach dem Überschriftentext und ERBT dessen Schriftgröße/-gewicht —
// lange Titel brechen natürlich um.
export default function Heading(props: HeadingProps) {
  return (
    <h2 class={props.class ?? "text-lg font-bold tracking-tight"}>
      {props.children}
      <AnchorLink id={props.anchor} label="Direktlink zu diesem Abschnitt (inkl. aller Filter)" />
    </h2>
  );
}
