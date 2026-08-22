import type { Translation } from "../i18n";
import { showToast } from "../toast";
import Tooltip from "./Tooltip";

/**
 * Klickbares Kopier-Icon (kein eigener Text/Zeile) für die OpenCode-Modell-ID
 * (`provider/id`, z. B. `opencode-go/grok-4.5`). Tooltip rechts zeigt die ID,
 * Klick kopiert sie und blendet einen Erfolgs-Toast ein.
 */
export default function CopyId(props: { id: string; t: Translation }) {
  const label = () => props.t.modelIdCopy.replace("{id}", props.id);
  const copied = () => props.t.modelIdCopied.replace("{id}", props.id);
  return (
    <Tooltip tip={props.id} side="right" class="ml-1 inline-flex translate-y-px items-center text-base-content/50 hover:text-primary focus:outline-none">
      <button
        type="button"
        class="inline-flex items-center"
        title={label()}
        aria-label={label()}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(props.id);
          showToast(copied());
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </Tooltip>
  );
}
