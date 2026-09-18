import { For } from "solid-js";
import type { Translation } from "../i18n";
import type { Plan, PlanId } from "../types";
import { planLabel } from "../plans";

interface PlanTabsProps {
  plans: Plan[];
  active: PlanId;
  onSelect: (p: PlanId) => void;
  t: Translation;
}

/** Plan-Tabs (analog cc-price-tracker). Wird nur bei > 1 Tab-Plan gerendert. */
export default function PlanTabs(props: PlanTabsProps) {
  return (
    <div role="tablist" class="tabs tabs-box mt-6 max-w-full overflow-x-auto">
      <For each={props.plans}>
        {(plan) => (
          <button
            role="tab"
            class="tab"
            classList={{ "tab-active": plan.id === props.active }}
            aria-selected={plan.id === props.active}
            onClick={() => props.onSelect(plan.id)}
          >
            {planLabel(plan.id, props.t)}
          </button>
        )}
      </For>
    </div>
  );
}
