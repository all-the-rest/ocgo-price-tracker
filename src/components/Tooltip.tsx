import { createSignal, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

const BUBBLE =
  "max-w-xs rounded-md border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content shadow-lg";

interface TooltipProps {
  tip: string;
  children: JSX.Element;
  class?: string;
}

/**
 * Rendered die Bubble in einem Portal (position: fixed, viewport-basiert),
 * damit sie außerhalb von overflow-Scrollcontainern liegt — kein Abschneiden
 * und keine vertikale Scrollbar durch dauerhaft positionierte Pseudo-Elemente.
 */
export default function Tooltip(props: TooltipProps) {
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null);

  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const pad = 8;
    const probe = document.createElement("div");
    probe.className = `${BUBBLE} invisible absolute`;
    probe.textContent = props.tip;
    document.body.appendChild(probe);
    const w = probe.offsetWidth;
    const h = probe.offsetHeight;
    document.body.removeChild(probe);

    const left = Math.min(Math.max(r.left + r.width / 2, w / 2 + pad), window.innerWidth - w / 2 - pad);
    let top = r.bottom + pad;
    if (top + h > window.innerHeight - pad) top = r.top - h - pad;
    setPos({ top: Math.max(pad, top), left });
  };

  const hide = () => setPos(null);

  return (
    <>
      <span class={props.class} onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={hide}>
        {props.children}
      </span>
      <Show when={pos()}>
        {(p) => (
          <Portal>
            <div
              role="tooltip"
              class={`${BUBBLE} pointer-events-none fixed z-50`}
              style={{ top: `${p().top}px`, left: `${p().left}px`, transform: "translateX(-50%)" }}
            >
              {props.tip}
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
