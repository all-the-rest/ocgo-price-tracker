# AGENTS.md

## Projektüberblick

Preis-Tracking für OpenCode Go. Ein täglicher GitHub-Actions-Lauf scrapet
`https://opencode.ai/docs/de/go/`, berechnet die Preise auf Basis des vollen
Monatsguthabens (Effektivpreis = Listpreis × Guthaben/Nutzung) und stellt eine
statische SolidJS-Seite unter `https://ocgo-pricing.all-the.rest` bereit.
OpenCode Go hat **zwei Abonnemente** (Stand 2026-09-28): **Go** ($10/Monat) und
**Go Plus** ($40/Monat). Die Tokenpreise sind in beiden identisch, die **Nutzung
pro Modell ist pro Plan verschieden** — die Doku liefert dafür je eine
Preistabelle in einem `starlight-tabs`-Baustein. Die Seite hat entsprechend
Plan-Tabs, und `models[].usage` ist eine **Plan-Map**.

Alle Daten kommen von der einen Doku-Seite: Temporäre Nutzungs-Boni stehen
**inline in der Preistabelle**
(`<del>$15</del> <strong>$60</strong><br><small>4x · Endet am 20. Sept.</small>`
→ `parseUsageCell` liest den aktuellen Wert). Pläne, Monatspreise und
Monatsguthaben kommen aus der **Plan-Tabelle** (`Abonnement | Preis | Enthaltene
Nutzung`) und den **Tab-Panels**; `creditsMonthly` ist die höchste endliche
Nutzung des jeweiligen Plans (ersetzt die 2026-09 entfernte Prosa „Nutzung im
Wert von $60“ / „das Sechsfache dieses Betrags“).

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
pnpm test             # Scraper-Unit-Tests (node --test, Fixture tests/fixtures/go-de.html)
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
  "sourceUrl": "https://opencode.ai/docs/de/go/",
  "capabilitiesSourceUrl": "https://models.dev",
  "sourceLang": "de",
  "plans": [
    { "id": "go", "name": "Go", "priceMonthly": 10, "creditsMonthly": 60, "sourceUrl": "https://opencode.ai/docs/de/go/" },
    { "id": "go-plus", "name": "Go Plus", "priceMonthly": 40, "creditsMonthly": 240, "sourceUrl": "https://opencode.ai/docs/de/go/" }
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

- `usage` = **Plan-Map** `PlanId → Nutzung in $` (aktueller Wert aus der Preistabelle des Plans, inkl. inline eingepreister Boni, z. B. `<del>$15</del> <strong>$60</strong>` → `60`); `null` = unbegrenzt (kostenlose Zeilen). Die Schlüssel sind **exakt** die `plans[].id`. Ein Bonus-Anstieg senkt `multiplier` und damit die Effektivpreise.
- `plans[]` = die Abonnemente aus der Plan-Tabelle; `id` = Tab-Label normalisiert (lowercase, Whitespace → `-`: „Go Plus“ → `go-plus`). `priceMonthly` = Abo-Preis, `creditsMonthly` = **höchste endliche Nutzung dieses Plans** (Go 60, Go Plus 240) — das ist die Quelle für die Preisbasis „volles Monatsguthaben“ (`multiplier = plan.creditsMonthly / usage[plan.id]`).
- `peakRules` (ersetzt das frühere `peakHours`, **entfernt**): Modell-Normalform (`normalizeName`) → `{ timezone, effectiveFrom?, peak: { days, windowsUtc }, offPeak: { days, allDay: true }, holidays? }`. `days` = ISO-Wochentage (**1 = Montag … 7 = Sonntag**); `windowsUtc` = UTC-Stundenfenster `[start,end]` (0 ≤ start < end ≤ 24, aufsteigend, nicht überlappend, ≥ 1) — gelten an `peak.days`. `offPeak.days` = Komplement von `peak.days` (dort ganztägig Off-Peak). `timezone` = IANA-Zone, **in der der Wochentag bewertet wird** (DeepSeek: `Asia/Shanghai`). `effectiveFrom` (ISO mit Offset, optional) nur, wenn die Quelle ein effektives Datum nennt. `holidays` (`{ policy: "off-peak", calendar }`, optional) wird **nur** gesetzt, wenn die Quelle Feiertage nennt — die OpenCode-Doku nennt an der Peak-Notiz **keine** Feiertage (live verifiziert, de **und** en), deshalb ist das Feld im Datensatz **nicht** befüllt. Die Angabe „excluding Chinese public holidays" steht nur in der DeepSeek-Originaldoku (aus der Go-Doku verlinkt), nicht in der Quelle dieses Trackers → kein Tracker-Datum (strikt quellenbindend, keine Overrides).
- `holidayCalendars` (Top-Level, **optional**): Kalender-Schlüssel (z. B. `china`) → `{ dates: ["YYYY-MM-DD", …] (aufsteigend, lokale Kalendertage der Regel-Zone), coveredThrough: "YYYY-MM-DD" }`. Wird **nicht geschrieben**, weil die Quelle keine Feiertage nennt (kein `chinese-days` o. Ä. im Scrape-Pfad); das Feld bleibt im Typ/zod-Schema, damit die Datenform die Quelle nicht verengt und der Consumer (`ai-10-usd`) tolerant bleibt. Die Auswertung in `src/config/peakPricing.ts` liest es weiterhin optional.
- **zod-Invarianten der Peak-Regeln:** `peak.days`/`offPeak.days` nicht leer, keine Duplikate, disjunkt, zusammen {1..7}; `timezone` gültiger IANA-Name; `holidays.calendar` **muss** in `holidayCalendars` stehen; `dates` streng aufsteigend und ≤ `coveredThrough`. Verstoß → CI rot.
- **Auswertung** liegt **einmal** in `src/config/peakPricing.ts` (`isPeakAt`/`nextTransition`), nicht in den Komponenten: Feiertag (in `rule.timezone`) → Off-Peak; sonst Peak, wenn Wochentag ∈ `peak.days` UND UTC-Stunde ∈ Fenster; sonst Off-Peak. Vor `effectiveFrom` kein Peak. Kein 调休/`isWorkday` (ein 调休-Samstag bleibt Off-Peak).
- **Effektivpreise und `multiplier` werden NICHT mehr vorberechnet** (bis 2026-09-28 gab es `models[].multiplier` + `models[].effective*` und die Top-Level-Felder `monthlyCredit`/`monthlyCost`; alle vier sind entfernt). Grund: sie sind plan-abhängig. Die Rechnung liegt jetzt in der UI (`src/weighted.ts`: `usageOf`/`multiplierOf`/`fieldPrice`) — **eine** Quelle der Wahrheit statt zwei.
- **Kostenlose Preistabellen-Zeilen** (`Monatliches Limit` = `-`/`Unbegrenzt`, z. B. Space Bunny Free): Token-Preise (`input`/`output`/`cachedRead`/`cachedWrite`) werden als `0` erfasst, nicht als `null` — gratis ist ein bekannter Preis. `usage` ist in **allen** Plänen `null`. `pattern` bleibt für diese Zeilen `null` und ist **nicht** Pflicht (zod-Prüfung: nur von 0 verschiedene Preise erfordern ein Muster); `requestCost` = 0 → UI zeigt `$0.00` statt `-`.
- `pattern` = dokumentiertes Anfragemuster (Input/Cached/Output Tokens pro Anfrage) — **Pflicht** (zod). Kosten pro Anfrage = Muster × Modellpreis (Input: 5% Input-Preis + 95% Cached-Write-Preis, Cached: Cached Read, Output: Output). Fehlendes Muster bricht den Lauf rot ab.
- `capabilities` = Fähigkeiten aus models.dev (via `@opencode-ai/models`): `input`/`output`-Modalitäten (`text`, `audio`, `image`, `video`, `pdf`), `reasoning`, `toolCall`. `null` = kein models.dev-Eintrag. **Nur Fähigkeiten — die Preise bleiben aus dem Go-Scrape (models.dev-Preise weichen ab und werden ignoriert).**
- `privacy` = Datenschutz-Info aus der Doku-Tabelle (`Modelltraining`/`Datenaufbewahrung`): `training` (bool, `true` = Daten fürs Modelltraining), `retentionDays` (**`true`** = ZDR/0 Tage, **`false`** = kein ZDR (Daten werden aufbewahrt, Dauer unbekannt), **`number`** = N Tage Aufbewahrung, **fehlend/`undefined`** = unbekannt/"–"), `validUntil` (ISO-Datum = Ablauf der ZDR-Vereinbarung, z. B. monatliche Verlängerung DeepSeek V4 Flash), `fallback` (optional `true` = nicht in der Doku gelistet, Angabe aus derselben Modellfamilie via `PRIVACY_FALLBACKS`). `null` = keine Angabe (weder eigene Zeile noch Familien-Fallback). **Kostenlose Zen-Modelle** beziehen ihre Angabe aus der Fußnoten-Liste „Die kostenlosen Modelle:“ auf `/docs/de/zen/` (`parseZenFreeModelPrivacy` in `enrichFreeModels`): ZDR-Modelle („Zero-Retention“ + „nicht zum Trainieren“) sind `training: false, retentionDays: true`, Feedback-Modelle `training: true`; die Go-Datenschutz-Tabelle ist für Free-Modelle **nicht** maßgeblich. `training: true` ist der Fallback für Modelle ganz ohne Datenschutz-Aussage („unbekannt“); manuelle `FREE_MODEL_PRIVACY_OVERRIDES` haben Vorrang.
- `capabilitiesSourceUrl` = `https://models.dev` (Fähigkeiten-Quelle).
- `cachedWrite: null` (= `-` in der Doku) bedeutet: Cached-Write-Preis = **Input-Preis** (1:1, keine Schätzung). In `requestCost` fließt er als Cached-Write-Preis in die 5/95-Heuristik ein; in der Tabelle steht weiterhin `-` (Heuristik nur im Footer dokumentiert). Die 5/95-Gewichtung (5% Input-Preis + 95% Cached-Write-Preis für Input-Tokens) basiert auf beobachteter Nutzung (Luna ~28/72, Qwen3.8 Max ~0/100 Input/Cached-Write).
- `freeModels` = kostenlose Zen-Modelle aus der Zen-Doku `https://opencode.ai/docs/de/zen/` („Endpunkte"-Tabelle liefert die Model-IDs, „Preise"-Tabelle markiert die gratis Zeilen via `extractFreeModelsFromDocs`, `privacy` aus der Fußnoten-Liste „Die kostenlosen Modelle:“ via `parseZenFreeModelPrivacy`); `availableFrom` = erstes Beobachtungsdatum (bleibt über Läufe erhalten). `fullId` = volle Kopier-ID aus der UI (`opencode/<id>` bzw. `opencode-go/…`, via `resolveOpencodeId`); `id` bleibt stabiler Schlüssel (Merge, Changelog, Zen-Endpunkte).
- **`freeModels` sind plan-unabhängig:** die Zen-Free-Modelle sind in **allen** Abonnements nutzbar und tragen **keine** Plan-Dimension — kein `usage`, kein `plan` (zod-Invariante: `FreeModelSchema` bekommt kein solches Feld). Die `usage`-Map gilt ausschließlich für die Go-Katalogzeilen in `models[]`. Die UI filtert Free- und Datenschutz-Tabelle deshalb **nie** nach Plan; `free_added`/`free_removed`-Events sind ebenfalls plan-unabhängig. Nicht zu verwechseln mit den zwei **Gratis-Zeilen in der Go-Preistabelle** (`LongCat 2.5 Preview Free`, `Space Bunny Free`): die stehen in beiden Plan-Tabellen mit `usage: null` und sind damit in beiden Plänen gratis.
- `data/history.json` = `{ "snapshots": [ … ] }` (Chronologie, append, nur bei Änderungen)
- `CHANGELOG.json` = `{ "entries": [{ "date", "changes": [ … ] }] }`; wird bewusst **minified** (`JSON.stringify`, eine Zeile) geschrieben — nie hübsch formatiert, damit Git-Diffs minimal bleiben. Events (zod via `validateChangelog`):
  - `text` (mit `lang` = `{ de, en }`-Übersetzungen, z. B. `{ de: "Initialversion", en: "Initial version" }`; keine freien Texte)
  - `model_added` (mit `pricing` = `{ input, output, cachedRead, cachedWrite, usage }`, die Go-Tabellen-Zeile)
  - `model_removed` (mit `days` = verfügbare Tage, `firstSeen` aus `history.json`-Chronologie)
  - `price_changed` (mit `from`/`to` = komplette Pricing-Zeile und `fields` = geänderte Preisfelder `["input","output","cachedRead","cachedWrite"]`; die UI stellt die Felder in **beiden** Zeilen fett dar)
  - `usage_changed` (**plan-aware**, Muster aus `cc-price-tracker`): `{ model, plans: [{ plan, from, to }] }` — **ein Event pro Modell**, im `plans`-Array nur die Pläne, deren Nutzung sich tatsächlich geändert hat (leeres Array → kein Event). Preis-, Datenschutz-, Fähigkeits- und Free-Events bleiben plan-unabhängig. **Keine Legacy-Form mehr:** die ~40 Einträge vor der Plan-Einführung hatten skalare `from`/`to` und ein skalares `pricing.usage`; sie wurden am 2026-09-28 **einmalig migriert** (→ `plans: [{ plan: "go", … }]` bzw. `{ "go": … }`) und die betroffenen GitHub-Releases neu geschrieben. zod, Typen, UI und `release-notes.mjs` kennen deshalb **nur noch** diese Form — keine Union, kein Skalar-Zweig, Plan-Name wird immer genannt. Einziger verbleibender Legacy-Ballast: `pricingOf` in `scripts/scrape.mjs` normalisiert einen skalaren `usage` aus einem **alten** Snapshot auf `{go: wert}` — reiner Lese-Schutz, damit ein Checkout eines alten JSON keinen Müll im Diff erzeugt, kein Rendering-Sonderfall.
  - `plan_added` (mit `plan` = Plan-Id, `name`, `priceMonthly`, `creditsMonthly`): **genau ein** Event, wenn ein Plan in `plans[]` neu auftaucht. **Nutzungsänderungen für einen neu hinzugekommenen Plan werden im selben Lauf unterdrückt** — es gab vorher nichts, was sich geändert haben könnte. Bewusste Entscheidung gegen 37 Einzel-Events („Nutzung Go Plus: nichts → $180"): die sind informationsleer (jeder Wert steht ohnehin im Plan-Tab der Preistabelle) und überlagern die echten Nachrichten desselben Tages. Wer den neuen Tarif kennen will, braucht **eine** Zeile mit Preis und Guthaben. Typisiert statt `text`, weil ein späteres `plan_removed` sonst wieder Sonderfälle braucht und der Plan nicht maschinell filterbar wäre.
  - `capabilities_changed` (mit `from`/`to` = capabilities-Objekt oder `null`; löst auch bei Nur-Fähigkeiten-Änderungen einen Daten-Commit aus)
  - `privacy_changed` (mit `from`/`to` = privacy-Objekt oder `null`; löst bei Änderung von `training`/`retentionDays`/`fallback` aus — **nicht** bei Erst-Befüllung `undefined`/`null` → Wert und **nicht** bei reiner `validUntil`-Änderung: ZDR-Verlängerung/-Datum wird still in die Daten übernommen, ohne Changelog-Event)
  - `free_added`/`free_removed` (mit `availableFrom`/`until`)
  - Preis- UND Nutzungsänderung am selben Tag → **zwei Events** (`price_changed` + `usage_changed`). **Keine** `baseline`/`pricing_changed`-Events. Einträge haben IMMER `changes.length > 0`; ohne Änderungen wird kein Eintrag angelegt, leere Einträge werden entfernt. **Jeder Run** (alle 2h + 22:30) schreibt bei Änderungen einen **eigenen** Changelog-Eintrag (`id` = Run-Zeitstempel) — mehrere Läufe pro Tag ergeben mehrere Einträge, es gibt **kein Day-Merge** mehr (`upsertChangelogJson` schreibt pro `id` einen Eintrag, ersetzt bei gleichem `id` idempotent).
- **Manuelle Korrekturen (Patches):** Werden Zuordnungs-Fehler von Hand ausgebessert (z. B. `CAPABILITY_OVERRIDES` führt `capabilities: null` → Objekt), erzeugt der Scrape dafür Changelog-Events — die werden **manuell aus `CHANGELOG.json`/`src/data/changelog.json` entfernt** (bereinigter Changelog, der Patch ist eine Fehlerkorrektur, keine echte Änderung der Quelle). Die Events-Mechanik bleibt dabei **generell aktiv** (insbesondere `capabilities_changed` — echte Fähigkeitsänderungen der Quelle sind selten, aber ein wichtiges Signal). Die Daten (`data/latest.json`/`history.json`) behalten die korrigierten Werte. **Gilt auch für Schema-Migrationen:** beim Plan-Umbau (2026-09-28) erzeugte der erste Lauf 37 `usage_changed` für Go Plus, obwohl sich an den Modellen nichts geändert hat (Go Plus existierte im Datensatz vorher nicht). Die wurden von Hand entfernt, die 5 echten `model_removed` (GLM-5.1, MiniMax M2.5, Qwen3.7 Max, 2× Qwen3.6 Plus — wirklich aus der Doku verschwunden) blieben stehen. Faustregel: **bleibt nur übrig, was sich an der Quelle geändert hat.**

## Scraper-Regeln (`scripts/scrape.mjs`)

- Preistabelle über die **Header-Zeile** identifizieren — NICHT über `nth-child`-Selektoren. **Beide Sprachen** akzeptieren (die Doku hat die Tabellen am 2026-09-28 auf Deutsch umgestellt): Eingabe `input` **oder** `eingabe`, Ausgabe `output` **oder** `ausgabe`, Cached Read `cached read` **oder** `cache-lesevorgang`, Cached Write `cached write` **oder** `cache-schreibvorgang`, Nutzung `nutzung`/`usage`/`limit`/`monatliches limit`/`monthly limit`, Modell `model`/`modell`. Es gibt jetzt **mehrere** Preistabellen (eine pro Plan) — jede wird gefunden, nicht nur die erste.
- **Plan-Zuordnung der Preistabellen:** die Preistabellen liegen in `<starlight-tabs>`-Panels. Zuordnung über **ARIA**, nicht über Position: Panel `[role=tabpanel][aria-labelledby=tab-NN]` → Tab `[role=tab]#tab-NN` (im selben `starlight-tabs`) → dessen Label ist der Plan-Name → normalisiert = `plans[].id`. Panel ohne Label, Tab ohne Panel, zwei Preistabellen in einem Panel, Panel-Label ohne passenden Plan aus der Plan-Tabelle oder Anzahl Preistabellen ≠ Anzahl Pläne → `ScrapeError` (rot). Die zwei **Rate-Limit-Tabellen** (`Anfragen pro 5 Stunden`/`pro Woche`/`pro Monat`) werden nicht geparst und dürfen nicht als Preistabelle matchen.
- **Preis-Kreuzprüfung über die Pläne:** die Doku verspricht, dass die Tokenpreise in allen Plänen identisch sind. Datenquelle ist die erste Preis-Tabelle; alle weiteren werden dagegen geprüft. Abweichende Tokenpreise **oder** abweichende Modellnamen-Mengen zwischen den Tabellen → `ScrapeError`. Gewollt: lieber rot als eine falsche Anzeige — Preis-Korrektheit ist die wichtigere Invariante als Plan-Vollständigkeit.
- Preise: `$1.40` → `1.4`; `Free`/`Kostenlos` (case-insensitive) → `0`; `-` → `null`. Nutzung `Unbegrenzt`/`Unlimited` → `null` (kein Limit); `<small>`-Hinweise wie „für begrenzte Zeit“ werden von `parseUsageCell` ignoriert.
- `Monatliches Limit` ist `$15` oder `$60` und **pro Plan verschieden** (Go Plus z. B. $120/$180/$240); Modellname mit `(… tokens)`-Suffix → `tier`-Feld.
- **Nutzungs-Boni** stehen inline in der Doku-Preistabelle (`<del>$15</del> <strong>$60</strong>` + `<small>4x · Endet …</small>` in der Nutzungs-Zelle; `parseUsageCell` liest den aktuellen Wert, `parseDocsUsageBonuses` liefert nur Reporting-Labels). Keine zweite Quelle — die Landingpage wird nicht gefetcht.
- **Pläne, Monatspreis und Monatsguthaben kommen aus der Plan-Tabelle** (`Abonnement | Preis | Enthaltene Nutzung`, Aliase auch `plan`/`price`): je Zeile ein Plan (Name → `id`, `$10/Monat` → `priceMonthly: 10`). `creditsMonthly` = **höchste endliche `usage` in diesem Plan** (Go 60, Go Plus 240) — das ist die Basis für „volles Monatsguthaben“. Fehlt die Plan-Tabelle oder ist ein Planpreis unparsebar → `ScrapeError`. **Kein Fallback auf Konstanten mehr**: die früheren Prosa-Parser (`parseMonthlyCreditDirect` „Monatliches Limit — Nutzung im Wert von $60“, `parseCreditFactor` „das Sechsfache dieses Betrags“, `parseMonthlyPricing`, `DEFAULT_MONTHLY_CREDIT/COST`) sind entfernt — die Doku hat diese Sätze am 2026-09-28 gestrichen, und ein stiller 60/10-Fallback wäre für Go Plus schlicht falsch.
- **Schreibweisen normalisieren (nie add/remove bei Umbenennung):** Die Doku wechselt teils die Schreibweise (`MiMo V2.5` ↔ `MiMo-V2.5`). `canonicalModelName` (via `MODEL_NAME_ALIASES`, neue Varianten dort ergänzen; `canonicalFreeName` für Free-Anzeigenamen) mappt beim Parsen auf die kanonische Form; `computeDiff`/`computeCapabilityDiff`/`computePrivacyDiff` matchen zusätzlich auf normalisiertem Key (`normalizeName`: Kleinbuchstaben ohne Leerzeichen/Bindestrich), Events tragen die bisherige Schreibweise (stabil). `firstSeen` toleriert Legacy-Snapshot-Einträge (freie IDs als reine Strings).
- **Anfragemuster** pro Modell extrahieren; Kurzschreibweisen (`GLM-5.3/5.2`, `Kimi K2.7/K2.6`) gegen die Modellnamen auflösen. Fehlende Muster über `PATTERN_FALLBACKS` (z. B. MiniMax M2.5 → M2.7) auffüllen. Die Notizen sind **deutsch und Zahlenformat haben mitgewechselt**: Labels `Eingabe|Input`, `Cache|Cached`, `Ausgabe|Output` (`Grok 4.7/4.6 — 390 Eingabe-, 32,500 Cache-, 120 Ausgabe-Tokens pro Anfrage`). Tausendertrennzeichen ist jetzt **Komma** (`32,500` → `32500`), vorher Punkt (`1.100` → `1100`) — `parsePatternNum` akzeptiert beides in 3-Gruppen, ein echtes Dezimaltrennzeichen bleibt unterstützt. Ein Tausendertrennzeichen nicht als Dezimal zu lesen ist hier kein Schönheitsfehler, sondern ein still falscher `pattern`-Wert.
- **zod-Validierung** (`validateSnapshot`): jedes Modell MIT Preisen/Nutzung MUSS `pattern` haben; kostenlose Zeilen (Preise 0, `usage` in allen Plänen `null`) sind ausgenommen; ungültige Daten → `process.exit(1)` → CI rot. Zusätzliche Invarianten: die `usage`-Schlüssel müssen **exakt** den `plans[].id` entsprechen (fehlend oder unbekannt → rot), `FreeModelSchema` ist **`.strict()`** (jedes `usage`/`plan`/`plans`/`allowances`-Feld dort → rot, die Zen-Modelle sind plan-unabhängig).
- **Abdeckungs-Invariante** (`assertNonEmptyCatalog`, aufgerufen in `main()` nach `enrichFreeModels`): leere `plans`/`models` → `ScrapeError` → CI rot. **Keine festen Zahlen pinnen** — der Katalog wächst und schrumpft an der Quelle. Der Fehlerfall, den ein Zahlen-Pin nebenbei abfing, ist der stille Parser-Ausfall: eine umgebaute Doku (Tabelle umbenannt, Überschrift entfernt) liefert 0 Zeilen, und ohne diese Prüfung würde der Lauf einen leeren, schema-validen Snapshot committen und die Seite leer rendern. `freeModels` ist hier **bewusst nicht** enthalten: **0 kostenlose Zen-Modelle sind ein legitimer Quellstand** und dürfen den Lauf nicht abbrechen.
- **Zen-Fetch-Unterscheidung** (`fetchZenFreeModels`): die Doku nennt **keine** Gratis-Modelle (erreichbar, leeres Ergebnis) → gültiger Stand, weiter. Doku **nicht erreichbar** → bisheriger Vorlauf wird behalten (Warnung). Nicht erreichbar **und** Vorlauf leer → `ScrapeError`, weil sonst ein stilles Null-Datum entstünde, das wie eine leere Gratis-Liste aussieht und einen Ausfall als Quellstand ausgibt. Diese Unterscheidung ist nur hier möglich, solange „nicht lesbar" und „leer" noch unterscheidbar sind — deshalb gehört sie nicht in `assertNonEmptyCatalog`.
- Zen-Free-Models via `https://opencode.ai/docs/de/zen/` (`extractFreeModelsFromDocs`: „Endpunkte"-Tabelle liefert die Model-IDs, „Preise"-Tabelle markiert die gratis Zeilen; `parseZenFreeModelPrivacy` liest ZDR/Training aus der Fußnoten-Liste „Die kostenlosen Modelle:"), `availableFrom` aus dem vorherigen Lauf übernehmen (`mergeFreeModels`).
- Diff gegen das vorherige `latest.json`: Modell hinzugefügt (mit Pricing-Zeile), Modell entfernt (mit `days` aus `firstSeen`), Nutzung verbessert/verschlechtert → `usage_changed`, Preisänderungen (Float-Toleranz 1e-9) → `price_changed` mit `fields` (geänderte Preisfelder), Preis- UND Nutzungsänderung → zwei Events (`splitChange`), Fähigkeitsänderungen → `capabilities_changed` (undefiniert und `null` gelten als gleich; unterdrückt innerhalb von **72h** nach `model_added`/`free_added` — verzögerte models.dev-Erstbefüllung), Free-Model-Events.
- **Fähigkeiten** aus models.dev via `@opencode-ai/models`: Live-API (`client.catalog()`, Timeout 10 s) mit Fallback auf den gebündelten Snapshot (`@opencode-ai/models/snapshot`, `source` = `live`/`snapshot`). Zuordnung über normalisierte Namen (`normalizeName`): zuerst `providers.opencode.models` (per ID/Name), dann kanonische `models`-Metadaten (bei Kollisionen exakter Normalized-ID-Treffer, sonst erste nach ID sortiert), Ausnahmen via `CAPABILITY_OVERRIDES`. Modelle ohne Treffer → `capabilities: null`. Die models.dev-Preise werden ignoriert. Hersteller-Anzeige (`provider`): `id`-Prefix via `PROVIDER_LABELS` (`glm-flash`/`zai` → `Z.ai`, `muse` → `Meta`), ersatzweise `family`, sonst Titel-Schreibweise; Stealth-IDs (`STEALTH_IDS`: `big-pickle`, `union-alpha`, Lab unbekannt) → `"OpenCode Stealth"` mit Vorrang (analog opencode-usage, bei Enthüllung austragen).
- **Datenschutz** über die Header-Zeile identifizieren (`modelltraining` UND `datenaufbewahrung`, analog Preistabelle; fehlende Tabelle → rot): `Nicht verwendet` → `training: false`, `N Tage` → `retentionDays`, `0 Tage` → `true` (ZDR), `Kein ZDR` → `false` (keine ZDR-Vereinbarung — z. B. Muse Spark 1.2, Meta-Contributor-Tier), `–` → unbekannt (`retentionDays` fehlt im JSON). Notizen-Liste unter der Tabelle: `gilt bis (einschließlich) D. Month YYYY` → `validUntil` (deutsche Monatsnamen, `parseGermanDate`). Zuordnung über `normalizeName` (eine Zeile gilt für alle Tier-Varianten); Familien-Label (z. B. `DeepSeek`) gilt per Präfix für alle Modelle der Familie (Exakt-Match zuerst, sonst längster Key). Eine Notiz ohne passendes Modell → `ScrapeError` (CI rot). Modelle ohne eigene Zeile übernehmen via `PRIVACY_FALLBACKS` (explizit, z. B. MiniMax M2.5 → M2.7) die Familien-Angabe und werden mit `fallback: true` markiert; ohne Fallback → `privacy: null`.
- **Peak-Regeln** (`parsePeakRules`, ersetzt `parsePeakHours`): Es werden **alle** `main p, main li`-Notizen mit `peak`/`spitzenzeiten`/`stoßzeiten` UND `UTC` eingesammelt (DOM-Reihenfolge) — eine zweite Notiz für einen weiteren Anbieter darf nicht still verloren gehen. Jede Notiz muss über die konservative Heuristik (Modellname vor dem ersten `:` oder gemeinsamer Modell-Präfix) mindestens ein Peak-Modell treffen. Aus jeder Notiz werden **Fenster** (`parsePeakRanges`), **Wochentags-Scope** (`parseWeekdayScope`: de `montags bis freitags`/`mo-fr`/`werktags`/`wochentags`, en `monday to friday`/`mon-fri`/`weekdays`; `täglich`/`daily` → alle 7) und **Wochenend-Auszug** (`parseWeekendScope`: `wochenende(n)`, `samstag und sonntag`, `sa-so`; en `weekend(s)`, `saturday and sunday`, `sat-sun`) gelesen. `offPeak.days` = Komplement von `peak.days`; eine explizit genannte Wochenend-Angabe, die dem widerspricht → `ScrapeError`. **Fehlender Wochentags-Scope**, ein nicht zu {1..7} auflösbarer Bereich, eine **Feiertags-Aussage ohne bestimmbares Land** (`parseHolidays`: nur „chinesische …"/„chinese …" ist bestimmbar) oder ein unparsebares Fenster → `ScrapeError`. `timezone` kommt aus `PEAK_TIMEZONE_BY_FAMILY` (DeepSeek → `Asia/Shanghai`); eine unbekannte Peak-Familie → rot (keine geratene Zone). `effectiveFrom` (`parseEffectiveFrom`) nur, wenn die Notiz ein effektives Datum nennt. **Jedes** Peak-Modell braucht eine Regel, sonst rot (lieber CI rot als „immer Off-Peak" ohne Countdown).
- **Keine Feiertagsdaten (strikt quellenbindend):** `parseHolidays` bleibt als Parser erhalten und befolgt Spec §3 (Feiertage nur, wenn die Quelle sie nennt; Aussage ohne bestimmbares Land → rot). Die OpenCode-Doku nennt an der Peak-Notiz **keine** Feiertage (live verifiziert, de **und** en) → `peakRules[].holidays` und `holidayCalendars` bleiben in `data/latest.json` **leer/fehlend**. Es gibt **keinen** Override (früherer `PEAK_HOLIDAY_OVERRIDES`/`chinese-days` wurde am 2026-09-30 wieder entfernt): die Angabe „excluding Chinese public holidays" steht nur in der DeepSeek-Originaldoku, also außerhalb der Tracker-Quelle.
- Diff gegen das vorherige `latest.json`: Modell hinzugefügt (mit Pricing-Zeile), Modell entfernt (mit `days` aus `firstSeen`), Nutzung verbessert/verschlechtert → `usage_changed`, Preisänderungen (Float-Toleranz 1e-9) → `price_changed` mit `fields` (geänderte Preisfelder), Preis- UND Nutzungsänderung → zwei Events (`splitChange`), Fähigkeitsänderungen → `capabilities_changed` (undefiniert und `null` gelten als gleich), Datenschutzänderungen → `privacy_changed` (**nicht** bei Erst-Befüllung `undefined`/`null` → Wert; reine `validUntil`-Änderungen sind still — kein Event), Free-Model-Events.
- CHANGELOG.json: neuer `{ id, date, changes }`-Eintrag oben, `id` = git-tag-sicherer Run-Zeitstempel (`YYYY-MM-DDTHH-MM-SSZ`, UTC), `date` = `YYYY-MM-DD` nur für Anzeige/Groupierung. **Jeder Run** mit Änderungen erzeugt einen eigenen Eintrag (kein Day-Merge); ein Eintrag mit gleichem `id` wird ersetzt (idempotent bei CI-Wiederholungen). **Leere** Einträge (`changes: []`) werden entfernt, bei `changes.length === 0` wird kein Eintrag angelegt (auch kein Basis-Snapshot beim ersten Lauf). Vorschema-Einträge ohne `id` werden beim Laden via `normalizeChangelogIds` mit `id = date` migriert (passende bestehende Releases waren nach Datum getaggt). `validateChangelog` (zod) bricht bei leeren Einträgen/unbekannten Typen rot ab. **Minified schreiben** (`JSON.stringify(changelog)` — eine Zeile), niemals hübsch formatiert, damit Changelog-Diffs nur die tatsächlichen Änderungen zeigen.
- `model_removed.days` = `heute − firstSeen`, `firstSeen` = frühester Snapshot in `data/history.json`, der das Modell enthält.
- `data/latest.json`/`data/history.json` werden **nur bei Datenänderungen** geschrieben (`changes.length > 0`, `privacyPopulated` — stille Erst-Befüllung des `privacy`-Felds, `privacySilentUpdate` — reine `validUntil`-Änderung, `plansChanged` — geänderte `plans`-Liste (Preise/Guthaben/Reihenfolge, ersetzt den früheren `monthlyPricingChanged`), `peakRulesChanged` — geänderte `peakRules` (inkl. der einmaligen Migration `peakHours` → `peakRules` am 2026-09-30; **kein** Changelog-Event/Release, da sich die Quelle nicht geändert hat), oder stille Anreicherungs-Updates `modelIdsPopulated`/`contextWindowPopulated`/`providerPopulated`/`fullIdsPopulated`; alle ohne Changelog-Events); sonst bleibt der Stand vom letzten Änderungstag erhalten (kein Commit, aber Deploy läuft weiter).
- **Build-Stempel:** `fetchedAt` (der „Stand“ im Footer) wird beim `vite build` in `vite.config.ts` (Plugin `stamp-build-time`) auf die **Build-Zeit** gesetzt — auch ohne Datenänderung, weil der Lauf den Stand ja verifiziert hat. Das passiert **nur im Build-Output** (gebundeltes JS + `dist/data/latest.json`), `data/latest.json` bleibt unverändert → alleinige `fetchedAt`-Änderungen erzeugen **keinen Commit**. In `data/latest.json` steht weiterhin die letzte Scrape-/Änderungszeit.
- **Parsing-Fehler** (keine Preistabelle, unerwartete Spaltenstruktur, unparsebare Werte) → `process.exit(1)` → CI-Lauf wird rot.

## UI-Regeln (daisyUI 5 / Tailwind 4)

- Nur daisyUI- und Tailwind-Klassen verwenden; Default-Varianten bevorzugen; daisyUI-Semantic-Colors (`base-*`, `primary`, `badge-success/-error/-warning/-info`), kein `dark:`-Präfix.
- Kein `tailwind.config.js` — Tailwind 4 braucht nur `@import "tailwindcss";` + `@plugin "daisyui";` in `src/index.css`.
- Sprache: **Englisch ist Default** unter `/`, Deutsch als echte Subroute `/de/` (jeweils eigenes vorgerendertes HTML). Der Pfad ist die Quelle der Wahrheit; `?lang=de|en` bleibt als Alias erhalten (alte Links), wird nach der Hydration angewandt und die URL anschließend per `replaceState` auf die kanonische Pfadform gebracht. Beim Laden von `/` (kein `?lang=`) gilt nach der Hydration: gespeicherte localStorage-Wahl (`lang`), sonst Browser-Sprache (`navigator.language` beginnt mit `de` → `/de/`) — nicht umgekehrt, `/de/` wird nie überschrieben. **Query-Params bleiben beim Sprachwechsel erhalten** (nur `lang` wird in die Pfadform überführt). Crawler (ohne `navigator`) sehen auf `/` immer Englisch; ein Auto-Redirect passiert nur clientseitig. Theme per Inline-Script vor dem Paint (`data-theme` + `window.__OCGO_THEME_DARK__`), `basis` in localStorage.
- **Query-Params** (shareable URLs): `sort=field:asc|desc`, `fsort=…` (Free-Tabelle), `psort=model:tier:asc|desc` (Datenschutz-Tabelle, Default `tier:asc` = schlechteste Stufe oben), `basis=list|full|paid`, `lang=de|en`, `cap=image,video,audio,pdf` (Fähigkeiten-Filter Preistabelle, OR-Semantik), `fcap=…` (Fähigkeiten-Filter Free-Tabelle, unabhängig von `cap`) — beim Laden URL > localStorage, Änderungen via `history.replaceState`.
- Preisbasis-Umschalter (drei Optionen): `list` = Listenpreis, `full` = volles Monatsguthaben (`× {creditNum}/Nutzung`), `paid` = „Was du zahlst“ (`× {costNum}/Nutzung`) — **beide Effektivbasen sind plan-abhängig** und rechnen über den **aktiven Plan** (`plan.creditsMonthly` / `plan.priceMonthly` aus `data/latest.json`, per `usageOf(m, plan)`); die früheren Top-Level-Felder `monthlyCredit`/`monthlyCost` existieren nicht mehr. Die Beschriftungen (`basisFull`/`basisPaid`) sowie die Hero-Statistiken (`statsCreditValue`/`plan`), `subtitle`/`intro` und `metricNote` (Footer) werden via `fmtPricing` aus dem aktiven Plan gerendert (Platzhalter `{credit}`/`{cost}` mit `$`, `{creditNum}`/`{costNum}` nackte Zahlen). Der Hinweis neben dem Umschalter listet die Nutzungs-Mappings aus den `usage`-Werten **des aktiven Plans** (Go: `$15 → 4-facher Preis, $60 → Listenpreis`; Go Plus: `$120 → 2-facher Preis, $240 → Listenpreis`; bei `paid` als Wertfaktor `$15 → 1,5×` bzw. `$120 → 3×`). Die Nutzungs-Badges zeigen `$Nutzung · Faktor×` (Faktor = Nutzung ÷ `plan.priceMonthly`, z. B. Go `$15 · 1,5×`, Go Plus `$120 · 3×`); der Tooltip nennt zusätzlich den Prozent-Anteil am Monatsguthaben.
- Seitenstruktur: Kurzerklärung → Preistabelle (Sortierung je Spalte, horizontales Scrollen per Drag-to-Scroll `setupDragScroll` auf dem `overflow-x-auto`-Container, Fähigkeiten-Badges-Spalte, Fähigkeiten-Filter-Toggles) → Free-Models-Tabelle (neuestes oben, eigene unabhängige Fähigkeiten-Filter-Toggles) → Datenschutz-Tabelle (`PrivacyTable`: Sortierung Modell/Stufe, Default `tier:asc` = schlechteste Stufe oben; Badges `badge-error` Modelltraining / `badge-warning` Aufbewahrung > 0 Tage und „Kein ZDR“ (Daten aufbewahrt, Dauer unbekannt) / `badge-success` ZDR / `badge-ghost` keine Angabe; „≈“ = Familien-Fallback; „Gültig bis“-Spalte = `validUntil` oder „bis auf weiteres“) → Changelog (JSON-Events, i18n-Texte, Badges) → Impressum/Datenschutz.
- **Peak-Anzeige ist datengetrieben:** `PeakIndicator`/`PriceTable` bekommen `peakRules` + optional `holidayCalendars` (statt `peakHours`) und rufen `src/config/peakPricing.ts` auf. Tooltip/Countdown/`nextTransition` berücksichtigen Feiertage (optional, bei uns inert) und `effectiveFrom`; der Wochentags-Scope wird aus `peak.days` **generiert** (`formatDayScope`/`formatDayList`), nicht hartkodiert. Es gibt **keine** `weekendOffPeakDaysBeijing`/`isBeijingWeekend`/`effectiveFromMs`-Konstanten mehr. Share-Cards (`src/share.ts`, Solid-frei) leiten den Scope ebenfalls aus den Daten ab.
- Quellen-Links (Go, Zen, models.dev), RSS-Link (`releases.atom`) und der „Verfügbar seit“-Hinweis stehen ausschließlich im Footer (kein Quellen-Link im Free-Models-Header). Changelog-Badges sind richtungsabhängig: `badge-error` ↑/− = teurer/weniger, `badge-success` ↓/+ = billiger/mehr, neutral ≈ = `badge-ghost`.
- **Changelog-Anzeigereihenfolge = Erstellungsreihenfolge** aus `buildChanges` (`plan_added` → `model_added` → `model_removed` → `price_changed`/`usage_changed` → `capabilities_changed` → `privacy_changed` → `free_*`). Es gibt **keine** Umkehrung im Renderer — sie war mal drin, machte aber `plan_added` ans Ende jedes Eintrags und wich von `release-notes.mjs` (dort gilt die Erstellungsreihenfolge) ab. Wer die Reihenfolge ändern will, ändert sie in `buildChanges` — nicht im UI.
- **Der Sticky-Header darf Inhalt überlagern — das ist gewollt.** In den Element-Aufnahmen (`*-changelog.png`, `*-secN.png`) klebt er mittig über dem Text, weil der Screenshot zum Element scrollt und der Header `position: sticky` ist. Das ist **kein** Befund des Screenshot-Reviews und rechtfertigt keinen Anker-Test; es zählt nur, wenn es im Full-Page-PNG sichtbar bleibt.

## CI/CD (`.github/workflows/price-tracker.yml`)

- Trigger: `workflow_dispatch` (extern per Server-Cron getriggert via `scripts/install-cron.sh`: Mo–Fr alle 2h 06:00–20:00 MEZ/MESZ, Sa/So 06:00+14:00) + täglicher GitHub-Actions-Safety-Net-Lauf (`schedule: "28 20 * * *"` = 20:28 UTC), `push` auf `main`.
- Pipeline: install (`--frozen-lockfile`) → `pnpm test` → `pnpm scrape` → `pnpm build` → `pnpm smoke`
  (bricht rot ab, bevor kaputte Bundles auf Pages landen) → Commit (CHANGELOG.json + data + src/data, `github-actions[bot]`, nur bei Änderungen) → Release (`node scripts/ensure-release.mjs --all` → `gh release create`/`edit` mit Tag = Eintrags-`id`, damit Watcher per E-Mail und RSS-Reader via `releases.atom` benachrichtigt werden) → Sync-Check (`node scripts/check-release-sync.mjs` bricht rot ab, wenn Changelog-Einträge und GitHub-Releases divergieren) → `upload-pages-artifact` (dist) + `upload-artifact` (dist-Zip) → `deploy-pages`.
- `scripts/release-notes.mjs` rendert Changelog-Einträge als **rein englisches Markdown mit nur den Fakten** (Titel + Event-Liste — keine Links zu Site/RSS, kein Watch-Hinweis). `scripts/ensure-release.mjs` stellt **pro Changelog-Eintrag genau eine Release** sicher (Tag = Eintrags-`id`) und läuft bei **jedem** Workflow-Lauf (nicht nur bei `changed=true`): `--all` prüft alle Einträge, erstellt fehlende Releases nach (Backfill, `--latest=false` für alle außer dem neuesten Eintrag) und editiert bestehende nur bei geänderten Notizen. Da jeder Run einen eigenen Eintrag bekommt, entsteht pro 2h-Lauf ggf. eine eigene Release — Watcher erhalten entsprechend mehrere E-Mails/RSS-Einträge pro Tag. **Manuelle Korrekturen an Release-Inhalten erfolgen direkt via `gh` CLI** (`gh release edit <tag> --notes …`), nie über das Script. **Ausnahme:** eine bewusste **Renderer-/Formatmigration**, die das Notiz-Rendering aller Einträge ändert (z. B. die Legacy-Migration vom 2026-09-28, die ~40 Releases von `@ $15` auf `@ Go $15` umstellte), läuft über `node scripts/ensure-release.mjs --all` — dafür ist das Script gebaut. Danach **immer** `node scripts/check-release-sync.mjs` als Kontrolle, und die betroffenen Releases vorher/nachher diffen, damit der Rewrite nachvollziehbar bleibt. Sync: `scripts/check-release-sync.mjs` vergleicht jeden Changelog-Eintrag mit seiner Release (Tag = `id`, Notizen) und meldet verwaiste Releases — bei Divergenz rot.
- Nach einem Daten-Commit (`changed=true`) benachrichtigt der Deploy-Job das Vergleichs-Projekt `all-the-rest/ai-10-usd` per `repository_dispatch` (`event_type=source-updated`, POST auf `/repos/all-the-rest/ai-10-usd/dispatches`). Secret: `AI10USD_DISPATCH_TOKEN` (PAT mit `repo`-Scope bzw. fine-grained mit Contents read/write auf `ai-10-usd`, in **beiden** Tracker-Repos). Fehlt das Secret → Step übersprungen (grün); vorhanden → der Step prüft den HTTP-Status und bricht bei ≠ 2xx **rot** ab (kein stiller Verlust wie beim alten `curl -sS` ohne `-f`).
- **Lokale Daten-Commits (Push statt CI-Commit):** Wird eine Datenänderung lokal committet und per Push auf `main` gebracht — statt vom CI-Job (der `changed=true` erzeugt und committet) —, feuert der automatische Dispatch **nicht**: Der Scrape im CI findet dann keine Diffs (`changed=false`), der Notify-Step wird übersprungen. Das Vergleichs-Projekt dann manuell triggern:
  ```bash
  gh api -X POST repos/all-the-rest/ai-10-usd/dispatches --input - <<'EOF'
  {"event_type":"source-updated","client_payload":{"source":"all-the-rest/ocgo-price-tracker","sha":"<SHA>"}}
  EOF
  ```
  `<SHA>` = committeter Datenstand (z. B. `git rev-parse HEAD`). Verifikation: `gh run list -R all-the-rest/ai-10-usd` → neuer `repository_dispatch`-Lauf (`source-updated`) wird grün.
- **Datenvertrag mit `ai-10-usd`:** Der Consumer normalisiert über `scripts/normalize.mjs` (`normalizeOpenCodeData`) und akzeptiert **beide** Formate — Legacy (`monthlyCredit`/`monthlyCost`, `usage` als Skalar, `multiplier`/`effective*`) und das Plan-Format (`plans[]`, `usage`-Map). Grund: zwischen dem Deploy dieses Repos und dem Umbau des Consumers ist die Live-JSON noch in der alten Form; ein Format-Bruch würde die $10-Seite mitnehmen. `ai-10-usd` wählt aus `plans` den **günstigsten** Plan (kleinstes `priceMonthly`, Gleichstand → zuerst gelistet), also „Go" ($10), **nicht** „Go Plus" ($40) — es ist eine $10-Seite. Bei einem Schema-Bruch hier zuerst `normalize.mjs` im Schwestern-Repo nachziehen, dann hier.
- Ein fehlgeschlagenes `pnpm scrape` bricht die Pipeline ab (kein Commit/Deploy, Lauf rot).

## SEO / Prerender & Sprachen

- **Statisches Pre-Rendering:** `pnpm build` = `tsc --noEmit && node scripts/prerender.mjs`. Das Skript baut zuerst den Client (Vite-Config), dann die App als SSR-Bundle (`.ssr-build/`, `src/ssr-entry.tsx`, Solid `renderToString`) und ersetzt den leeren `<div id="root">` in `dist/index.html` durch das vorgerenderte Markup. Crawler/AI-Bots ohne JS sehen damit alle Preise.
- **Hydration:** `src/index.tsx` ruft `hydrate()` (Fallback `render` ohne Prerender). Der Client-Build nutzt `solid({ ssr: true })` → `generate: "dom", hydratable: true`. `generateHydrationScript()` (aus dem SSR-Bundle via `src/ssr-entry.tsx` re-exportiert) wird pro HTML-Datei in den `<head>` injiziert — ohne `window._$HY` scheitert `hydrate()`.
- **Sprach-Subrouten:** `dist/index.html` (en) und `dist/de/index.html` (de). SSR rendert beide Sprachen (`renderApp(lang)`), `base: "/"` (absolute Assets, sonst brechen Pfade unter `/de/`). Client-Erstrender = Pfad-Sprache, gespeicherte Sprache/`?lang=…`/Sortierung/Filter erst nach der Hydration. `?lang=de|en` bleibt Alias; URL wird auf die Pfadform normalisiert. hreflang en/de/x-default, Canonical je Datei, `<html lang>` je Datei.
- **Build-Stempel:** `__BUILD_TIME_ISO__` per Vite-`define`, einmalig über `process.env.BUILD_STAMP` aus `scripts/prerender.mjs` gesetzt — Client und SSR zeigen denselben Footer-„Stand“ (hydration-stabil). `src/buildInfo.ts` liest den Wert.
- **Head-SEO (build-generiert in `prerender.mjs`):** Title/Description/Canonical/`og:locale` je Sprache, `hreflang`, RSS-Autodiscovery (`releases.atom`), JSON-LD (`WebSite` + `ItemList` aller Modelle). Zusätzlich `dist/robots.txt` und `dist/sitemap.xml` (beide Sprachen).
- **Tests:** `tests/seo.test.mjs` prüft `dist/` (skip ohne Build); `scripts/smoke.mjs` prüft nach dem Build `/`, `/de/`, `robots.txt`, `sitemap.xml`, `<h1>`, JSON-LD und vorgerendertes Markup in `#root`. `pnpm test` läuft in CI vor dem Build → die CI-Absicherung übernimmt der Smoke-Test.

## Tests

- `pnpm test` = Scraper-Unit-Tests (`tests/scrape.test.mjs`), E2E-Sortier-Test (`tests/sorting.test.mjs`,
  echte `PriceTable` per SolidJS-SSR), Peak-Auswertungs-Test (`tests/peak.test.mjs`: `isPeakAt`/`nextTransition`
  + Footer-Zeile per SolidJS-SSR, eigener Build in `tests/.ssr-peak/`, gitignored) und Share-Vertrags-Test
  (`tests/share.test.mjs`: `share.ts` ↔ `weighted.ts` laufen durch denselben Vite-SSR-Build — ein fehlender
  Export bricht den Build und damit den Test rot ab, statt erst im Browser aufzufallen).
- **Keine Zahlen-Pins auf generierte Daten** (gilt für alle Tests, auch die Schwestern-Repos): eine feste Zahl gegen `data/latest.json` oder einen anderen generierten Datensatz ist per Definition flüchtig — der Katalog wächst und schrumpft an der Quelle, und die CI wurde am 2026-10-02 genau daran rot (10 → 11 Free-Modelle, bevor der Scrape überhaupt laufen konnte). Stattdessen Struktur-Invarianten: nicht leer, Pflichtfelder vorhanden, Fremdschlüssel stimmen, Schema-Parse läuft durch. Zahlen gegen **Fixtures** (`tests/fixtures/*.html`) und Changelog-EVENT-Logik (der Test baut die Eingabe selbst und zählt Ereignisse) sind davon **nicht** betroffen und bleiben. Die Abdeckung gegen leere Kataloge gehört ins Scrape-Skript (`assertNonEmptyCatalog`), nicht in den Test.
- Scraper-Tests decken die Peak-Regeln ab: Wochentags-Scope de+en, Wochenend-Auszug, Feiertags-Auszug
  (`parseHolidays` als Parser-Beweis), `ScrapeError` bei fehlendem Scope / Feiertag ohne Land /
  widersprüchlicher Wochenend-Angabe / widersprüchlichen Regeln, alle zod-Invarianten aus §1 als
  Negativtests — inklusive des **Fehlens** der Feiertagsdaten (Quelle nennt keine).
- Der Sortier-Test baut die echte `PriceTable`-Komponente per SolidJS-SSR (`tests/ssr-entry.tsx`, Vite-Build in `tests/.ssr/`, gitignored) und prüft für jede Preisbasis (`list`/`full`/`paid`) × Preisspalte (`input`/`output`/`cachedRead`/`cachedWrite`/`cost`) × Richtung, dass die gerenderte Reihenfolge exakt der Reihenfolge der **angezeigten** Werte (`fieldPrice`/`requestCost`) entspricht — nicht dem rohen Listenpreis. Regression: bei `paid` sortiert der Effektivpreis (DeepSeek V4 Flash vor MiMo V2.5), obwohl beide denselben rohen Input-Preis (0.14) haben.
- **Screenshot-Tests sind permanent:** neue UI-Features (insb. Share-Cards) bekommen Playwright-Tests in
  `tests/screenshots/` (Suite `playwright.screenshots.config.ts`, `pnpm test:screenshots`) — alle Size-Varianten
  + Mobile + beide Sprachen (de/en). Keine Einmal-Screenshots: die Tests bleiben im Repo und müssen bei jeder
  Umsetzung grün laufen.

## Verifikation

Der Build-/Verify-/Commit-/Push-Flow — Rollentrennung, `nach-verify`-Flag, Commit-Footer,
Amend, CI-Beobachtung — steht im Skill `build-verify` (`agents-skills`; Always-on-Kernel
`.agents/rules/build-verify.md`) und wird hier **nicht wiederholt**. Der unabhängige
Verifikator prüft in diesem Repo:

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
Downscale-Regionen) an den `vision-creative`-Subagenten eskalieren statt zu raten.
Findings-Report mit `Severity | File:Line | Screenshot | Finding | Suggested fix`;
`critical`/`high` blockieren die Freigabe. Zusätzlich `pnpm test:contrast` — die
automatisierte WCAG-AA-Matrix über alle daisyUI-Badge-/Alert-Kombinationen in
hell **und** dunkel; Failures sind blockierend wie `critical`/`high`. Nach einem Fix
nur die betroffenen Routen neu schießen (`--grep`) und alt vs. neu vergleichen.

**Manuelle Abnahme vor Push:** Bei größeren UI-Änderungen `pnpm build` + `pnpm preview`
starten (produktionsnahes Prerender, beide Sprachen, `?plan=`/`?basis=`/`?lang=`/`?theme=`
funktionieren) und **vor** Commit/Push abnehmen lassen. Kein Push ohne Abnahme.

## Delegation & Parallelisierung (Subagenten)

Rollen, Delegation und Verify-Läufe regelt der Skill `build-verify` (`agents-skills`; Always-on-Kernel
`.agents/rules/build-verify.md`): Orchestrator delegiert, Implementierung und Verifikation laufen in
**getrennten** Subagenten, jeder Subagent bekommt eine in sich geschlossene Aufgabenbeschreibung,
kleine Edits macht der Orchestrator direkt. Details stehen dort, nicht hier.

- **Entscheidungen werden IMMER als interaktive Frage gestellt** (Tool `question`), nie als Frage im Fließtext:
  echte Wahlmöglichkeiten (Alternative ja/nein, Datenmodell, Event-Form, Abbruch-vs-weiter) mit einer Empfehlung
  als erster Option, Varianten in einem Satz begründet. Begründung: eine Entscheidung, die im Chat-Text „irgendwo"
  steht, wird beim nächsten Turn übersehen; eine Frage mit Optionen nicht.
- **Jede so getroffene Entscheidung wird in `AGENTS.md` UND `AGENTS.todo.md` eingetragen.** `AGENTS.md` ist die
  dauerhafte Quelle der Wahrheit (Datenmodell, Event-Regeln, Scrap- und UI-Verhalten). `AGENTS.todo.md` führt
  zusätzlich die Kurzfassung mit Begründung als Checkliste (`[x]` umgesetzt / `[ ]` offen) plus einen Abschnitt
  „Verworfen" für zurückgezogene Ansätze — damit sie nicht erneut implementiert werden. Nie nur im Chat.
  Diese Regel steht auch global in `~/.config/opencode/AGENTS.md`.

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
