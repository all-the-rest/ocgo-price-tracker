import { For } from "solid-js";
import type { Translation } from "../i18n";
import type { Plan, PlanId } from "../types";
import { planLabel } from "../plans";

interface PlanTabsProps {
  plans: Plan[];
  active: PlanId;
  onSelect: (p: PlanId) => void;
  t: Translation;
  ariaLabel?: string;
  className?: string;
}

/** Plan-Tabs (analog cc-price-tracker). Wird nur bei > 1 Tab-Plan gerendert. */
export default function PlanTabs(props: PlanTabsProps) {
  return (
    <div role="tablist" aria-label={props.ariaLabel} class={`tabs tabs-box max-w-full overflow-x-auto ${props.className ?? "mt-6"}`}>
      <For each={props.plans}>
        {(plan) => (
          <button
            role="tab"
            class="tab text-base-content"
            classList={{ "tab-active": plan.id === props.active }}
            aria-selected={plan.id === props.active}
            onClick={() => props.onSelect(plan.id)}
          >
            {planLabel(plan.id, props.t, plan.name)}
          </button>
        )}
      </For>
    </div>
  );
}
