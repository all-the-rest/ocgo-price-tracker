/**
 * Aktiviert Drag-to-Scroll auf einem horizontal scrollbaren Container
 * (Maus ziehen statt Scrollbalken). Klicks auf Buttons innerhalb des
 * Containers (z. B. Sortier-Header) bleiben erhalten — ein echter Drag
 * unterdrückt den nachfolgenden Click.
 */
export function setupDragScroll(el: HTMLElement): () => void {
  let down = false;
  let dragging = false;
  let startX = 0;
  let startLeft = 0;

  const end = (suppressClick: boolean) => {
    down = false;
    if (dragging) {
      el.classList.remove("cursor-grabbing");
      el.style.userSelect = "";
      if (suppressClick) {
        const suppress = (ce: Event) => {
          ce.preventDefault();
          ce.stopImmediatePropagation();
          el.removeEventListener("click", suppress, true);
        };
        el.addEventListener("click", suppress, true);
      }
      dragging = false;
    }
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    down = true;
    dragging = false;
    startX = e.clientX;
    startLeft = el.scrollLeft;
  };

  const onMove = (e: PointerEvent) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!dragging && Math.abs(dx) > 5) {
      dragging = true;
      el.classList.add("cursor-grabbing");
      el.style.userSelect = "none";
    }
    if (dragging) el.scrollLeft = startLeft - dx;
  };

  const onUp = () => end(true);
  const onLeave = () => end(false);

  el.classList.add("cursor-grab");
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onLeave);
  el.addEventListener("pointerleave", onLeave);

  return () => {
    el.classList.remove("cursor-grab", "cursor-grabbing");
    el.style.userSelect = "";
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onLeave);
    el.removeEventListener("pointerleave", onLeave);
  };
}
