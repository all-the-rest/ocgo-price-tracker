import type { Translation } from "../i18n";
import type { Plan } from "../types";
import { fmtPricing } from "../util";

interface HeroProps {
  t: Translation;
  modelCount: number;
  plan: Plan;
}

export default function Hero(props: HeroProps) {
  const hasCreditPool = () => props.plan.creditsMonthly !== null;
  const pricing = (tpl: string) => fmtPricing(tpl, props.plan.creditsMonthly, props.plan.priceMonthly);
  return (
    <section>
      <h1 class="text-2xl font-bold tracking-tight">{props.t.title}</h1>
      <p class="text-base-content/70">{hasCreditPool() ? pricing(props.t.subtitle) : pricing(props.t.subtitleNoCredit)}</p>
      <p class="mt-3 max-w-3xl text-sm leading-relaxed text-base-content/70">{hasCreditPool() ? pricing(props.t.intro) : pricing(props.t.introNoCredit)}</p>

      <div class="stats stats-vertical mt-6 w-full shadow sm:stats-horizontal sm:w-auto">
        <div class="stat">
          <div class="stat-title">{props.t.statsCreditTitle}</div>
          <div class="stat-value">{hasCreditPool() ? pricing(props.t.statsCreditValue) : props.t.statsCreditUnknown}</div>
          <div class="stat-desc">{hasCreditPool() ? props.t.statsCreditDesc : props.t.statsCreditUnknownDesc}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{props.t.statsSubTitle}</div>
          <div class="stat-value">{pricing(props.t.plan)}</div>
          <div class="stat-desc">{props.t.statsSubDesc}</div>
        </div>
        <div class="stat">
          <div class="stat-title">{props.t.statsModelsTitle}</div>
          <div class="stat-value">{props.modelCount}</div>
          <div class="stat-desc">{props.t.statsModelsDesc}</div>
        </div>
      </div>
    </section>
  );
}
