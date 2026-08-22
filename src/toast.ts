/**
 * Minimaler Toast (daisyUI `alert` in einem `toast`-Container), der nach ein
 * paar Sekunden automatisch ausgeblendet wird. Wird am <body> angehängt, damit
 * er unabhängig vom SolidJS-Root überall erscheint.
 */
let container: HTMLDivElement | null = null;

export function showToast(message: string): void {
  if (typeof document === "undefined") return;
  if (!container) {
    container = document.createElement("div");
    container.className = "toast toast-end toast-top z-[100]";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = "alert alert-success text-sm shadow-lg";
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("opacity-0", "transition-opacity", "duration-300");
    setTimeout(() => el.remove(), 300);
  }, 2500);
}
