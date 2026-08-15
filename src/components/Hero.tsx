import type { Translation } from "../i18n";
import { fmtPricing } from "../util";

interface HeroProps {
  t: Translation;
  modelCount: number;
  monthlyCredit: number;
  monthlyCost: number;
}

export default function Hero(props: HeroProps) {
  const pricing = (tpl: string) => fmtPricing(tpl, props.monthlyCredit, props.monthlyCost);
  return (
    <section>
      <h1 class="text-2xl font-bold tracking-tight">{props.t.title}</h1>
      <p class="text-base-content/60">{pricing(props.t.subtitle)}</p>
      <p class="mt-3 max-w-3xl text-sm leading-relaxed text-base-content/70">{pricing(props.t.intro)}</p>

      <div class="stats stats-vertical mt-6 w-full shadow sm:stats-horizontal sm:w-auto">
        <div class="stat">
          <div class="stat-title">{props.t.statsCreditTitle}</div>
          <div class="stat-value">{pricing(props.t.statsCreditValue)}</div>
          <div class="stat-desc">{props.t.statsCreditDesc}</div>
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
