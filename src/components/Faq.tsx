import { For } from "solid-js";
import type { Lang, Translation } from "../i18n";
import Heading from "./Heading";
import { fmtPricing } from "../util";
import faqJson from "../data/faq.json";

interface FaqItem {
  q: string;
  a: string;
}

const FAQ = faqJson as Record<Lang, FaqItem[]>;

interface FaqProps {
  t: Translation;
  lang: Lang;
  credit: number;
  cost: number;
}

/**
 * FAQ als native `<details>`-Elemente — funktioniert ohne JS und wird im
 * Prerender als echter Text ausgeliefert (Grundlage für das FAQPage-JSON-LD).
 * Die Antworten ersetzen `{credit}`/`{cost}` mit den dynamischen Werten.
 */
export default function Faq(props: FaqProps) {
  const items = () => FAQ[props.lang] ?? [];
  return (
    <section id="faq" class="mt-10">
      <Heading anchor="faq">{props.t.headingFaq}</Heading>
      <div class="mt-3 flex max-w-3xl flex-col gap-2">
        <For each={items()}>
          {(item) => (
            <details class="collapse collapse-arrow border border-base-300 bg-base-100">
              <summary class="collapse-title font-semibold">{item.q}</summary>
              <div class="collapse-content text-sm leading-relaxed text-base-content/75">
                <p>{fmtPricing(item.a, props.credit, props.cost)}</p>
              </div>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}
