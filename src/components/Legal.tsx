import type { Translation } from "../i18n";

interface LegalProps {
  t: Translation;
}

export default function Legal(props: LegalProps) {
  return (
    <>
      <section id="impressum" class="mt-10">
        <h2 class="text-lg font-bold tracking-tight">{props.t.impressum}</h2>
        <div class="mt-2 text-sm leading-relaxed text-base-content/80">
          <p class="font-medium">Florian Reisinger</p>
          <p>Robert-Stolz-Straße 8</p>
          <p>4020 Linz, Österreich</p>
          <p>
            E-Mail:
            <a href="mailto:hello@all-the.rest" class="link link-primary">
              hello@all-the.rest
            </a>
          </p>
          <p class="mt-3 text-base-content/50">Angaben gemäß § 5 ECG. Privates, nicht-kommerzielles Projekt.</p>
        </div>
      </section>

      <section id="datenschutz" class="mt-10">
        <h2 class="text-lg font-bold tracking-tight">{props.t.datenschutz}</h2>
        <div class="mt-2 max-w-3xl space-y-3 text-sm leading-relaxed text-base-content/80">
          <p>
            Ihre Rechte: Auskunft, Berichtigung, Löschung, Einschränkung und Widerspruch — Kontakt
            über hello@all-the.rest. Weiters Beschwerderecht bei der österreichischen
            Datenschutzbehörde (Barichgasse 40–42, 1030 Wien).
          </p>
        </div>
      </section>
    </>
  );
}
