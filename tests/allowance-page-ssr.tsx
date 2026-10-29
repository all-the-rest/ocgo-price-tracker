import { renderToString } from "solid-js/web";
import AllowancePage from "../src/components/AllowancePage";
import { i18n } from "../src/i18n";
import type { Lang } from "../src/i18n";
import type { Model, Plan } from "../src/types";
import { fieldPrice, usageBadgeClass, usageBarClass } from "../src/weighted";
import Header from "../src/components/Header";
import Hero from "../src/components/Hero";

export function render(models: Model[], plans: Plan[], lang: Lang = "en", selectedPlan = plans[0]?.id ?? "") {
  return renderToString(() => <AllowancePage models={models} plans={plans} lang={lang} t={i18n[lang]} selectedPlan={selectedPlan} onSelectPlan={() => {}} />);
}

export { fieldPrice, usageBadgeClass, usageBarClass };

export function renderHeader(lang: Lang) {
  return renderToString(() => <Header lang={lang} setLang={() => {}} dark={false} setDark={() => {}} t={i18n[lang]} />);
}

export function renderHero(plan: Plan, lang: Lang = "en") {
  return renderToString(() => <Hero plan={plan} modelCount={1} t={i18n[lang]} />);
}
