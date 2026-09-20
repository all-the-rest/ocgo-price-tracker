import { For } from "solid-js";
import type { Lang, Translation } from "../i18n";
import type { Model, Plan } from "../types";
import Heading from "./Heading";
import { fmt, fmtContextWindow, fmtPricing } from "../util";
import { formatReqPerMonth, requestCost, requestsPerMonth } from "../weighted";

interface RankingRow {
  model: Model;
  requests: number | null;
  cost: number | null;
}

interface ModelRankingProps {
  models: Model[];
  t: Translation;
  lang: Lang;
  plan: Plan;
}

/**
 * SEO-relevanter Abschnitt: die Modelle mit den meisten Anfragen pro Monat
 * beim vollen Monatsguthaben. Verwendet exakt dieselbe Berechnung wie die
 * Preistabelle (`requestsPerMonth`/`requestCost`) — keine eigene Mathematik.
 * Server- und clientseitig identisch (reine Daten, kein `Date`/`window`).
 */
export default function ModelRanking(props: ModelRankingProps) {
  const rows = (): RankingRow[] =>
    props.models
      .map((model) => ({
        model,
        requests: requestsPerMonth(model),
        cost: requestCost(model, "list", props.plan),
      }))
      .sort((a, b) => {
        if (a.requests === null && b.requests === null) return 0;
        if (a.requests === null) return 1;
        if (b.requests === null) return -1;
        return (b.requests as number) - (a.requests as number);
      })
      .slice(0, 10);

  const requestCell = (value: number | null): string =>
    value === null ? props.t.noValue : !Number.isFinite(value) ? "∞" : formatReqPerMonth(value, props.lang);

  return (
    <section id="ranking" class="mt-10">
      <Heading anchor="ranking">{props.t.headingRanking}</Heading>
      <p class="mt-2 max-w-3xl text-sm leading-relaxed text-base-content/70">
        {fmtPricing(props.t.rankingIntro, props.plan.creditsMonthly, props.plan.priceMonthly)}
      </p>
      <div class="mt-4 overflow-x-auto">
        <table class="table table-zebra table-sm">
          <caption class="sr-only">{props.t.headingRanking}</caption>
          <thead>
            <tr>
              <th scope="col">{props.t.rankingColRank}</th>
              <th scope="col">{props.t.rankingColModel}</th>
              <th scope="col">{props.t.rankingColProvider}</th>
              <th scope="col">{props.t.rankingColContext}</th>
              <th scope="col" class="text-right">{props.t.rankingColRequests}</th>
              <th scope="col" class="text-right">{props.t.rankingColCost}</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(row, i) => (
                <tr>
                  <td class="tabular-nums">{i() + 1}</td>
                  <th scope="row" class="font-semibold">
                    {row.model.name}
                    {row.model.tier ? ` (${row.model.tier})` : ""}
                  </th>
                  <td>{row.model.provider ?? props.t.noValue}</td>
                  <td class="tabular-nums">{fmtContextWindow(row.model.contextWindow)}</td>
                  <td class="text-right tabular-nums">{requestCell(row.requests)}</td>
                  <td class="text-right tabular-nums">{fmt(row.cost)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <p class="mt-2 max-w-3xl text-xs text-base-content/60">{props.t.rankingNote}</p>
    </section>
  );
}
