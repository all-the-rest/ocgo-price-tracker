import { For } from "solid-js";
import type { Lang, Translation } from "../i18n";
import type { Model, Plan } from "../types";
import { formatReqPerMonth, requestsPerMonth, usageOf, usageBadgeClass, usageBarClass } from "../weighted";
import PlanTabs from "./PlanTabs";

export default function AllowancePage(props: { models: Model[]; plans: Plan[]; lang: Lang; t: Translation; selectedPlan: string; onSelectPlan: (id: string) => void }) {
  const rows = () => props.models.map((model) => ({
    model,
    values: props.plans.map((plan) => ({
      plan,
      usage: usageOf(model, plan),
      requests: requestsPerMonth(model, plan),
    })),
  }));
  const selected = () => props.plans.find((p) => p.id === props.selectedPlan) ?? props.plans[0];
  // Die 100 %-Erklärung nennt die SOLL-Guthaben aus den Daten (kein festes
  // $60/$65 im Text → kein Drift, wenn die Quelle die Guthaben ändert).
  const intro = () => {
    const planById = (id: string) => props.plans.find((plan) => plan.id === id);
    const money = (value: number | null | undefined) => (value == null ? props.t.noValue : `$${value}`);
    return props.t.allowanceIntro
      .replaceAll("{goCredit}", money(planById("go")?.creditsMonthly))
      .replaceAll("{goPlusCredit}", money(planById("go-plus")?.creditsMonthly))
      .replaceAll("{goTeamsCredit}", money(planById("go-teams")?.creditsMonthly))
      .replaceAll("{teamsPrice}", money(planById("go-teams")?.priceMonthly));
  };
  const orderedRows = () => [...rows()].sort((a, b) => {
    const sortPlan = selected();
    if (!sortPlan) return 0;
    const av = requestsPerMonth(a.model, sortPlan);
    const bv = requestsPerMonth(b.model, sortPlan);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
  return (
    <section aria-labelledby="allowances-title" class="space-y-6">
      <div>
        <h1 id="allowances-title" class="text-3xl font-bold">{props.t.allowanceTitle}</h1>
        <p class="mt-3 max-w-3xl text-base-content/70">{intro()}</p>
      </div>
      <div>
        <p class="font-medium">{props.t.allowanceSortPlan}</p>
        <PlanTabs plans={props.plans} active={selected()?.id} onSelect={props.onSelectPlan} t={props.t} ariaLabel={props.t.allowanceSortPlan} className="mt-2" />
        <span class="text-sm text-base-content/70">{props.t.allowanceSortNote}</span>
      </div>
      <div class="space-y-5">
        <For each={orderedRows()}>{({ model, values }) => {
          const max = Math.max(1, ...values.map(({ requests }) => requests != null && Number.isFinite(requests) ? requests : 0));
          return <article class="rounded-box border border-base-300 bg-base-200/40 p-4 sm:p-5">
            <h2 class="text-lg font-semibold">{model.name}{model.tier ? ` (${model.tier})` : ""}</h2>
            <div class="mt-3 space-y-4">
              <For each={values}>{({ plan, usage, requests }) => {
                const width = requests === Infinity ? 100 : requests === null ? 0 : Math.max(0, requests / max * 100);
                return <div class="grid gap-1 sm:grid-cols-[8rem_1fr_auto] sm:items-center sm:gap-4">
                  <span class="text-sm font-medium">{plan.name}</span>
                  <div class={`h-3 overflow-hidden rounded-full bg-base-300 ${usage === null ? "ring-1 ring-success" : ""}`} role="img" aria-label={`${plan.name}: ${requests === Infinity ? props.t.allowanceUnlimited : requests === null ? props.t.noValue : formatReqPerMonth(requests, props.lang)} ${props.t.colRequests.toLowerCase()}`}>
                    <div class={`h-full rounded-full ${usage === null ? "bg-success" : usageBarClass(usage, plan)}`} style={{ width: `${width}%` }} />
                  </div>
                  <p class={`text-sm tabular-nums sm:text-right ${usage === null ? "font-bold text-base-content" : ""}`}>
                    <strong>{requests === Infinity ? "∞" : requests === null ? props.t.noValue : formatReqPerMonth(requests, props.lang)}</strong> {props.t.colRequests.toLowerCase()}
                    <span class="text-base-content/70"> · </span>
                    {usage === null
                      ? <span class="badge badge-xs badge-success font-bold text-base-content">∞ {props.t.allowanceUnlimited}</span>
                      : <span class={`badge badge-xs ${usageBadgeClass(usage, plan)}`}>${usage} {props.t.allowanceUsage}</span>}
                  </p>
                </div>;
              }}</For>
            </div>
          </article>;
        }}</For>
      </div>
    </section>
  );
}
