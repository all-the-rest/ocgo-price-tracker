import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

const BUBBLE =
  "max-w-xs rounded-md border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content shadow-lg";

interface TooltipProps {
  tip: string;
  children: JSX.Element;
  class?: string;
  side?: "bottom" | "right";
}

/**
 * Rendered die Bubble in einem Portal (position: fixed, viewport-basiert),
 * damit sie außerhalb von overflow-Scrollcontainern liegt — kein Abschneiden
 * und keine vertikale Scrollbar durch dauerhaft positionierte Pseudo-Elemente.
 *
 * Erreichbar über Hover (Maus), Fokus (Tastatur, tabIndex=0) und Tap/Klick
 * (Touch: anpinnen). Ein Klick außerweise den Trigger schließt die angepinnte
 * Bubble wieder (Outside-Pointer-Handler). Beim Scrollen/Resizen wird die
 * Bubble neu positioniert, damit sie am Trigger "kleben" bleibt (scrollt mit).
 */
export default function Tooltip(props: TooltipProps) {
  const [pos, setPos] = createSignal<{ top: number; left: number; transform: string } | null>(null);
  const [pinned, setPinned] = createSignal(false);
  let span: HTMLSpanElement | undefined;

  // `pinned` schützt die angezeigte Bubble davor, beim Wegbewegen der Maus
  // oder bei Fokus-Verlust ausgeblendet zu werden — gelöscht wird sie nur
  // durch exploses Wegtippen (Klick außerhalb / erneuter Klick). `pos()` allein
  // steuert das Rendering (Show), damit der Accessor-Typ sauber bleibt.
  const close = () => {
    setPinned(false);
    setPos(null);
  };

  const computePos = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const pad = 8;
    const probe = document.createElement("div");
    probe.className = `${BUBBLE} invisible absolute`;
    probe.textContent = props.tip;
    document.body.appendChild(probe);
    const w = probe.offsetWidth;
    const h = probe.offsetHeight;
    document.body.removeChild(probe);

    let top: number, left: number, transform: string;
    if (props.side === "right") {
      left = r.right + pad;
      top = r.top + r.height / 2;
      transform = "translateY(-50%)";
    } else {
      left = Math.min(Math.max(r.left + r.width / 2, w / 2 + pad), window.innerWidth - w / 2 - pad);
      let t = r.bottom + pad;
      if (t + h > window.innerHeight - pad) t = r.top - h - pad;
      // Bubble vollständig innerhalb des Viewports halten (deckt auch den
      // unteren Rand ab, falls selbst die Aufklapp-Variante nicht passt).
      top = Math.max(pad, Math.min(t, window.innerHeight - h - pad));
      transform = "translateX(-50%)";
    }
    return { top, left, transform };
  };

  const show = (el: HTMLElement) => setPos(computePos(el));

  // Beim Verlassen (Hover/Blur) nur ausblenden, wenn nicht angepinnt — ein
  // angepinntes Toolpt bleibt beim Wegbewegen der Maus oder bei Fokus-Verlust
  // stehen und muss durch (Wieder-)Klick oder Tap außerhalb geschlossen werden.
  const hide = () => {
    if (!pinned()) close();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!pinned() || !span) return;
    if (!span.contains(e.target as Node)) close();
  };

  // onMount ist im SSR ein No-op — der Listener wird nur im Browser registriert.
  // onCleanup innerhalb von onMount: die Deregistrierung erfolgt nur, wenn der
  // Listener auch tatsächlich gesetzt wurde (vermeidet document-Zugriff im SSR).
  onMount(() => {
    document.addEventListener("pointerdown", onPointerDown);
    // Offene Bubble bei Scroll/Resize neu positionieren, damit sie am Trigger
    // kleben bleibt (scrollt mit der Seite) und die Rand-Umklappung neu prüft.
    const reposition = () => {
      if (pos() && span) setPos(computePos(span));
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    });
  });

  return (
    <>
      <span
        ref={span}
        class={props.class}
        data-tooltip-host=""
        tabIndex={0}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hide}
        onClick={(e) => (pinned() ? close() : (show(e.currentTarget), setPinned(true)))}
      >
        {props.children}
      </span>
      <Show when={pos()}>
        {(p) => (
          <Portal>
            <div
              role="tooltip"
              class={`${BUBBLE} pointer-events-none fixed z-50`}
              style={{ top: `${p().top}px`, left: `${p().left}px`, transform: p().transform }}
            >
              {props.tip}
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
