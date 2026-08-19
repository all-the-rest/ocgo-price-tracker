# AGENTS.md

## Projektüberblick

Preis-Tracking für OpenCode Go. Ein täglicher GitHub-Actions-Lauf scrapet
`https://opencode.ai/docs/de/go/`, berechnet die Preise auf Basis des vollen
Monatsguthabens (Effektivpreis = Listpreis × Guthaben/Nutzung) und stellt eine
statische SolidJS-Seite unter `https://ocgo-pricing.all-the.rest` bereit.
Temporäre Nutzungs-Boni (`<span data-bonus>2x usage</span>`) kommen von der
Go-Landingpage `https://opencode.ai/de/go` und verdoppeln das Nutzungslimit.
Monatsguthaben und Monatspreis werden **dynamisch** gefetcht (Landingpage
`[data-slot="cta-price-old"]` → `$10/Monat`, Doku-Seite „das Sechsfache dieses
Betrags“ → Faktor 6; Guthaben = Preis × Faktor = $60), Fallback auf 60/10.

- Repo (remote): `reisi007/ocgo-price-tracker`
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
pnpm preview          # dist/ lokal serven
pnpm typecheck        # nur tsc --noEmit
```

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
  "monthlyCredit": 60,
  "monthlyCost": 10,
  "freeModels": [{ "id": "big-pickle", "availableFrom": "2026-08-05", "privacy": { "training": true, "retentionDays": null, "validUntil": null } }],
  "models": [
    {
      "name": "Grok 4.5",
      "tier": null,
      "input": 2.0,
      "output": 6.0,
      "cachedRead": 0.3,
      "cachedWrite": null,
      "usage": 15,
      "multiplier": 4,
      "effectiveInput": 8.0,
      "effectiveOutput": 24.0,
      "effectiveCachedRead": 1.2,
      "effectiveCachedWrite": null,
      "pattern": { "input": 1100, "cachedRead": 71500, "output": 220 },
      "capabilities": { "input": ["text", "image"], "output": ["text"], "reasoning": true, "toolCall": true },
      "privacy": { "training": false, "retentionDays": 30, "validUntil": null }
    }
  ]
}
```

- `multiplier = monthlyCredit / usage`; `usage` = Basis-Nutzung aus der Preistabelle (`$15`/`$60`) **× Bonus-Faktor** (z. B. `2x usage` → `usage` = `30`/`120`). Ein Bonus-Anstieg senkt `multiplier` und damit die Effektivpreise.
- `monthlyCost` = laufender Abo-Preis (dynamisch, aktuell 10); die UI berechnet daraus die zusätzliche Preisbasis „Was du zahlst“ (`Effektivpreis = Listpreis × monthlyCost/Nutzung`).
- `monthlyCredit` = Monatsguthaben = `monthlyCost × Faktor` (dynamisch, aktuell 60 = 10 × 6); Quelle: Landingpage-Preis (`[data-slot="cta-price-old"]`) × Doku-Faktor („das Sechsfache dieses Betrags“). Fallback-Konstanten 60/10 bei fehlender Extraktion (Warnung, kein Abbruch).
- `effective* = preis × multiplier`
- `pattern` = dokumentiertes Anfragemuster (Input/Cached/Output Tokens pro Anfrage) — **Pflicht** (zod). Kosten pro Anfrage = Muster × Modellpreis (Input: 5% Input-Preis + 95% Cached-Write-Preis, Cached: Cached Read, Output: Output). Fehlendes Muster bricht den Lauf rot ab.
- `capabilities` = Fähigkeiten aus models.dev (via `@opencode-ai/models`): `input`/`output`-Modalitäten (`text`, `audio`, `image`, `video`, `pdf`), `reasoning`, `toolCall`. `null` = kein models.dev-Eintrag. **Nur Fähigkeiten — die Preise bleiben aus dem Go-Scrape (models.dev-Preise weichen ab und werden ignoriert).**
- `privacy` = Datenschutz-Info aus der Doku-Tabelle (`Modelltraining`/`Datenaufbewahrung`): `training` (bool, `true` = Daten fürs Modelltraining), `retentionDays` (**`true`** = ZDR/0 Tage, **`false`** = kein ZDR (Daten werden aufbewahrt, Dauer unbekannt), **`number`** = N Tage Aufbewahrung, **fehlend/`undefined`** = unbekannt/"–"), `validUntil` (ISO-Datum = Ablauf der ZDR-Vereinbarung, z. B. monatliche Verlängerung DeepSeek V4 Flash), `fallback` (optional `true` = nicht in der Doku gelistet, Angabe aus derselben Modellfamilie via `PRIVACY_FALLBACKS`). `null` = keine Angabe (weder eigene Zeile noch Familien-Fallback). **Kostenlose Zen-Modelle (inkl. big-pickle) sind hartkodiert `training: true`** (`enrichFreeModels`); die Zen-Doku nennt nur den generischen Feedback-Text, `retentionDays` bleibt unbekannt (Feld fehlt).
- `capabilitiesSourceUrl` = `https://models.dev` (Fähigkeiten-Quelle).
- `cachedWrite: null` (= `-` in der Doku) bedeutet: Cached-Write-Preis = **Input-Preis** (1:1, keine Schätzung). In `requestCost` fließt er als Cached-Write-Preis in die 5/95-Heuristik ein; in der Tabelle steht weiterhin `-` (Heuristik nur im Footer dokumentiert). Die 5/95-Gewichtung (5% Input-Preis + 95% Cached-Write-Preis für Input-Tokens) basiert auf beobachteter Nutzung (Luna ~28/72, Qwen3.8 Max ~0/100 Input/Cached-Write).
- `freeModels` = kostenlose Zen-Modelle (ID enthält `free`) + `big-pickle` aus `https://opencode.ai/zen/v1/models`; `availableFrom` = erstes Beobachtungsdatum (bleibt über Läufe erhalten).
- `data/history.json` = `{ "snapshots": [ … ] }` (Chronologie, append, nur bei Änderungen)
- `CHANGELOG.json` = `{ "entries": [{ "date", "changes": [ … ] }] }`; wird bewusst **minified** (`JSON.stringify`, eine Zeile) geschrieben — nie hübsch formatiert, damit Git-Diffs minimal bleiben. Events (zod via `validateChangelog`):
  - `text` (mit `lang` = `{ de, en }`-Übersetzungen, z. B. `{ de: "Initialversion", en: "Initial version" }`; keine freien Texte)
  - `model_added` (mit `pricing` = `{ input, output, cachedRead, cachedWrite, usage }`, die Go-Tabellen-Zeile)
  - `model_removed` (mit `days` = verfügbare Tage, `firstSeen` aus `history.json`-Chronologie)
  - `price_changed` (mit `from`/`to` = komplette Pricing-Zeile und `fields` = geänderte Preisfelder `["input","output","cachedRead","cachedWrite"]`; die UI stellt die Felder in **beiden** Zeilen fett dar)
  - `usage_changed` (mit `from`/`to` = Nutzungswert; getrenntes Event, damit Nutzungs- und Preisänderungen unterscheidbar sind)
  - `capabilities_changed` (mit `from`/`to` = capabilities-Objekt oder `null`; löst auch bei Nur-Fähigkeiten-Änderungen einen Daten-Commit aus)
  - `privacy_changed` (mit `from`/`to` = privacy-Objekt oder `null`; löst bei Änderung von `training`/`retentionDays`/`fallback` aus — **nicht** bei Erst-Befüllung `undefined`/`null` → Wert und **nicht** bei reiner `validUntil`-Änderung: ZDR-Verlängerung/-Datum wird still in die Daten übernommen, ohne Changelog-Event)
  - `free_added`/`free_removed` (mit `availableFrom`/`until`)
  - Preis- UND Nutzungsänderung am selben Tag → **zwei Events** (`price_changed` + `usage_changed`). **Keine** `baseline`/`pricing_changed`-Events. Einträge haben IMMER `changes.length > 0`; ohne Änderungen wird kein Eintrag angelegt und ein bestehender Eintrag desselben Datums bleibt erhalten, leere Einträge werden entfernt. Bei **zwei Läufen pro Tag** werden Events desselben Datums **gemerged** (`mergeChanges`, Dedupe nach `type`+`model`, neuestes gewinnt) — der Morgen-Eintrag wird nicht überschrieben (`upsertChangelogJson`).

## Scraper-Regeln (`scripts/scrape.mjs`)

- Preistabelle über die **Header-Zeile** identifizieren (Zellen enthalten `Input` UND `Output`) — NICHT über `nth-child`-Selektoren.
- Preise: `$1.40` → `1.4`; `-` → `null`.
- `Nutzung` ist `$15` oder `$60`; Modellname mit `(… tokens)`-Suffix → `tier`-Feld.
- **Nutzungs-Boni** von der Go-Landingpage `https://opencode.ai/de/go` (`fetchUsageBonuses`): `<span data-bonus>2x usage</span>` im `[data-item]`-Element verdoppelt das Nutzungslimit (`applyUsageBonuses`, Faktor aus `(\d+)x`). Zuordnung über `data-model`-Slug ↔ `normalizeName` (Luna hat zwei Tier-Zeilen — beide bekommen den Bonus). `usage` wird multipliziert, `multiplier`/`effective*` werden neu berechnet. HTTP-Fehler auf der Bonus-Seite → `process.exit(1)`; fehlende Bonus-Elemente → keine Boni.
- **Monatsguthaben/-preis dynamisch** (`parseMonthlyPricing`/`parseMonthlyCost`/`parseCreditFactor`): Monatspreis aus der Landingpage (`[data-slot="cta-price-old"]` → `$10/Monat`; existiert das Element, ist der Wert aber unparsebar → rot), sonst Prosa `$N/Monat` (Doku-Seite). Guthaben-Faktor aus der Doku-Prosa „das Sechsfache dieses Betrags“ (= 6; auch `das 6-fache`/`das 6×`; unbekannter Faktor bei vorhandenem Satz → rot). Guthaben = Monatspreis × Faktor (`$10 × 6 = $60`). Fehlt eine der beiden Quellen → Fallback-Konstanten 60/10 mit Warnung (kein Rot-Abbruch, Layout-Wechsel bricht die Pipeline nicht). `monthlyCredit`/`monthlyCost` werden danach in die Effektivpreise (`recomputeUsageDerived`) gerechnet.
- **Anfragemuster** (`Name — N Input-, M Cached-, K Output-Tokens pro Anfrage`) pro Modell extrahieren; Kurzschreibweisen (`GLM-5.2/5.1`, `Kimi K2.7/K2.6`) gegen die Modellnamen auflösen. Fehlende Muster über `PATTERN_FALLBACKS` (z. B. MiniMax M2.5 → M2.7) auffüllen.
- **zod-Validierung** (`validateSnapshot`): jedes Modell MUSS `pattern` haben; ungültige Daten → `process.exit(1)` → CI rot.
- Zen-Free-Models via `https://opencode.ai/zen/v1/models` (`extractFreeModels`), `availableFrom` aus dem vorherigen Lauf übernehmen (`mergeFreeModels`).
- Diff gegen das vorherige `latest.json`: Modell hinzugefügt (mit Pricing-Zeile), Modell entfernt (mit `days` aus `firstSeen`), Nutzung verbessert/verschlechtert → `usage_changed`, Preisänderungen (Float-Toleranz 1e-9) → `price_changed` mit `fields` (geänderte Preisfelder), Preis- UND Nutzungsänderung → zwei Events (`splitChange`), Fähigkeitsänderungen → `capabilities_changed` (undefiniert und `null` gelten als gleich), Free-Model-Events.
- **Fähigkeiten** aus models.dev via `@opencode-ai/models`: Live-API (`client.catalog()`, Timeout 10 s) mit Fallback auf den gebündelten Snapshot (`@opencode-ai/models/snapshot`, `source` = `live`/`snapshot`). Zuordnung über normalisierte Namen (`normalizeName`): zuerst `providers.opencode.models` (per ID/Name), dann kanonische `models`-Metadaten (bei Kollisionen exakter Normalized-ID-Treffer, sonst erste nach ID sortiert), Ausnahmen via `CAPABILITY_OVERRIDES`. Modelle ohne Treffer → `capabilities: null`. Die models.dev-Preise werden ignoriert.
- **Datenschutz** über die Header-Zeile identifizieren (`modelltraining` UND `datenaufbewahrung`, analog Preistabelle; fehlende Tabelle → rot): `Nicht verwendet` → `training: false`, `N Tage` → `retentionDays`, `0 Tage` → `true` (ZDR), `Kein ZDR` → `false` (keine ZDR-Vereinbarung — z. B. Muse Spark 1.2, Meta-Contributor-Tier), `–` → unbekannt (`retentionDays` fehlt im JSON). Notizen-Liste unter der Tabelle: `gilt bis (einschließlich) D. Month YYYY` → `validUntil` (deutsche Monatsnamen, `parseGermanDate`). Zuordnung über `normalizeName` (eine Zeile gilt für alle Tier-Varianten). Modelle ohne eigene Zeile übernehmen via `PRIVACY_FALLBACKS` (explizit, z. B. MiniMax M2.5 → M2.7) die Familien-Angabe und werden mit `fallback: true` markiert; ohne Fallback → `privacy: null`.
- Diff gegen das vorherige `latest.json`: Modell hinzugefügt (mit Pricing-Zeile), Modell entfernt (mit `days` aus `firstSeen`), Nutzung verbessert/verschlechtert → `usage_changed`, Preisänderungen (Float-Toleranz 1e-9) → `price_changed` mit `fields` (geänderte Preisfelder), Preis- UND Nutzungsänderung → zwei Events (`splitChange`), Fähigkeitsänderungen → `capabilities_changed` (undefiniert und `null` gelten als gleich), Datenschutzänderungen → `privacy_changed` (**nicht** bei Erst-Befüllung `undefined`/`null` → Wert; reine `validUntil`-Änderungen sind still — kein Event), Free-Model-Events.
- CHANGELOG.json: neuer `{ date, changes }`-Eintrag oben, Datum UTC (`YYYY-MM-DD`); bei zwei Läufen pro Tag werden Events desselben Datums via `mergeChanges` **gemerged** (Dedupe nach `type`+`model`, neuestes gewinnt, kein Überschreiben des Morgen-Eintrags); **leere** Einträge (`changes: []`) werden entfernt, bei `changes.length === 0` wird kein Eintrag angelegt und ein bereits vorhandener Eintrag desselben Datums bleibt erhalten (auch kein Basis-Snapshot beim ersten Lauf). `validateChangelog` (zod) bricht bei leeren Einträgen/unbekannten Typen rot ab. **Minified schreiben** (`JSON.stringify(changelog)` — eine Zeile), niemals hübsch formatiert, damit Changelog-Diffs nur die tatsächlichen Änderungen zeigen.
- `model_removed.days` = `heute − firstSeen`, `firstSeen` = frühester Snapshot in `data/history.json`, der das Modell enthält.
- `data/latest.json`/`data/history.json` werden **nur bei Datenänderungen** geschrieben (`changes.length > 0`, `privacyPopulated` — stille Erst-Befüllung des `privacy`-Felds, `privacySilentUpdate` — reine `validUntil`-Änderung, oder `monthlyPricingChanged` — geänderte dynamische Monatsguthaben/-preis-Werte; alle drei ohne Changelog-Events); sonst bleibt der Stand vom letzten Änderungstag erhalten (kein Commit, aber Deploy läuft weiter).
- **Build-Stempel:** `fetchedAt` (der „Stand“ im Footer) wird beim `vite build` in `vite.config.ts` (Plugin `stamp-build-time`) auf die **Build-Zeit** gesetzt — auch ohne Datenänderung, weil der Lauf den Stand ja verifiziert hat. Das passiert **nur im Build-Output** (gebundeltes JS + `dist/data/latest.json`), `data/latest.json` bleibt unverändert → alleinige `fetchedAt`-Änderungen erzeugen **keinen Commit**. In `data/latest.json` steht weiterhin die letzte Scrape-/Änderungszeit.
- **Parsing-Fehler** (keine Preistabelle, unerwartete Spaltenstruktur, unparsebare Werte) → `process.exit(1)` → CI-Lauf wird rot.

## UI-Regeln (daisyUI 5 / Tailwind 4)

- Nur daisyUI- und Tailwind-Klassen verwenden; Default-Varianten bevorzugen; daisyUI-Semantic-Colors (`base-*`, `primary`, `badge-success/-error/-warning/-info`), kein `dark:`-Präfix.
- Kein `tailwind.config.js` — Tailwind 4 braucht nur `@import "tailwindcss";` + `@plugin "daisyui";` in `src/index.css`.
- Sprache: localStorage `lang`, sonst Browser-Locale (automatisch `de` bei `navigator.language`-Präfix `de`); Default `en`. Theme via `theme-controller`-Checkbox (`value="dark"`), `basis` in localStorage.
- **Query-Params** (shareable URLs): `sort=field:asc|desc`, `fsort=…` (Free-Tabelle), `psort=model:tier:asc|desc` (Datenschutz-Tabelle, Default `tier:asc` = schlechteste Stufe oben), `basis=list|full|paid`, `lang=de|en`, `cap=image,video,audio,pdf` (Fähigkeiten-Filter Preistabelle, OR-Semantik), `fcap=…` (Fähigkeiten-Filter Free-Tabelle, unabhängig von `cap`) — beim Laden URL > localStorage, Änderungen via `history.replaceState`.
- Preisbasis-Umschalter (drei Optionen): `list` = Listenpreis, `full` = volles Monatsguthaben (`× {creditNum}/Nutzung`), `paid` = „Was du zahlst“ (`× {costNum}/Nutzung`, Monatspreis aus `monthlyCost`). Die Beschriftungen (`basisFull`/`basisPaid`) sowie die Hero-Statistiken (`statsCreditValue`/`plan`), `subtitle`/`intro` und `metricNote` (Footer) werden via `fmtPricing` aus `monthlyCredit`/`monthlyCost` gerendert (Platzhalter `{credit}`/`{cost}` mit `$`, `{creditNum}`/`{costNum}` nackte Zahlen). Der Hinweis neben dem Umschalter listet die Nutzungs-Mappings aus den aktuellen `usage`-Werten (z. B. `$15 → 4-facher Preis, $60 → Listenpreis, $120 → halber Preis`; bei `paid` als `$15 → 1,5×`-Wertfaktor). Die Nutzungs-Badges in der Preistabelle zeigen `$Nutzung · Faktor×` (Faktor = Nutzung ÷ `monthlyCost`, z. B. `$15 · 1,5×`); der Tooltip nennt zusätzlich den Prozent-Anteil am Monatsguthaben.
- Seitenstruktur: Kurzerklärung → Preistabelle (Sortierung je Spalte, horizontales Scrollen per Drag-to-Scroll `setupDragScroll` auf dem `overflow-x-auto`-Container, Fähigkeiten-Badges-Spalte, Fähigkeiten-Filter-Toggles) → Free-Models-Tabelle (neuestes oben, eigene unabhängige Fähigkeiten-Filter-Toggles) → Datenschutz-Tabelle (`PrivacyTable`: Sortierung Modell/Stufe, Default `tier:asc` = schlechteste Stufe oben; Badges `badge-error` Modelltraining / `badge-warning` Aufbewahrung > 0 Tage und „Kein ZDR“ (Daten aufbewahrt, Dauer unbekannt) / `badge-success` ZDR / `badge-ghost` keine Angabe; „≈“ = Familien-Fallback; „Gültig bis“-Spalte = `validUntil` oder „bis auf weiteres“) → Changelog (JSON-Events, i18n-Texte, Badges) → Impressum/Datenschutz.
- Quellen-Links (Go, Zen, models.dev), RSS-Link (`releases.atom`) und der „Verfügbar seit“-Hinweis stehen ausschließlich im Footer (kein Quellen-Link im Free-Models-Header). Changelog-Badges sind richtungsabhängig: `badge-error` ↑/− = teurer/weniger, `badge-success` ↓/+ = billiger/mehr, neutral ≈ = `badge-ghost`.

## CI/CD (`.github/workflows/price-tracker.yml`)

- Trigger: `schedule cron "0 8 * * 1-5"` (Mo–Fr 10:00 UTC+2) und `"0 20 * * *"` (täglich 22:00 UTC+2), `workflow_dispatch`, `push` auf `main`.
- Pipeline: install (`--frozen-lockfile`) → `pnpm test` → `pnpm scrape` → `pnpm build` → Commit (CHANGELOG.json + data + src/data, `github-actions[bot]`, nur bei Änderungen) → Release (`node scripts/ensure-release.mjs --all` → `gh release create`/`edit` mit Tag = Changelog-Datum, damit Watcher per E-Mail und RSS-Reader via `releases.atom` benachrichtigt werden) → `upload-pages-artifact` (dist) + `upload-artifact` (dist-Zip) → `deploy-pages`.
- `scripts/release-notes.mjs` rendert Changelog-Einträge als **rein englisches Markdown mit nur den Fakten** (Titel + Event-Liste — keine Links zu Site/RSS, kein Watch-Hinweis). `scripts/ensure-release.mjs` stellt **pro Changelog-Datum genau eine Release** sicher und läuft bei **jedem** Workflow-Lauf (nicht mehr nur bei `changed=true`): `--all` prüft alle Einträge, erstellt fehlende Releases nach (Backfill, `--latest=false` für alte Daten) und editiert bestehende nur bei geänderten Notizen; Tag = Eintragsdatum → Morgen- und Abend-Lauf desselben Tages **mergen in eine Release** (Abend editiert, falls `mergeChanges` den Eintrag ergänzt hat). Manueller Backfill: `node scripts/ensure-release.mjs --all` bzw. `--date YYYY-MM-DD`. Bestehende Releases werden bei einem Lauf mit geänderten Notizen automatisch nachgezogen.
- Nach einem Daten-Commit (`changed=true`) benachrichtigt der Deploy-Job das Vergleichs-Projekt `reisi007/ai-10-usd` per `repository_dispatch` (`event_type=source-updated`, POST auf `/repos/reisi007/ai-10-usd/dispatches`). Secret: `AI10USD_DISPATCH_TOKEN` (PAT mit `repo`-Scope bzw. fine-grained mit Contents read/write auf `ai-10-usd`, in **beiden** Tracker-Repos). Fehlt das Secret → Step übersprungen (grün); vorhanden → der Step prüft den HTTP-Status und bricht bei ≠ 2xx **rot** ab (kein stiller Verlust wie beim alten `curl -sS` ohne `-f`).
- Ein fehlgeschlagenes `pnpm scrape` bricht die Pipeline ab (kein Commit/Deploy, Lauf rot).

## Tests

- `pnpm test` = Scraper-Unit-Tests (`tests/scrape.test.mjs`) **plus** ein E2E-Sortier-Test (`tests/sorting.test.mjs`).
- Der Sortier-Test baut die echte `PriceTable`-Komponente per SolidJS-SSR (`tests/ssr-entry.tsx`, Vite-Build in `tests/.ssr/`, gitignored) und prüft für jede Preisbasis (`list`/`full`/`paid`) × Preisspalte (`input`/`output`/`cachedRead`/`cachedWrite`/`cost`) × Richtung, dass die gerenderte Reihenfolge exakt der Reihenfolge der **angezeigten** Werte (`fieldPrice`/`requestCost`) entspricht — nicht dem rohen Listenpreis. Regression: bei `paid` sortiert der Effektivpreis (DeepSeek V4 Flash vor MiMo V2.5), obwohl beide denselben rohen Input-Preis (0.14) haben.

## Verifikation

Nach jeder Umsetzung prüft ein **unabhängiger Agent**:
`pnpm scrape` (exit 0, korrekte Daten — **vor Commit/Push verpflichtend**), `pnpm test` grün, `pnpm build` grün,
`dist/` enthält `data/latest.json` + `CNAME`, Workflow-YAML valide,
`pnpm preview` liefert 200 und der JSON-Endpunkt `/data/latest.json` antwortet (alle Modelle mit `privacy`).
Außerdem wird geprüft, dass **aktuelle Tool-Versionen** verwendet werden
(`pnpm outdated` ohne ungewollte Abweichungen, Node ≥22, pnpm aus `packageManager`). Nach Push wird die CI bis zum grünen Lauf beobachtet.

## Delegation & Parallelisierung (Subagenten)

- Wo möglich arbeitet OpenCode mit Subagenten statt alles selbst zu tun: `explore` für Recherche, `general` für
  Implementierung, `vision` für Screenshot-Analyse.
- **Implementierung und Verifikation laufen in getrennten Subagenten**: ein Implementierungs-Agent baut, ein
  **unabhängiger Verifikations-Agent** prüft (siehe „Verifikation"). Bei unabhängigen Teilaufgaben (z. B. zwei
  Projekten, unabhängigen Routen/Batches) werden beide Agenten **parallel** gestartet.
- Jeder Subagent bekommt eine in sich geschlossene Aufgabenbeschreibung (frischer Kontext) inkl. Pfaden, Befehlen
  und Akzeptanzkriterien — keine Annahmen über bereits Gesehenes.
- **Kleine Änderungen** (einzelne Edits, offensichtliche Fixes, Versions-/Befehlskosmetik) macht OpenCode weiter
  **direkt selbst** — Subagenten sind für größere, unabhängige Arbeitspakete gedacht.
