import type { Translation } from "../i18n";
import type { PriceData } from "../types";
import { HEADING_IDS } from "../headings";
import { resolvePlan } from "../plans";
import { BUILD_TIME_ISO } from "../buildInfo";
import { fmtDate, fmtPricing } from "../util";

interface FooterProps {
  t: Translation;
  data: PriceData;
  lang: "de" | "en";
}

function scrollToSection(id: string, e: MouseEvent) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Footer(props: FooterProps) {
  const plan = () => resolvePlan(props.data);
  return (
    <footer class="mx-auto max-w-6xl px-4 pb-10">
      <div class="flex flex-col gap-2 border-t border-base-300 pt-4 text-xs text-base-content/70">
        <p class="max-w-3xl">
          {fmtPricing(props.t.metricNote, plan().creditsMonthly, plan().priceMonthly)}
        </p>
        <p class="max-w-3xl">{props.t.freeAvailableNote}</p>
        <span>
          {props.t.fetchedAt}: {fmtDate(props.data.fetchedAt, props.lang)}
        </span>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={props.data.sourceUrl} target="_blank" rel="noopener noreferrer" class="underline">
            {props.t.sourceLink}
          </a>
          <a href={props.data.freeModelsSourceUrl} target="_blank" rel="noopener noreferrer" class="underline">
            {props.t.sourceZen}
          </a>
          <a href={props.data.capabilitiesSourceUrl} target="_blank" rel="noopener noreferrer" class="underline">
            {props.t.sourceCaps}
          </a>
          <a
            href="https://ai-10-usd.all-the.rest"
            target="_blank"
            rel="noopener noreferrer"
            class="underline"
          >
            {props.t.sourceAi10}
          </a>
          <a
            href="https://github.com/all-the-rest/ocgo-price-tracker/releases.atom"
            target="_blank"
            rel="noopener noreferrer"
            class="underline"
          >
            {props.t.rssFeed}
          </a>
          <a href={`#${HEADING_IDS.imprint}`} class="underline" onClick={(e) => scrollToSection(HEADING_IDS.imprint, e)}>
            {props.t.impressum}
          </a>
          <a href={`#${HEADING_IDS.privacyPolicy}`} class="underline" onClick={(e) => scrollToSection(HEADING_IDS.privacyPolicy, e)}>
            {props.t.datenschutz}
          </a>
        </div>
        <span>{props.t.watchHint}</span>
        <span>{props.t.footer}</span>
      </div>
    </footer>
  );
}
