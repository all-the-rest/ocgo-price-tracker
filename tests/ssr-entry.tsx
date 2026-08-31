import { renderToString } from "solid-js/web";
import PriceTable from "../src/components/PriceTable";
import Changelog from "../src/components/Changelog";
import type { Basis, Model, ChangelogEntry } from "../src/types";
import type { SortField } from "../src/sort";
import { i18n, type Lang } from "../src/i18n";

export { fieldPrice, requestCost, requestsPerMonth } from "../src/weighted";

export interface RenderOptions {
  basis: Basis;
  sortField: SortField;
  sortDir: 1 | -1;
  monthlyCredit: number;
  monthlyCost: number;
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
      monthlyCredit={opts.monthlyCredit}
      monthlyCost={opts.monthlyCost}
    />
  ));
}

/** Rendert die echte Changelog-Komponente serverseitig (für Zeit/Anker-Tests). */
export function renderChangelog(entries: ChangelogEntry[], monthlyCredit: number, lang: Lang = "en"): string {
  return renderToString(() => (
    <Changelog entries={entries} t={i18n[lang]} lang={lang} monthlyCredit={monthlyCredit} />
  ));
}
