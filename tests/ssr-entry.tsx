import { renderToString } from "solid-js/web";
import PriceTable from "../src/components/PriceTable";
import PrivacyTable from "../src/components/PrivacyTable";
import Changelog from "../src/components/Changelog";
import type { Basis, Model, FreeModel, ChangelogEntry, Plan, PlanId } from "../src/types";
import type { SortField, PrivacySortState } from "../src/sort";
import { i18n, type Lang } from "../src/i18n";

export { fieldPrice, formatReqPerMonth, formatTokens, requestCost, requestsPerMonth } from "../src/weighted";
export { shareRequests, topModels } from "../src/share";

export interface RenderOptions {
  basis: Basis;
  sortField: SortField;
  sortDir: 1 | -1;
  plan: Plan;
  lang: Lang;
  showTraining?: boolean;
}

/**
 * E2E-Test-Helfer: rendert die echte PriceTable-Komponente serverseitig (SolidJS
 * renderToString) mit einer festen Sortierung. Die Testlogik prüft die
 * gerenderte Tabellen-Reihenfolge gegen die angezeigten Werte — keine Logik wird
 * aus der Komponente extrahiert.
 */
export function renderPriceTable(models: Model[], opts: RenderOptions): string {
  return renderToString(() => (
    <PriceTable
      models={models}
      t={i18n[opts.lang]}
      lang={opts.lang}
      basis={opts.basis}
      setBasis={() => {}}
      sort={{ field: opts.sortField, dir: opts.sortDir }}
      setSort={() => {}}
      caps={[]}
      setCaps={() => {}}
      showTraining={opts.showTraining ?? true}
      setShowTraining={() => {}}
      plan={opts.plan}
    />
  ));
}

/** Rendert die echte Changelog-Komponente serverseitig (für Zeit/Anker-Tests). */
export function renderChangelog(
  entries: ChangelogEntry[],
  plans: Plan[],
  lang: Lang = "en",
  planId: PlanId = "go"
): string {
  return renderToString(() => (
    <Changelog entries={entries} t={i18n[lang]} lang={lang} plans={plans} planId={planId} />
  ));
}

/**
 * Rendert die echte PrivacyTable-Komponente serverseitig (für Dedupe-Tests:
 * Free-Modelle, die auch in der Go-Preistabelle stehen, dürfen nur einmal
 * erscheinen).
 */
export function renderPrivacyTable(
  models: Model[],
  freeModels: FreeModel[],
  lang: Lang = "de",
  sort: PrivacySortState = { field: "tier", dir: 1 }
): string {
  return renderToString(() => (
    <PrivacyTable
      models={models}
      freeModels={freeModels}
      t={i18n[lang]}
      lang={lang}
      sort={sort}
      setSort={() => {}}
    />
  ));
}
