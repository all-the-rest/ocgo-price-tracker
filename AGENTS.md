# AGENTS.md

**Nur Regeln, keine Entscheidungen:** Diese Datei enthält ausschließlich Regeln — Anweisungen, die für jede Arbeit in diesem Repo gelten. Dauerhafte Entscheidungen, Begründungen, Messwerte und Historie gehören nicht hierher, sondern in `docs/`/`features/` bzw. die Projekt-Doku; offene Punkte nach `AGENTS.todo.md`; Erledigtes in die Git-Historie.

## Projektüberblick

Preis-Tracking für OpenCode Go. Ein täglicher GitHub-Actions-Lauf scrapet
`https://opencode.ai/v2/docs/console/go/`, berechnet die Preise auf Basis des vollen
Monatsguthabens (Effektivpreis = Listpreis × Guthaben/Nutzung) und stellt eine
statische SolidJS-Seite unter `https://ocgo-pricing.all-the.rest` bereit.
OpenCode Go hat **zwei Abonnemente**: **Go** ($10/Monat) und **Go Plus** ($40/Monat).
Die Tokenpreise sind in beiden identisch, die **Nutzung pro Modell ist pro Plan
verschieden** — die Doku liefert dafür je eine Preistabelle in einem
`div.docs-plan-tabs`-Baustein. Die Seite hat entsprechend Plan-Tabs, und
`models[].usage` ist eine **Plan-Map**.

Datenquelle sind die Console-Docs: die Go-Seite für Pläne/Preise/Privacy/Patterns/Peak,
die Models-Seite für die Free-Modelle.

- Repo (remote): `all-the-rest/ocgo-price-tracker`
- GitHub Pages Custom Domain: `ocgo-pricing.all-the.rest` (CNAME)

## Stack

- SolidJS 1.9 + Vite 8 (`vite-plugin-solid`), TypeScript 7 (`tsc --noEmit`)
- Tailwind CSS 4 + daisyUI 5 — lokal gebündelt, **keine externen Fonts/Libs via URL**
- Scraper: Node ≥22, `scripts/scrape.mjs` mit cheerio + `@opencode-ai/models` (nur devDependencies)
- Paketmanager: pnpm — die `packageManager`-Version in `package.json` ist maßgeblich (CI liest sie)
- Deployment: GitHub Pages (`upload-pages-artifact` + `deploy-pages`), CNAME im `public/`

## Befehle

```bash
pnpm install          # Lockfile ist versioniert (lockfileVersion 9)
pnpm scrape           # holt Daten → aktualisiert data/latest.json, data/history.json, CHANGELOG.json, src/data/changelog.json
pnpm test             # Scraper-Unit-Tests (node --test, Fixtures tests/fixtures/go-en.html + models-en.html)
pnpm dev              # Dev-Server
pnpm build            # Typecheck + Vite-Build → dist/ (inkl. dist/data/latest.json als statisches Artefakt)
pnpm smoke            # Smoke-Test auf dist/: Artefakte + Assets + Preview-HTTP (/ und /data/latest.json) — ohne Browser
pnpm preview          # dist/ lokal serven
pnpm typecheck        # nur tsc --noEmit
```

## CodeGraph (Code-Intelligenz)

CodeGraph ist ein lokaler Code-Index (Wissensgraph) mit SQLite-Backend. Der Index
liegt im Repo unter `.codegraph/` (via File-Watcher auto-sync ~1 s nach Schreiben).
Bei Code-Fragen/Edits **vor** grep/Read nutzen — eine `explore`-Abfrage liefert die
Verbatim-Sources inkl. Call-Paths (auch dynamische Dispatch-Hops).

- **Binary:** `~/.local/bin/codegraph` (auf dem PATH).
- **Shell (immer verfügbar):**
  ```bash
  codegraph explore "<symbolnamen oder Frage>"   # gleiche Ausgabe wie das MCP-Tool
  codegraph status                                # Index-Statistik
  codegraph init          # Index (neu) bauen, falls .codegraph/ fehlt
  codegraph index         # kompletten Index neu bauen
  codegraph sync          # nur Änderungen seit letztem Index
  codegraph query "<term>" # reine Symbolsuche
  ```
- **MCP-Server (für den Agenten):** als lokaler stdio-Server eingebunden.
  Wiring (idempotent, schreibt nach `opencode.json` im Projekt-Root):
  ```bash
  opencode2 mcp add codegraph -- codegraph serve --mcp
  ```
  Das erzeugt:
  ```json
  { "mcp": { "servers": { "codegraph": { "type": "local", "command": ["codegraph", "serve", "--mcp"] } } } }
  ```
  Das MCP-Tool heißt `codegraph_explore` (eine Abfrage = Verbatim-Source + Call-Paths).
  Nach dem (Neu-)Hinzufügen/Ändern eines MCP-Servers **Session neu starten**, damit
  der Server aktiv wird (`opencode.json` wird beim Start gelesen; `touch` reicht nicht).
- **Wenn kein `.codegraph/`:** CodeGraph komplett überspringen (kein grep/Read-Ersatz
  nötig) — das Indexieren ist alleinige Entscheidung des Users (ggf. `codegraph init`).

> **Changelog-Git-History:** `CHANGELOG.json` (strukturierte Änderungs-Events) wird bei Änderungen vom CI committet und gepusht
> (`git add CHANGELOG.json data src/data`) → vollständige Git-History der Preisänderungen. Ein Lauf **ohne** Änderungen erzeugt
> **keinen Commit** (keine Daten-Diffs, `data/latest.json`/`data/history.json` bleiben unangetastet); die Website wird trotzdem täglich deployed.

## Datenmodell (`data/latest.json`)

```json
{
  "fetchedAt": "2026-08-05T22:00:00.000Z",
  "sourceUrl": "https://opencode.ai/v2/docs/console/go/",
  "capabilitiesSourceUrl": "https://models.dev",
  "sourceLang": "en",
  "plans": [
    { "id": "go", "name": "Go", "priceMonthly": 10, "creditsMonthly": 60, "sourceUrl": "https://opencode.ai/v2/docs/console/go/" },
    { "id": "go-plus", "name": "Go Plus", "priceMonthly": 40, "creditsMonthly": 240, "sourceUrl": "https://opencode.ai/v2/docs/console/go/" }
  ],
  "peakRules": {
    "deepseekv4.1flash": {
      "timezone": "Asia/Shanghai",
      "peak": { "days": [1, 2, 3, 4, 5], "windowsUtc": [[1, 4], [6, 10]] },
      "offPeak": { "days": [6, 7], "allDay": true }
    }
  },
  "freeModels": [{ "id": "big-pickle", "fullId": "opencode/big-pickle", "availableFrom": "2026-08-05", "privacy": { "training": true, "retentionDays": null, "validUntil": null } }],
  "models": [
    {
      "name": "Grok 4.7",
      "tier": null,
      "input": 2.0,
      "output": 6.0,
      "cachedRead": 0.3,
      "cachedWrite": null,
      "usage": { "go": 15, "go-plus": 120 },
      "pattern": { "input": 390, "cachedRead": 32500, "output": 120 },
      "capabilities": { "input": ["text", "image"], "output": ["text"], "reasoning": true, "toolCall": true },
      "privacy": { "training": false, "retentionDays": 30, "validUntil": null }
    }
  ]
}
```

- `usage` = **Plan-Map** `PlanId → Nutzung in $` (aktueller Wert aus der Preistabelle des Plans, inkl. inline eingepreister Boni, z. B. `<del>$15</del> <strong>$60</strong>` → `60`); `null` = unbegrenzt (kostenlose Zeilen). Die Schlüssel sind **exakt** die `plans[].id`.
- `plans[]` = die Abonnemente aus der Plan-Tabelle; `id` = Tab-Label normalisiert (lowercase, Whitespace → `-`: „Go Plus“ → `go-plus`). `priceMonthly` = Abo-Preis. `creditsMonthly` = **monatliches SOLL-Guthaben des Plans und damit der 100 %-Bezugspunkt der Nutzungsfarben**: Go/Go Plus = 6 × Monatspreis (60/240, Go Plus also 4× Go), Go Teams ($20/Mitglied/Monat) = Go-Guthaben + einmalig $5 = 65. Die Quelle nennt für Go Teams nur Go-Limits + $5 je Modell; das SOLL-Guthaben ist die **Vergleichsbasis der Anzeige**, keine Quellenbehauptung und der einmalige $5-Wert wird nicht mit der Modellanzahl multipliziert. Unbekannte Pläne bleiben `null` (dann `unknown` statt Farbe). Es gibt **kein** separates Referenzfeld (`usageColorReferenceMonthly` wurde entfernt) — `creditsMonthly` ist die einzige Wahrheit für Farbe, „volles Guthaben“ und Tooltip.
- `peakRules`: Modell-Normalform (`normalizeName`) → `{ timezone, effectiveFrom?, peak: { days, windowsUtc }, offPeak: { days, allDay: true }, holidays? }`. `days` = ISO-Wochentage (**1 = Montag … 7 = Sonntag**); `windowsUtc` = UTC-Stundenfenster `[start,end]` (0 ≤ start < end ≤ 24, aufsteigend, nicht überlappend, ≥ 1) — gelten an `peak.days`. `offPeak.days` = Komplement von `peak.days` (dort ganztägig Off-Peak). `timezone` = IANA-Zone, **in der der Wochentag bewertet wird** (DeepSeek: `Asia/Shanghai`). `effectiveFrom` (ISO mit Offset, optional) nur, wenn die Quelle ein effektives Datum nennt. `holidays` (`{ policy: "off-peak", calendar }`, optional) nur, wenn die Quelle Feiertage nennt — **strikt quellenbindend, keine Overrides**.
- `holidayCalendars` (Top-Level, **optional**): Kalender-Schlüssel (z. B. `china`) → `{ dates: ["YYYY-MM-DD", …] (aufsteigend, lokale Kalendertage der Regel-Zone), coveredThrough: "YYYY-MM-DD" }`. Bleibt optional im Typ/zod-Schema; `src/config/peakPricing.ts` liest es optional. **Nicht befüllt**, solange die Quelle keine Feiertage nennt.
- **zod-Invarianten der Peak-Regeln:** `peak.days`/`offPeak.days` nicht leer, keine Duplikate, disjunkt, zusammen {1..7}; `timezone` gültiger IANA-Name; `holidays.calendar` **muss** in `holidayCalendars` stehen; `dates` streng aufsteigend und ≤ `coveredThrough`. Verstoß → CI rot.
- **Auswertung** liegt **einmal** in `src/config/peakPricing.ts` (`isPeakAt`/`nextTransition`), nicht in den Komponenten: Feiertag (in `rule.timezone`) → Off-Peak; sonst Peak, wenn Wochentag ∈ `peak.days` UND UTC-Stunde ∈ Fenster; sonst Off-Peak. Vor `effectiveFrom` kein Peak. Kein 调休/`isWorkday` (ein 调休-Samstag bleibt Off-Peak).
- **Keine vorberechneten Effektivpreise:** plan-abhängige Werte werden **nicht** im Datensatz geführt (kein `models[].multiplier`/`effective*`, kein Top-Level `monthlyCredit`/`monthlyCost`). Die Rechnung liegt **einmal** in der UI (`src/weighted.ts`: `usageOf`/`multiplierOf`/`fieldPrice`).
- **Kostenlose Preistabellen-Zeilen** (`Monthly limit` = `-`/`Unlimited`, z. B. LongCat 2.5 Preview Free): Token-Preise (`input`/`output`/`cachedRead`/`cachedWrite`) werden als `0` erfasst, nicht als `null` — gratis ist ein bekannter Preis. `usage` ist in **allen** Plänen `null`. `pattern` bleibt `null` und ist **nicht** Pflicht (zod: nur von 0 verschiedene Preise erfordern ein Muster); `requestCost` = 0 → UI zeigt `$0.00` statt `-`.
- `pattern` = dokumentiertes Anfragemuster (Input/Cached/Output Tokens pro Anfrage) — **Pflicht** (zod). Kosten pro Anfrage = Muster × Modellpreis (Input: 5% Input-Preis + 95% Cached-Write-Preis, Cached: Cached Read, Output: Output). Reihenfolge im Scrape: dokumentiertes Muster > Familien-Fallback (`PATTERN_FALLBACKS`) > **Default-Muster** `DEFAULT_PATTERN = 800/50.000/162` (derselbe Messwert wie `AVERAGE_MESSAGE_PATTERN` in `ai-10-usd`) für Zeilen mit Preisen, für die die Doku gar kein Muster nennt. `parsePatterns`/Familien-Fallback haben immer Vorrang; das zod-Gate bleibt Backstop. Kostenlose Zeilen (Preise 0) bleiben ohne Muster.
- `capabilities` = Fähigkeiten aus models.dev (via `@opencode-ai/models`): `input`/`output`-Modalitäten (`text`, `audio`, `image`, `video`, `pdf`), `reasoning`, `toolCall`. `null` = kein models.dev-Eintrag. **Nur Fähigkeiten — die Preise bleiben aus dem Go-Scrape (models.dev-Preise werden ignoriert).**
- `privacy` = Datenschutz-Info aus der Doku-Tabelle (`Model training`/`Data retention`): `training` (bool, `true` = Daten fürs Modelltraining), `retentionDays` (**`true`** = ZDR/0 Tage, **`false`** = kein ZDR (Daten werden aufbewahrt, Dauer unbekannt), **`number`** = N Tage, **fehlend/`undefined`** = unbekannt/„–“), `validUntil` (ISO-Datum = Ablauf der ZDR-Vereinbarung), `fallback` (optional `true` = Angabe aus derselben Modellfamilie via `PRIVACY_FALLBACKS`). `null` = keine Angabe. **Kostenlose Console-Modelle** beziehen ihre Angabe aus der Fußnoten-Liste „Free models“ (`h3#free-models`) auf `/v2/docs/console/models/` (`parseZenFreeModelPrivacy` in `enrichFreeModels`): ZDR-Modelle („zero-retention policy“ + „does not use … for model training“) → `training: false, retentionDays: true`, Feedback-Modelle (`feedback`/`improve the model`) → `training: true`; die Go-Datenschutz-Tabelle ist für Free-Modelle **nicht** maßgeblich. `training: true` ist der Fallback für Modelle ganz ohne Datenschutz-Aussage; manuelle `FREE_MODEL_PRIVACY_OVERRIDES` haben Vorrang.
- `capabilitiesSourceUrl` = `https://models.dev` (Fähigkeiten-Quelle).
- `cachedWrite: null` (= `-` in der Doku) bedeutet: Cached-Write-Preis = **Input-Preis** (1:1, keine Schätzung). Er fließt als Cached-Write-Preis in die 5/95-Heuristik von `requestCost` ein; in der Tabelle steht weiterhin `-` (die Heuristik ist nur im Footer dokumentiert).
- `freeModels` = kostenlose Console-Modelle aus der Models-Doku (`https://opencode.ai/v2/docs/console/models/`; die „Endpoints“-Tabelle liefert die Model-IDs, die „Pricing“-Tabelle markiert die gratis Zeilen via `extractFreeModelsFromDocs`, `privacy` aus der Fußnoten-Liste „Free models“ via `parseZenFreeModelPrivacy`); `availableFrom` = erstes Beobachtungsdatum (bleibt über Läufe erhalten). `fullId` = volle Kopier-ID (`opencode/<id>` bzw. `opencode-go/…`, via `resolveOpencodeId`); `id` bleibt stabiler Schlüssel (Merge, Changelog, Zen-Endpunkte).
- **`freeModels` sind plan-unabhängig:** kein `usage`, kein `plan` (zod-Invariante: `FreeModelSchema` bekommt kein solches Feld). Die `usage`-Map gilt ausschließlich für die Go-Katalogzeilen in `models[]`. Die UI filtert Free- und Datenschutz-Tabelle **nie** nach Plan; `free_added`/`free_removed` sind ebenfalls plan-unabhängig. Nicht zu verwechseln mit den zwei **Gratis-Zeilen in der Go-Preistabelle** (`LongCat 2.5 Preview Free`, `Step 5 Preview Free`): die stehen in beiden Plan-Tabellen mit `usage: null`.
- `data/history.json` = `{ "snapshots": [ … ] }` (Chronologie, append, nur bei Änderungen)
- `CHANGELOG.json` = `{ "entries": [{ "date", "changes": [ … ] }] }`; wird **minified** (`JSON.stringify`, eine Zeile) geschrieben — nie hübsch formatiert, damit Git-Diffs minimal bleiben. Events (zod via `validateChangelog`):
  - `text` (mit `lang` = `{ de, en }`-Übersetzungen, z. B. `{ de: "Initialversion", en: "Initial version" }`; keine freien Texte)
  - `model_added` (mit `pricing` = `{ input, output, cachedRead, cachedWrite, usage }`, die Go-Tabellen-Zeile)
  - `model_removed` (mit `days` = verfügbare Tage, `firstSeen` aus `history.json`-Chronologie)
  - `price_changed` (mit `from`/`to` = komplette Pricing-Zeile und `fields` = geänderte Preisfelder `["input","output","cachedRead","cachedWrite"]`; die UI stellt die Felder in **beiden** Zeilen fett dar)
  - `usage_changed` (**plan-aware**): `{ model, plans: [{ plan, from, to }] }` — **ein Event pro Modell**, im `plans`-Array nur die Pläne mit tatsächlich geänderter Nutzung (leeres Array → kein Event). Nur diese Form ist gültig (kein Skalar-Legacy); `pricingOf` in `scripts/scrape.mjs` normalisiert einen skalaren `usage` aus einem alten Snapshot auf `{go: wert}` (reiner Lese-Schutz).
  - `plan_added` (mit `plan` = Plan-Id, `name`, `priceMonthly`, `creditsMonthly` nullable): **genau ein** Event, wenn ein Plan in `plans[]` neu auftaucht. Nutzungsänderungen für einen neu hinzugekommenen Plan werden im selben Lauf **unterdrückt**. Typisiert statt `text`, damit ein späteres `plan_removed` symmetrisch ergänzbar bliebe und der Plan maschinell filterbar ist.
  - `capabilities_changed` (mit `from`/`to` = capabilities-Objekt oder `null`)
  - `privacy_changed` (mit `from`/`to` = privacy-Objekt oder `null`; löst bei Änderung von `training`/`retentionDays`/`fallback` aus — **nicht** bei Erst-Befüllung `undefined`/`null` → Wert und **nicht** bei reiner `validUntil`-Änderung)
  - `free_added`/`free_removed` (mit `availableFrom`/`until`)
  - Preis- UND Nutzungsänderung → **zwei Events** (`price_changed` + `usage_changed`). **Keine** `baseline`/`pricing_changed`-Events. Einträge haben IMMER `changes.length > 0`; ohne Änderungen wird kein Eintrag angelegt, leere Einträge werden entfernt. **Jeder Run** schreibt bei Änderungen einen **eigenen** Eintrag (`id` = Run-Zeitstempel) — kein Day-Merge (`upsertChangelogJson` schreibt pro `id`, ersetzt idempotent).
- **Manuelle Korrekturen (Patches):** Von Hand ausgebesserte Zuordnungs-Fehler (z. B. `CAPABILITY_OVERRIDES`) erzeugen Scrape-Events; diese werden **manuell aus `CHANGELOG.json`/`src/data/changelog.json` entfernt** (der Patch ist eine Fehlerkorrektur, keine Quelländerung). Die Events-Mechanik bleibt generell aktiv, die Daten behalten die korrigierten Werte. Gleiches gilt für Schema-Migrationen. Faustregel: **es bleibt nur übrig, was sich an der Quelle geändert hat.**

## Scraper-Regeln (`scripts/scrape.mjs`)

- Preistabelle über die **Header-Zeile** identifizieren — NICHT über `nth-child`-Selektoren. **Englisch ist die Quellsprache**; deutsche Aliase bleiben als Kompatibilität: Eingabe `input`/`eingabe`, Ausgabe `output`/`ausgabe`, Cached Read `cached read`/`cache-lesevorgang`, Cached Write `cached write`/`cache-schreibvorgang`, Nutzung `monthly limit`/`usage`/`limit`/`nutzung`/`monatliches limit`, Modell `model`/`modell`. Es gibt **mehrere** Preistabellen (eine pro Plan) — jede wird gefunden, nicht nur die erste.
- **Plan-Zuordnung der Preistabellen:** die Preistabellen liegen in `div.docs-plan-tabs`-Panels. Zuordnung über **`data-plan-tab`/`data-plan-panel`** (Fallback ARIA `aria-labelledby` → Tab-`id`), nicht über Position: Panel `div[role=tabpanel][data-plan-panel=go]` → Tab `button[role=tab][data-plan-tab=go]` (im selben `[data-plan-tabs]`) → dessen Label ist der Plan-Name → normalisiert = `plans[].id`. Panel ohne Key, Tab ohne Panel, zwei Preistabellen in einem Panel, Panel-Label ohne passenden Plan aus der Plan-Tabelle oder Anzahl Preistabellen ≠ Anzahl Pläne → `ScrapeError`. Die **Rate-Limit-Tabellen** werden nicht geparst und dürfen nicht als Preistabelle matchen.
- **Preis-Kreuzprüfung über die Pläne:** die Tokenpreise sind in allen Plänen identisch. Datenquelle ist die erste Preis-Tabelle; alle weiteren werden dagegen geprüft. Abweichende Tokenpreise **oder** abweichende Modellnamen-Mengen → `ScrapeError` (lieber rot als eine falsche Anzeige).
- Preise: `$1.40` → `1.4`; `Free`/`Kostenlos` (case-insensitive) → `0`; `-` → `null`. Nutzung `Unlimited`/`Unbegrenzt` → `null`; `<small>`-Hinweise („limited time“) werden von `parseUsageCell` ignoriert.
- `Monthly limit` ist `$15`–`$80` und **pro Plan verschieden** (Go: $15/$30/$60/$80, Go Plus: $60/$90/$120/$160/$180/$240); Modellname mit `(… tokens)`-Suffix → `tier`-Feld.
- **Nutzungs-Boni** stehen inline in der Doku-Preistabelle (`<del>$15</del> <strong>$60</strong>` + `<small>4x · Endet …</small>` in der Nutzungs-Zelle; `parseUsageCell` liest den aktuellen Wert, `parseDocsUsageBonuses` liefert nur Reporting-Labels). Keine zweite Quelle — die Landingpage wird nicht gefetcht.
- **Pläne und Monatspreis kommen aus der Plan-Tabelle** (`Plan | Price | Included usage`, deutsche Aliase `abonnement`/`preis` bleiben): je Zeile ein Plan (Name → `id`, `$10/month` → `priceMonthly: 10`). `creditsMonthly` = **SOLL-Guthaben**: Go/Go Plus = 6 × Monatspreis (Go $10 → $60, Go Plus $40 → $240); Go Teams = Go-Guthaben + einmalig $5 (65, Herleitung in `creditsMonthlyForPlan`, ausdrücklich nicht $5 × Modellanzahl), alle anderen Pläne ohne belegte Regel `null`. Fehlende Plan-Tabelle oder unparsebarer Planpreis → `ScrapeError`.
- **Schreibweisen normalisieren (nie add/remove bei Umbenennung):** `canonicalModelName` (via `MODEL_NAME_ALIASES`, neue Varianten dort ergänzen; `canonicalFreeName` für Free-Anzeigenamen) mappt beim Parsen auf die kanonische Form; `computeDiff`/`computeCapabilityDiff`/`computePrivacyDiff` matchen zusätzlich auf normalisiertem Key (`normalizeName`: Kleinbuchstaben ohne Leerzeichen/Bindestrich), Events tragen die bisherige Schreibweise (stabil). `firstSeen` toleriert Legacy-Snapshot-Einträge (freie IDs als reine Strings).
- **Anfragemuster** pro Modell extrahieren; Kurzschreibweisen (`GLM-5.3/5.2`, `Kimi K2.7/K2.6`) gegen die Modellnamen auflösen. Fehlende Muster über `PATTERN_FALLBACKS` (z. B. MiniMax M2.5 → M2.7) auffüllen; sonst greift für Zeilen mit Preisen das **Default-Muster** `DEFAULT_PATTERN = 800/50.000/162` (§Datenmodell). Die Notizen sind **englisch** (`Grok 4.7/4.6 — 390 input, 32,500 cached, 120 output tokens per request`; deutsche Form „Tokens pro Anfrage“ als Alias): Labels `Input|Eingabe`, `Cached|Cache`, `Output|Ausgabe`. Tausendertrennzeichen ist **Komma** (`32,500` → `32500`); `parsePatternNum` akzeptiert Komma und Punkt in 3-Gruppen, ein echtes Dezimaltrennzeichen bleibt unterstützt. Ein Tausendertrennzeichen nie als Dezimal lesen — das ergäbe einen still falschen `pattern`-Wert.
- **zod-Validierung** (`validateSnapshot`): jedes Modell MIT Preisen/Nutzung MUSS `pattern` haben; kostenlose Zeilen (Preise 0, `usage` in allen Plänen `null`) sind ausgenommen; ungültige Daten → `process.exit(1)` → CI rot. Zusätzlich: die `usage`-Schlüssel müssen **exakt** den `plans[].id` entsprechen (fehlend oder unbekannt → rot); `FreeModelSchema` ist **`.strict()`** (jedes `usage`/`plan`/`plans`/`allowances`-Feld dort → rot, die Zen-Modelle sind plan-unabhängig).
- **Abdeckungs-Invariante** (`assertNonEmptyCatalog`, aufgerufen in `main()` nach `enrichFreeModels`): leere `plans`/`models` → `ScrapeError` → CI rot. **Keine festen Zahlen pinnen** — der Katalog wächst und schrumpft an der Quelle. Der abgefangene Fehlerfall ist der stille Parser-Ausfall: eine umgebaute Doku liefert 0 Zeilen. `freeModels` ist hier **bewusst nicht** enthalten: 0 kostenlose Zen-Modelle sind ein legitimer Quellstand.
- **Zen-Fetch-Unterscheidung** (`fetchZenFreeModels`): Doku erreichbar und ohne Gratis-Modelle → gültiger Stand, weiter. Doku **nicht erreichbar** → bisheriger Vorlauf wird behalten (Warnung). Nicht erreichbar **und** Vorlauf leer → `ScrapeError`, weil sonst ein stilles Null-Datum entstünde, das wie eine leere Gratis-Liste aussieht. Diese Unterscheidung gehört **nicht** in `assertNonEmptyCatalog`.
- Zen-Free-Models via `https://opencode.ai/v2/docs/console/models/` (`extractFreeModelsFromDocs`: die „Endpoints“-Tabelle liefert die Model-IDs, die „Pricing“-Tabelle markiert die gratis Zeilen (Input = `Free`); Tabellen liegen teils in `div.docs-table-scroll`-Wrappern, die der Parser durchsucht). `parseZenFreeModelPrivacy` liest ZDR/Training aus der Fußnoten-Liste „Free models“ (`h3#free-models`), `availableFrom` aus dem vorherigen Lauf übernehmen (`mergeFreeModels`).
- Diff gegen das vorherige `latest.json`: Modell hinzugefügt (mit Pricing-Zeile), Modell entfernt (mit `days` aus `firstSeen`), Nutzung verbessert/verschlechtert → `usage_changed`, Preisänderungen (Float-Toleranz 1e-9) → `price_changed` mit `fields`, Preis- UND Nutzungsänderung → zwei Events (`splitChange`), Fähigkeitsänderungen → `capabilities_changed` (undefiniert und `null` gelten als gleich; unterdrückt innerhalb von **72h** nach `model_added`/`free_added`), Datenschutzänderungen → `privacy_changed` (**nicht** bei Erst-Befüllung `undefined`/`null` → Wert; reine `validUntil`-Änderungen sind still), Free-Model-Events.
- **Fähigkeiten** aus models.dev via `@opencode-ai/models`: Live-API (`client.catalog()`, Timeout 10 s) mit Fallback auf den gebündelten Snapshot (`@opencode-ai/models/snapshot`, `source` = `live`/`snapshot`). Zuordnung über normalisierte Namen (`normalizeName`): zuerst `providers.opencode.models` (per ID/Name), dann kanonische `models`-Metadaten (bei Kollisionen exakter Normalized-ID-Treffer, sonst erste nach ID sortiert), Ausnahmen via `CAPABILITY_OVERRIDES`. Modelle ohne Treffer → `capabilities: null`. Die models.dev-Preise werden ignoriert. Hersteller-Anzeige (`provider`): `id`-Prefix via `PROVIDER_LABELS` (`glm-flash`/`zai` → `Z.ai`, `muse` → `Meta`), ersatzweise `family`, sonst Titel-Schreibweise; Stealth-IDs (`STEALTH_IDS`: `big-pickle`, `union-alpha`) → `"OpenCode Stealth"` mit Vorrang (bei Enthüllung austragen).
- **Datenschutz** über die Header-Zeile identifizieren (`model training` UND `data retention`, deutsche Aliase `modelltraining`/`datenaufbewahrung` bleiben; fehlende Tabelle → rot): `Not used` → `training: false`, `N days` → `retentionDays`, `0 days` → `true` (ZDR), `Not ZDR` → `false` (keine ZDR-Vereinbarung), `–` → unbekannt (`retentionDays` fehlt im JSON). Notizen-Liste unter der Tabelle: `valid through October 31, 2026` → `validUntil` (englische Monatsnamen, `parseEnglishDate`; deutsch „gilt bis einschließlich …“ via `parseGermanDate` bleibt). Zuordnung über `normalizeName` (eine Zeile gilt für alle Tier-Varianten); Familien-Label (z. B. `DeepSeek`) gilt per Präfix für alle Modelle der Familie (Exakt-Match zuerst, sonst längster Key). Eine Notiz ohne passendes Modell → `ScrapeError`. Modelle ohne eigene Zeile übernehmen via `PRIVACY_FALLBACKS` (explizit, z. B. MiniMax M2.5 → M2.7) die Familien-Angabe und werden mit `fallback: true` markiert; ohne Fallback → `privacy: null`.
- **Peak-Regeln** (`parsePeakRules`): Es werden **alle** `main p, main li`-Notizen mit `peak`/`spitzenzeiten`/`stoßzeiten` UND `UTC` eingesammelt (DOM-Reihenfolge) — eine zweite Notiz für einen weiteren Anbieter darf nicht still verloren gehen. Jede Notiz muss mindestens ein Peak-Modell treffen: (a) exakter Modellname im Subjekt (vor dem ersten `:`), (b) **Listen-Form** — das Subjekt wird an `/`, `,`, `;`, `+`, `&` sowie `und`/`and` in Einträge zerlegt; ein Eintrag ohne Familien-Präfix („V4 Pro“ in „DeepSeek V4.1 Flash / V4 Pro“) matcht, wenn das weggeworfene Präfix von einem Geschwister-Eintrag belegt ist — **ein aus dem Eintrag entferntes Modell ist KEIN Fehler**, oder (c) gemeinsamer Modell-Präfix (≥ 2 Wörter). Aus jeder Notiz werden **Fenster** (`parsePeakRanges`), **Wochentags-Scope** (`parseWeekdayScope`: de `montags bis freitags`/`mo-fr`/`werktags`/`wochentags`, en `monday to friday`/`mon-fri`/`weekdays`; `täglich`/`daily` → alle 7) und **Wochenend-Auszug** (`parseWeekendScope`: `wochenende(n)`, `samstag und sonntag`, `sa-so`; en `weekend(s)`, `saturday and sunday`, `sat-sun`) gelesen. `offPeak.days` = Komplement von `peak.days`; eine explizit genannte Wochenend-Angabe, die dem widerspricht → `ScrapeError`. **Fehlender Wochentags-Scope**, ein nicht zu {1..7} auflösbarer Bereich, eine **Feiertags-Aussage ohne bestimmbares Land** (`parseHolidays`: nur „chinesische …“/„chinese …“ ist bestimmbar) oder ein unparsebares Fenster → `ScrapeError`. `timezone` kommt aus `PEAK_TIMEZONE_BY_FAMILY` (DeepSeek → `Asia/Shanghai`); eine unbekannte Peak-Familie → rot (keine geratene Zone). `effectiveFrom` (`parseEffectiveFrom`) nur, wenn die Notiz ein effektives Datum nennt. **Jedes** Peak-Modell braucht eine Regel, sonst rot (lieber rot als „immer Off-Peak“ ohne Countdown); eine Notiz, der nach dem Streichen GAR kein Modell mehr zugeordnet werden kann, bleibt ebenfalls rot — nur das teilweise Verschwinden von Einträgen ist tolerant.
- **Keine Feiertagsdaten (strikt quellenbindend):** `parseHolidays` bleibt als Parser (Feiertage nur, wenn die Quelle sie nennt; Aussage ohne bestimmbares Land → rot). Die Quelle nennt keine Feiertage → `peakRules[].holidays` und `holidayCalendars` bleiben in `data/latest.json` **leer/fehlend**; **kein** Override.
- CHANGELOG.json: neuer `{ id, date, changes }`-Eintrag oben, `id` = git-tag-sicherer Run-Zeitstempel (`YYYY-MM-DDTHH-MM-SSZ`, UTC), `date` = `YYYY-MM-DD` nur für Anzeige/Groupierung. **Jeder Run** mit Änderungen erzeugt einen eigenen Eintrag (kein Day-Merge); ein Eintrag mit gleichem `id` wird ersetzt (idempotent bei CI-Wiederholungen). **Leere** Einträge (`changes: []`) werden entfernt, bei `changes.length === 0` wird kein Eintrag angelegt (auch kein Basis-Snapshot beim ersten Lauf). Vorschema-Einträge ohne `id` werden beim Laden via `normalizeChangelogIds` mit `id = date` migriert. `validateChangelog` (zod) bricht bei leeren Einträgen/unbekannten Typen rot ab. **Minified schreiben** (`JSON.stringify(changelog)` — eine Zeile), niemals hübsch formatiert.
- `model_removed.days` = `heute − firstSeen`, `firstSeen` = frühester Snapshot in `data/history.json`, der das Modell enthält.
- `data/latest.json`/`data/history.json` werden **nur bei Datenänderungen** geschrieben (`changes.length > 0`, `privacyPopulated` — stille Erst-Befüllung des `privacy`-Felds, `privacySilentUpdate` — reine `validUntil`-Änderung, `plansChanged` — geänderte `plans`-Liste (Preise/Guthaben/Reihenfolge), `peakRulesChanged` — geänderte `peakRules`, oder stille Anreicherungs-Updates `modelIdsPopulated`/`contextWindowPopulated`/`providerPopulated`/`fullIdsPopulated`; alle ohne Changelog-Events); sonst bleibt der Stand vom letzten Änderungstag erhalten (kein Commit, aber Deploy läuft weiter).
- **Build-Stempel:** `fetchedAt` (der „Stand“ im Footer) wird beim `vite build` in `vite.config.ts` (Plugin `stamp-build-time`) auf die **Build-Zeit** gesetzt. Das passiert **nur im Build-Output** (gebundeltes JS + `dist/data/latest.json`); `data/latest.json` bleibt unverändert → alleinige `fetchedAt`-Änderungen erzeugen **keinen Commit**.
- **Parsing-Fehler** (keine Preistabelle, unerwartete Spaltenstruktur, unparsebare Werte) → `process.exit(1)` → CI-Lauf wird rot.

## UI-Regeln (daisyUI 5 / Tailwind 4)

- Nur daisyUI- und Tailwind-Klassen verwenden; Default-Varianten bevorzugen; daisyUI-Semantic-Colors (`base-*`, `primary`, `badge-success/-error/-warning/-info`), kein `dark:`-Präfix.
- Kein `tailwind.config.js` — Tailwind 4 braucht nur `@import "tailwindcss";` + `@plugin "daisyui";` in `src/index.css`.
- Sprache: **Englisch ist Default** unter `/`, Deutsch als echte Subroute `/de/` (jeweils eigenes vorgerendertes HTML). Der Pfad ist die Quelle der Wahrheit; `?lang=de|en` bleibt als Alias erhalten (alte Links), wird nach der Hydration angewandt und die URL anschließend per `replaceState` auf die kanonische Pfadform gebracht. Beim Laden von `/` (kein `?lang=`) gilt nach der Hydration: gespeicherte localStorage-Wahl (`lang`), sonst Browser-Sprache (`navigator.language` beginnt mit `de` → `/de/`) — nicht umgekehrt, `/de/` wird nie überschrieben. **Query-Params bleiben beim Sprachwechsel erhalten** (nur `lang` wird in die Pfadform überführt). Crawler (ohne `navigator`) sehen auf `/` immer Englisch; ein Auto-Redirect passiert nur clientseitig. Theme per Inline-Script vor dem Paint (`data-theme` + `window.__OCGO_THEME_DARK__`), `basis` in localStorage.
- **Query-Params** (shareable URLs): `sort=field:asc|desc`, `fsort=…` (Free-Tabelle), `psort=model:tier:asc|desc` (Datenschutz-Tabelle, Default `tier:asc` = schlechteste Stufe oben), `basis=list|full|paid`, `lang=de|en`, `cap=image,video,audio,pdf` (Fähigkeiten-Filter Preistabelle, OR-Semantik), `fcap=…` (Fähigkeiten-Filter Free-Tabelle, unabhängig von `cap`), `allowancePlan=<plan-id>` (Sortier-Plan der `/allowances/`-Seite) — beim Laden URL > localStorage, Änderungen via `history.replaceState`.
- Preisbasis-Umschalter: `list` = Listenpreis, `full` = volles Monatsguthaben (verfügbar, sobald `creditsMonthly` bekannt ist — für Go, Go Plus **und** Go Teams mit $65), `paid` = „Was du zahlst“ (`× {costNum}/Nutzung`) — plan-abhängig über den aktiven Plan (`plan.creditsMonthly` / `actualPaid(plan)`, per `usageOf(m, plan)`). Nur bei `creditsMonthly: null` ist `full` deaktiviert und die UI wechselt auf `list`; Hero und Tooltip nennen dann ausdrücklich kein Guthaben. Nutzungsfarben verwenden **eine** Klassifikation gegen `plan.creditsMonthly` (100 %): `< paid` = `below-paid`, ≤ 25 % = `low`, < 100 % = `partial`, = 100 % = `at-reference`, > 100 % = `above-reference` (dunkelgrün `bg-green-800` mit `text-green-50`); `creditsMonthly: null` → `unknown` (nie eine erfundene Farbe, nie neutral für endliche Werte). Label-Hintergrund und Balkenfüllung derselben Stufe sind **identisch** (`usageBadgeClass`/`usageBarClass` teilen die Farbe; Balken sind deckend, außer den prozentualen Stufen `bg-error/75` und `bg-success/60`). Text auf Badge-/Primärflächen bleibt lesbar: `text-base-content` außer auf der dunkelgrünen Stufe (`text-green-50`). `src/fees.ts` enthält die Gebührenberechnung (für OpenCode Go derzeit 0).
- Seitenstruktur: Kurzerklärung → Preistabelle (Sortierung je Spalte, horizontales Scrollen per Drag-to-Scroll `setupDragScroll` auf dem `overflow-x-auto`-Container, Fähigkeiten-Badges-Spalte, Fähigkeiten-Filter-Toggles) → Free-Models-Tabelle (neuestes oben, eigene unabhängige Fähigkeiten-Filter-Toggles) → Datenschutz-Tabelle (`PrivacyTable`: Sortierung Modell/Stufe, Default `tier:asc` = schlechteste Stufe oben; Badges `badge-error` Modelltraining / `badge-warning` Aufbewahrung > 0 Tage und „Kein ZDR“ (Daten aufbewahrt, Dauer unbekannt) / `badge-success` ZDR / `badge-ghost` keine Angabe; „≈“ = Familien-Fallback; „Gültig bis“-Spalte = `validUntil` oder „bis auf weiteres“) → Changelog (JSON-Events, i18n-Texte, Badges) → Impressum/Datenschutz.
- **Zusätzliche Route `/allowances/` (de: `/de/allowances/`):** `AllowancePage` vergleicht die modellbezogenen Monatslimits **aller** Pläne nebeneinander (Balken + Anfragen/Monat-Schätzung je Modell), Sortier-Plan per Tabs/`?allowancePlan=`; die Balkenfarbe kommt aus derselben `usageBadgeClass`/`usageBarClass`-Klassifikation wie die Preistabelle (100 % = `creditsMonthly` des jeweiligen Plans). Die 100 %-Erklärung im Intro wird **aus den Plan-Daten** gefüllt (`{goCredit}`/`{goPlusCredit}`/`{goTeamsCredit}`/`{teamsPrice}`), nicht hartkodiert. Einstieg über den Header-Button („Pläne vergleichen“/„Compare plans“, `btn-primary` mit `text-primary-content`), daneben der externe Verweis auf `ai-10-usd.all-the.rest`.
- **Peak-Anzeige ist datengetrieben:** `PeakIndicator`/`PriceTable` bekommen `peakRules` + optional `holidayCalendars` und rufen `src/config/peakPricing.ts` auf. Tooltip/Countdown/`nextTransition` berücksichtigen Feiertage (optional, bei uns inert) und `effectiveFrom`; der Wochentags-Scope wird aus `peak.days` **generiert** (`formatDayScope`/`formatDayList`), nicht hartkodiert. Share-Cards (`src/share.ts`, Solid-frei) leiten den Scope ebenfalls aus den Daten ab.
- Quellen-Links (Go, Zen, models.dev), RSS-Link (`releases.atom`) und der „Verfügbar seit“-Hinweis stehen ausschließlich im Footer (kein Quellen-Link im Free-Models-Header). Changelog-Badges sind richtungsabhängig: `badge-error` ↑/− = teurer/weniger, `badge-success` ↓/+ = billiger/mehr, neutral ≈ = `badge-ghost`.
- **Changelog-Anzeigereihenfolge = Erstellungsreihenfolge** aus `buildChanges` (`plan_added` → `model_added` → `model_removed` → `price_changed`/`usage_changed` → `capabilities_changed` → `privacy_changed` → `free_*`). Es gibt **keine** Umkehrung im Renderer. Wer die Reihenfolge ändern will, ändert sie in `buildChanges` — nicht im UI.
- **Der Sticky-Header darf Inhalt überlagern — das ist gewollt.** In den Element-Aufnahmen (`*-changelog.png`, `*-secN.png`) klebt er mittig über dem Text, weil der Screenshot zum Element scrollt und der Header `position: sticky` ist. Das ist **kein** Befund des Screenshot-Reviews und rechtfertigt keinen Anker-Test; es zählt nur, wenn es im Full-Page-PNG sichtbar bleibt.

## CI/CD (`.github/workflows/price-tracker.yml`)

- Trigger: `workflow_dispatch` (extern per Server-Cron getriggert via `scripts/install-cron.sh`: Mo–Fr alle 2h 06:00–20:00 MEZ/MESZ, Sa/So 06:00+14:00) + täglicher GitHub-Actions-Safety-Net-Lauf (`schedule: "28 20 * * *"` = 20:28 UTC), `push` auf `main`.
- Pipeline: install (`--frozen-lockfile`) → `pnpm test` → `pnpm scrape` → `pnpm build` → `pnpm smoke`
  (bricht rot ab, bevor kaputte Bundles auf Pages landen) → Commit (CHANGELOG.json + data + src/data, `github-actions[bot]`, nur bei Änderungen) → Release (`node scripts/ensure-release.mjs --all` → `gh release create`/`edit` mit Tag = Eintrags-`id`, damit Watcher per E-Mail und RSS-Reader via `releases.atom` benachrichtigt werden) → Sync-Check (`node scripts/check-release-sync.mjs` bricht rot ab, wenn Changelog-Einträge und GitHub-Releases divergieren) → `upload-pages-artifact` (dist) + `upload-artifact` (dist-Zip) → `deploy-pages`.
- `scripts/release-notes.mjs` rendert Changelog-Einträge als **rein englisches Markdown mit nur den Fakten** (Titel + Event-Liste — keine Links zu Site/RSS, kein Watch-Hinweis). `scripts/ensure-release.mjs` stellt **pro Changelog-Eintrag genau eine Release** sicher (Tag = Eintrags-`id`) und läuft bei **jedem** Workflow-Lauf (nicht nur bei `changed=true`): `--all` prüft alle Einträge, erstellt fehlende Releases nach (Backfill, `--latest=false` für alle außer dem neuesten Eintrag) und editiert bestehende nur bei geänderten Notizen. Da jeder Run einen eigenen Eintrag bekommt, entsteht pro 2h-Lauf ggf. eine eigene Release. **Manuelle Korrekturen an Release-Inhalten erfolgen direkt via `gh` CLI** (`gh release edit <tag> --notes …`), nie über das Script. **Ausnahme:** eine bewusste **Renderer-/Formatmigration**, die das Notiz-Rendering aller Einträge ändert, läuft über `node scripts/ensure-release.mjs --all` — dafür ist das Script gebaut. Danach **immer** `node scripts/check-release-sync.mjs` als Kontrolle, und die betroffenen Releases vorher/nachher diffen. Sync: `scripts/check-release-sync.mjs` vergleicht jeden Changelog-Eintrag mit seiner Release (Tag = `id`, Notizen) und meldet verwaiste Releases — bei Divergenz rot.
- Nach einem Daten-Commit (`changed=true`) benachrichtigt der Deploy-Job das Vergleichs-Projekt `all-the-rest/ai-10-usd` per `repository_dispatch` (`event_type=source-updated`, POST auf `/repos/all-the-rest/ai-10-usd/dispatches`). Secret: `AI10USD_DISPATCH_TOKEN` (PAT mit `repo`-Scope bzw. fine-grained mit Contents read/write auf `ai-10-usd`, in **beiden** Tracker-Repos). Fehlt das Secret → Step übersprungen (grün); vorhanden → der Step prüft den HTTP-Status und bricht bei ≠ 2xx **rot** ab.
- **Lokale Daten-Commits (Push statt CI-Commit):** Wird eine Datenänderung lokal committet und per Push auf `main` gebracht — statt vom CI-Job —, feuert der automatische Dispatch **nicht** (der Scrape im CI findet keine Diffs, `changed=false`, Notify-Step übersprungen). Das Vergleichs-Projekt dann manuell triggern:
  ```bash
  gh api -X POST repos/all-the-rest/ai-10-usd/dispatches --input - <<'EOF'
  {"event_type":"source-updated","client_payload":{"source":"all-the-rest/ocgo-price-tracker","sha":"<SHA>"}}
  EOF
  ```
  `<SHA>` = committeter Datenstand (z. B. `git rev-parse HEAD`). Verifikation: `gh run list -R all-the-rest/ai-10-usd` → neuer `repository_dispatch`-Lauf (`source-updated`) wird grün.
- **Datenvertrag mit `ai-10-usd`:** Der Consumer normalisiert über `scripts/normalize.mjs` (`normalizeOpenCodeData`) und akzeptiert **beide** Formate — Legacy (`monthlyCredit`/`monthlyCost`, `usage` als Skalar, `multiplier`/`effective*`) und das Plan-Format (`plans[]`, `usage`-Map). `ai-10-usd` wählt aus `plans` den **günstigsten** Plan (kleinstes `priceMonthly`, Gleichstand → zuerst gelistet), also „Go“ ($10), **nicht** „Go Plus“ ($40) — es ist eine $10-Seite. Bei einem Schema-Bruch hier zuerst `normalize.mjs` im Schwestern-Repo nachziehen, dann hier.
- Ein fehlgeschlagenes `pnpm scrape` bricht die Pipeline ab (kein Commit/Deploy, Lauf rot).

## SEO / Prerender & Sprachen

- **Statisches Pre-Rendering:** `pnpm build` = `tsc --noEmit && node scripts/prerender.mjs`. Das Skript baut zuerst den Client (Vite-Config), dann die App als SSR-Bundle (`.ssr-build/`, `src/ssr-entry.tsx`, Solid `renderToString`) und ersetzt den leeren `<div id="root">` in `dist/index.html` durch das vorgerenderte Markup. Crawler/AI-Bots ohne JS sehen damit alle Preise.
- **Hydration:** `src/index.tsx` ruft `hydrate()` (Fallback `render` ohne Prerender). Der Client-Build nutzt `solid({ ssr: true })` → `generate: "dom", hydratable: true`. `generateHydrationScript()` (aus dem SSR-Bundle via `src/ssr-entry.tsx` re-exportiert) wird pro HTML-Datei in den `<head>` injiziert — ohne `window._$HY` scheitert `hydrate()`.
- **Sprach-Subrouten:** `dist/index.html` (en) und `dist/de/index.html` (de), dazu `dist/allowances/index.html` und `dist/de/allowances/index.html` für die Vergleichsseite. SSR rendert beide Sprachen (`renderApp(lang)`), `base: "/"` (absolute Assets, sonst brechen Pfade unter `/de/`). Client-Erstrender = Pfad-Sprache, gespeicherte Sprache/`?lang=…`/Sortierung/Filter erst nach der Hydration. `?lang=de|en` bleibt Alias; URL wird auf die Pfadform normalisiert. hreflang en/de/x-default, Canonical je Datei, `<html lang>` je Datei.
- **Build-Stempel:** `__BUILD_TIME_ISO__` per Vite-`define`, einmalig über `process.env.BUILD_STAMP` aus `scripts/prerender.mjs` gesetzt — Client und SSR zeigen denselben Footer-„Stand“ (hydration-stabil). `src/buildInfo.ts` liest den Wert.
- **Head-SEO (build-generiert in `prerender.mjs`):** Title/Description/Canonical/`og:locale` je Sprache, `hreflang`, RSS-Autodiscovery (`releases.atom`), JSON-LD (`WebSite` + `ItemList` aller Modelle). Zusätzlich `dist/robots.txt` und `dist/sitemap.xml` (beide Sprachen).
- **Tests:** `tests/seo.test.mjs` prüft `dist/` (skip ohne Build); `scripts/smoke.mjs` prüft nach dem Build `/`, `/de/`, `robots.txt`, `sitemap.xml`, `<h1>`, JSON-LD und vorgerendertes Markup in `#root`. `pnpm test` läuft in CI vor dem Build → die CI-Absicherung übernimmt der Smoke-Test.

## Tests

- `pnpm test` = Scraper-Unit-Tests (`tests/scrape.test.mjs`), E2E-Sortier-Test (`tests/sorting.test.mjs`,
  echte `PriceTable` per SolidJS-SSR), Peak-Auswertungs-Test (`tests/peak.test.mjs`: `isPeakAt`/`nextTransition`
  + Footer-Zeile per SolidJS-SSR, eigener Build in `tests/.ssr-peak/`, gitignored) und Share-Vertrags-Test
  (`tests/share.test.mjs`: `share.ts` ↔ `weighted.ts` laufen durch denselben Vite-SSR-Build — ein fehlender
  Export bricht den Build und damit den Test rot ab, statt erst im Browser aufzufallen).
- **Keine Zahlen-Pins auf generierte Daten** (gilt für alle Tests, auch die Schwestern-Repos): eine feste Zahl gegen `data/latest.json` oder einen anderen generierten Datensatz ist per Definition flüchtig — der Katalog wächst und schrumpft an der Quelle. Stattdessen Struktur-Invarianten: nicht leer, Pflichtfelder vorhanden, Fremdschlüssel stimmen, Schema-Parse läuft durch. Zahlen gegen **Fixtures** (`tests/fixtures/*.html`) und Changelog-EVENT-Logik (der Test baut die Eingabe selbst und zählt Ereignisse) sind davon **nicht** betroffen und bleiben. Die Abdeckung gegen leere Kataloge gehört ins Scrape-Skript (`assertNonEmptyCatalog`), nicht in den Test.
- Scraper-Tests decken die Peak-Regeln ab: Wochentags-Scope de+en, Wochenend-Auszug, Feiertags-Auszug
  (`parseHolidays` als Parser-Beweis), `ScrapeError` bei fehlendem Scope / Feiertag ohne Land /
  widersprüchlicher Wochenend-Angabe / widersprüchlichen Regeln, alle zod-Invarianten aus §1 als
  Negativtests — inklusive des **Fehlens** der Feiertagsdaten (Quelle nennt keine).
- Der Sortier-Test baut die echte `PriceTable`-Komponente per SolidJS-SSR (`tests/ssr-entry.tsx`, Vite-Build in `tests/.ssr/`, gitignored) und prüft für jede Preisbasis (`list`/`full`/`paid`) × Preisspalte (`input`/`output`/`cachedRead`/`cachedWrite`/`cost`) × Richtung, dass die gerenderte Reihenfolge exakt der Reihenfolge der **angezeigten** Werte (`fieldPrice`/`requestCost`) entspricht — nicht dem rohen Listenpreis.
- **Screenshot-Tests sind permanent:** neue UI-Features (insb. Share-Cards) bekommen Playwright-Tests in
  `tests/screenshots/` (Suite `playwright.screenshots.config.ts`, `pnpm test:screenshots`) — alle Size-Varianten
  + Mobile + beide Sprachen (de/en). Keine Einmal-Screenshots: die Tests bleiben im Repo und müssen bei jeder
  Umsetzung grün laufen.

## Verifikation

Der unabhängige Verifikator prüft in diesem Repo:

- `pnpm scrape` (exit 0, korrekte Daten — **vor Commit verpflichtend**), `pnpm test` grün, `pnpm build` grün,
  `dist/` enthält `data/latest.json` + `CNAME`, Workflow-YAML valide,
  `pnpm preview` liefert 200 und der JSON-Endpunkt `/data/latest.json` antwortet (alle Modelle mit `privacy`).
- **aktuelle Tool-Versionen**: `pnpm outdated` ohne ungewollte Abweichungen, Node ≥22, pnpm aus `packageManager`.

**Visuelle Verifikation (Pflicht bei UI-Änderungen, Skill `ui-review`):**
`pnpm test:screenshots` (eigene Config auf Port 5177, gateet nie CI) → PNGs unter
`test-results/ui-screenshots/<state>/<viewport>/`, Full-Page **plus** `-secN`-Abschnitte
(eine Seite >2000 px wird im Full-Page-PNG downskkaliert und unterhalb des Folds unlesbar).
Analyse selbst in Batches (≤10 Bilder, nach Zustand → Viewport → Route) gegen die
Checkliste des Skills; unsichere Befunde (Hairline-Borders, 8-px-Gaps, unlesbare
Downscale-Regionen) liest das Modell **erneut selbst** mit einer konkreten Frage nach
(Skill `ui-review`: re-read, do not guess) statt zu raten — es gibt keinen
Vision-Subagenten mehr, und der Report wird nicht mit unsicheren Befunden gefüllt.
Findings-Report mit `Severity | File:Line | Screenshot | Finding | Suggested fix`;
`critical`/`high` blockieren die Freigabe. Zusätzlich `pnpm test:contrast` — die
automatisierte WCAG-AA-Matrix über alle daisyUI-Badge-/Alert-Kombinationen in
hell **und** dunkel; Failures sind blockierend wie `critical`/`high`. Nach einem Fix
nur die betroffenen Routen neu schießen (`--grep`) und alt vs. neu vergleichen.

**Manuelle Abnahme vor Push:** Bei größeren UI-Änderungen `pnpm build` + `pnpm preview`
starten (produktionsnahes Prerender, beide Sprachen, `?plan=`/`?basis=`/`?lang=`/`?theme=`
funktionieren) und **vor** Commit/Push abnehmen lassen. Kein Push ohne Abnahme.

## Delegation & Parallelisierung (Subagenten)

Rollen, Delegation und Verify-Läufe: Orchestrator delegiert, Implementierung und Verifikation laufen in
**getrennten** Subagenten, jeder Subagent bekommt eine in sich geschlossene Aufgabenbeschreibung,
kleine Edits macht der Orchestrator direkt.

- **Entscheidungen werden IMMER als interaktive Frage gestellt** (Tool `question`), nie als Frage im Fließtext:
  echte Wahlmöglichkeiten (Alternative ja/nein, Datenmodell, Event-Form, Abbruch-vs-weiter) mit einer Empfehlung
  als erster Option, Varianten in einem Satz begründet.
- **Jede so getroffene Entscheidung wird in `AGENTS.todo.md` festgehalten** (Kurzfassung mit Begründung als Checkliste: `[x]` umgesetzt / `[ ]` offen, plus Abschnitt „Verworfen“ für zurückgezogene Ansätze, damit sie nicht erneut implementiert werden). Regeln, die daraus folgen, gehören nach `AGENTS.md`; Begründung und Historie nicht. Nie nur im Chat. Diese Regel steht auch global in `~/.config/opencode/AGENTS.md`.

## Schwester-Projekte (Git-Remotes)

Tracker-Familie (alle unter `all-the-rest/`): `ocgo-price-tracker` (dieses Repo, `origin`),
`ai-10-usd`, `cc-price-tracker`, `provider-plans` (als gleichnamige Remotes eingebunden).

```bash
git remote add ai-10-usd https://github.com/all-the-rest/ai-10-usd.git
git remote add cc-price-tracker https://github.com/all-the-rest/cc-price-tracker.git
git remote add provider-plans https://github.com/all-the-rest/provider-plans.git
```

Vergleichen (read-only, `origin` bleibt unberührt):

```bash
git fetch ai-10-usd main --dry-run
git log --oneline origin/main..ai-10-usd/main --no-decorate | head
```
