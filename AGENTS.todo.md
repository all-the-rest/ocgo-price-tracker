# AGENTS.todo.md — ocgo-price-tracker

## Entscheidungen 2026-10-12 — v2-Migration (`/docs/de/` → `/v2/docs/console/`)
Anlass: Die alten Docs-URLs (`/docs/de/go/`, `/docs/de/zen/`) liefern HTTP 404 — die Docs
sind auf v2 umgezogen, CI war rot (`pnpm scrape` brach ab). Vollständige Regeln stehen in
`AGENTS.md` — hier nur die getroffenen Entscheidungen samt Begründung.

- [x] **Neue Quellen:** Go-Seite `https://opencode.ai/v2/docs/console/go/` (Pläne, Preise,
  Privacy, Patterns, Peak-Notiz), Models-Seite `https://opencode.ai/v2/docs/console/models/`
  (Endpoints + Pricing + „Free models“-Liste) als Free-Quelle. `SOURCE_LANG` = `en`,
  `Accept-Language: en-US`. Die alten `/zen`- und `/de/zen`-Seiten sind JS-rendered
  (0 Tabellen) und **nicht** geeignet. Keine stillen Fallbacks (weiterhin `ScrapeError`
  bei 404/leer).
- [x] **Modelle vollständig:** v2-Katalog = alter Katalog (42=42 Zeilen, Tokenpreise Go vs.
  Go Plus 0 Mismatches, nur HTML-Entity `&gt;` vs `>`). Der Migrations-Scrape ergab
  **0 Changelog-Events** — kein Modell-, Preis- oder Nutzungs-Diff, nur `sourceUrl`/
  `sourceLang`/`plansChanged` still geschrieben. Free-Count 13 = alter Stand.
- [x] **Tab-Mechanik:** `div.docs-plan-tabs` (`button[data-plan-tab]` ↔
  `div[data-plan-panel]`, ARIA als Fallback) statt `starlight-tabs`. `creditsMonthly`
  Go ist jetzt **80** (war 60): `Monthly limit` Go = $15/$30/$60/$80.
- [x] **Englische Werte:** Privacy (`Not used`, `N days`, `0 days` → ZDR, `Not ZDR` → false),
  Patterns (`… tokens per request`), Free-Footnotes (`<Name> is …` unter `h3#free-models`,
  `zero-retention … does not use … for model training` → ZDR, `feedback`/`improve the
  model` → `training: true`), Privacy-Notiz (`valid through October 31, 2026` via neuem
  `parseEnglishDate`). Deutsche Aliase bleiben als Kompatibilität (Parser + Tests).
- [x] **Fixtures/Tests:** `tests/fixtures/go-de.html`/`zen-de.html` ersetzt durch
  `go-en.html` (42 Zeilen/Plan) + `models-en.html` (88 Endpoints, 103 Pricing, 13 Free);
  `buildPage`-Helper baut `docs-plan-tabs`-Markup; DE-Parser-Tests bleiben als
  Kompatibilitäts-Beweis, EN-Pendants ergänzt (`parseEnglishDate`, Live-Peak-Notiz).
  **Keine** Zahlen-Pins auf `data/latest.json` (Struktur-Invarianten wie bisher).
- [x] **Badge-Farben (Faktor-Skala, 2026-10-12 nachgeschärft):** `usageBadge` nutzt nur den
  Faktor zum Monatspreis — ≤1,5× rot, unter 6× gelb, ab 6× grün, über 6× fett — planübergreifend
  (Go: $15 rot, $30 gelb, $60 grün, $80 grün+fett; Go Plus proportional: $60 rot … $240 grün).
  Anlass: die halbes-Guthaben-Schwelle ($80/2 = $40) färbte $30 = 3× fälschlich rot; `creditsMonthly`
  spielt in der Farbskala keine Rolle mehr. Tooltip-Legende de/en dokumentiert die Skala
  („Faktor zum Monatspreis: ≤ 1,5× rot · unter 6× gelb · ab 6× grün · über 6× grün + fett").
- [x] **Verifikation:** `pnpm test` 275/275 grün, `pnpm scrape` exit 0 (42 Modelle, alle mit
  privacy, usage-Map vollständig, keine leeren Changelog-Einträge), `pnpm build` grün,
  `pnpm smoke` grün (mit `NODE_OPTIONS=--dns-result-order=ipv4first` — Sandbox-Quirk:
  vite-Preview lauscht hier nur auf `::1`, ohne die Option scheitert Node-`fetch` mit
  ECONNREFUSED; auf GitHub-Runnern nicht nötig, kein Repo-Fix).

## Entscheidungen 2026-09-30 — datengetriebene Peak-Regeln (peakHours → peakRules)
Anlass: Der Wochentags-Scope der Peak-Regeln stand wörtlich in der Doku („montags bis
freitags … einschließlich der Wochenenden sind Off-Peak"), wurde aber verworfen; stattdessen
war Sa/So hartkodiert (`weekendOffPeakDaysBeijing`, `isBeijingWeekend`, `effectiveFromMs`).
Verbindliche Spezifikation: `peak-spec.md` (§1 Datenform, §2 Auswertung, §3 Scraper).
**Nachtrag (bindend, s. u.):** §3 („Feiertage nur, wenn die Quelle sie nennt") und die
Quellenbindung schlagen §7a — die OpenCode-Doku nennt keine Feiertage, deshalb gibt es
weder `holidayCalendars` noch eine Footer-Feiertagszeile.

- [x] **`peakHours` entfernt, neue Form `peakRules` + `holidayCalendars`** (Top-Level). Feldnamen
  exakt nach §1: `timezone`, `effectiveFrom?`, `peak.days`/`peak.windowsUtc`,
  `offPeak.days`/`offPeak.allDay`, `holidays.policy`/`holidays.calendar`,
  `dates`/`coveredThrough`. ISO-Wochentage 1=Mo…7=So. `src/types.ts` entsprechend.
- [x] **Scraper** (`scripts/scrape.mjs`): `parsePeakHours` → `parsePeakRules` (Namenskonvention
  `parseX`; der Output ist keine „Hours"-Map mehr). Neue Helfer `parseWeekdayScope` (de+en),
  `parseWeekendScope`, `parseHolidays`, `parseEffectiveFrom`, `peakTimezoneFor`. `parsePeakRanges`
  bleibt unverändert.
- [x] **`offPeak.days` = Komplement von `peak.days`**, nicht separat aus dem Wochenend-Satz
  gebildet: die Invariante §1 (disjunkt, Union {1..7}) erzwingt das Komplement, und ein Tag ohne
  Peak-Fenster ist per Definition ganztägig Off-Peak. Eine **explizit** genannte Wochenend-Angabe
  wird gelesen und als Konsistenz-Check verwendet (Widerspruch → `ScrapeError`). `offPeak.days`
  ist nach §1 nicht leer (bei DeepSeek `[6,7]`); „täglich"/`peak.days=[1..7]` wäre damit nicht
  darstellbar — in diesem Repo irrelevant (nur DeepSeek-Mo–Fr), bewusst nach §1 umgesetzt.
- [x] **Pflicht-`ScrapeError`**: fehlender Wochentags-Scope, nicht auflösbarer Bereich,
  Feiertags-Aussage ohne bestimmbares Land (nur „chinesische …"/„chinese …" ist bestimmbar),
  Wochenend-Angabe widerspricht dem Scope, widersprüchliche Regeln, Peak-Modell ohne Regel,
  unbekannte Peak-Familie (keine geratene Zone), Feiertagskalender mit 0 Terminen.
- [x] **`timezone`** kommt aus `PEAK_TIMEZONE_BY_FAMILY` (DeepSeek → `Asia/Shanghai`). Die
  OpenCode-Doku nennt die Zone nicht; DeepSeek formuliert seine Wochentagsregel in Peking-Zeit
  (§1). Unbekannte Familien → rot statt geraten.
- [x] **`effectiveFrom`** (`parseEffectiveFrom`) nur, wenn die Notiz ein effektives Datum nennt.
  Die aktuelle Doku nennt keins → Feld fehlt im Datensatz (die frühere Konstante `effectiveFromMs`
  stammte aus dem DeepSeek-Original, nicht aus der OpenCode-Doku). Die Auswertung unterstützt es
  (vor `effectiveFrom` kein Peak) und ist per Test abgedeckt.
- [x] **Keine Feiertagsdaten (strikt quellenbindend).** Live verifiziert: die Peak-Notiz auf
  `https://opencode.ai/v2/docs/console/go/` nennt **keine** Feiertage (v2-Docs, englisch). „excluding Chinese
  public holidays" steht nur in der DeepSeek-Originaldoku, also außerhalb der Tracker-Quelle →
  `peakRules[].holidays` und `holidayCalendars` bleiben in `data/latest.json` **leer/fehlend**.
  `parseHolidays` bleibt als Parser (spec §3: nur setzen, wenn die Quelle sie nennt; Aussage ohne
  Land → rot) — der Beweis, dass die Quelle sauber geprüft wurde.
- [x] **`holidayCalendars` optional im Typ/zod**, wird **nicht** geschrieben (kein `chinese-days`
  o. Ä. im Scrape-Pfad). Das Feld bleibt im Schema, damit die Datenform die Quelle nicht verengt
  und der Consumer (`ai-10-usd`) tolerant bleibt; `src/config/peakPricing.ts` liest es weiterhin
  optional (Kommentar `// optional: nur aktiv, wenn die Quelle Feiertage nennt`).
- [x] **Einmalige stille Migration** `peakHours` → `peakRules`: neuer stiller Write-Trigger
  `peakRulesChanged` (wie `privacySilentUpdate`); **kein** Changelog-Event, **kein** Release
  (die Quelle hat sich nicht geändert, nur die Repräsentation).
- [x] **Auswertung in einer Quelle** (`src/config/peakPricing.ts`: `isPeakAt`, `nextTransition`,
  `isBeforeEffectiveFrom`, `localIsoDate`, `isoWeekday`), Header/Countdown/`nextTransition` mit
  `effectiveFrom` und **optionaler** Feiertagslogik (bei uns inert); Wochentag/Feiertagsdatum
  **immer in `rule.timezone`** (Intl), kein 调休/`isWorkday`. `PeakIndicator`/`PriceTable`/
  `ShareDialog`/`App` reichen `peakRules` (+ optional `holidayCalendars`) durch;
  `weekendOffPeakDaysBeijing`/`isBeijingWeekend`/`effectiveFromMs`/`PEAK_WINDOWS_UTC` sind **entfernt**.
- [x] **i18n de+en generiert**: `peakTooltip` mit `{scope}` (aus `peak.days`), `peakWeekendNote`
  mit `{days}`/`{tz}`, neue `peakHolidayNote`/`peakPreEffective`; `share.ts` (Solid-frei) leitet
  Scope/Wochenendtage ebenfalls aus den Daten ab; hartkodierte Prosa entfernt. **Keine**
  Footer-Feiertagszeile (`holidayCalendarLine`/`holidayCoverageEnded` wurden wieder entfernt);
  der bestehende `Stand`-Hinweis bleibt unverändert.
- [x] **Tests**: `tests/scrape.test.mjs` (Scope de+en, Wochenende, `parseHolidays` als Parser-Beweis,
  alle `ScrapeError`-Fälle, alle zod-Invarianten §1 inkl. „`holidayCalendars` fehlt/leer ist gültig"),
  neues `tests/peak.test.mjs` (Auswertung: Werktag im/außerhalb Fenster, Wochenende, **01.10.2026
  verhält sich wie ein normaler Donnerstag** bzw. mit synthetischem Kalender Off-Peak — die
  optionale Logik lebt, ist aber inert; vor `effectiveFrom`, Zonenrand 16:30 UTC = 00:30 Shanghai,
  `nextTransition`, `formatDayScope`, Footer **ohne** Feiertagszeile), `tests/share.test.mjs`/
  `tests/sorting.test.mjs` unverändert grün, Share-Card-Screenshot-Test auf die neue
  `shareWeekdayScope(lang, rule)`-Signatur angepasst.
- [x] **`ai-10-usd`-Legacy-Pfad bleibt** (anderes Repo, dort in Arbeit): der Consumer führt
  `peakHours` (Legacy) **und** `peakRules`/`holidayCalendars` (`?? null`, optional) weiter und
  aktiviert den neuen Pfad nur, wenn die Felder ankommen — **keine** Umrechnung von Alt-Fenstern
  auf Wochentage. Dieses Repo liefert ab jetzt nur noch `peakRules`.
- [x] Verifikation (final, nach dem Nachtrag): `pnpm test`, `pnpm scrape` (exit 0, zweiter Lauf
  idempotent, 0 Changelog-Events), `pnpm typecheck`, `pnpm build`, `pnpm smoke`,
  `pnpm test:screenshots` (betroffene Suites) und `pnpm test:contrast` — grün.

### Nachtrag 2026-09-30 (bindende Nutzerentscheidung, strikt quellenbindend)
- **`PEAK_HOLIDAY_OVERRIDES` und `chinese-days` wurden wieder entfernt.** Begründung: Die
  OpenCode-Doku nennt an der Peak-Notiz keine Feiertage (de **und** en, live verifiziert); die
  Angabe steht nur in der DeepSeek-Originaldoku
  (`https://api-docs.deepseek.com/quick_start/pricing/`, aus der Go-Doku verlinkt) — also
  außerhalb der Quelle dieses Trackers. Ein Override wäre genau die Art versteckter Annahme, die
  der Umbau beseitigen soll.
- `chinese-days` ist aus `package.json`/`pnpm-lock.yaml`/`node_modules` entfernt; `holidayCalendars`
  wird nicht mehr geschrieben (optional im Schema); die Footer-Feiertagszeile (de+en) entfällt
  ersatzlos. Details siehe AGENTS.md.

### Verworfen (nicht implementieren)
- ~~`PEAK_HOLIDAY_OVERRIDES` / chinesische Feiertage in den Tracker-Daten~~ — die Quelle
  (OpenCode-Doku) nennt sie nicht; ein Override aus der verlinkten DeepSeek-Originaldoku wäre
  eine versteckte Annahme. Wo die Information tatsächlich steht:
  `https://api-docs.deepseek.com/quick_start/pricing/` (DeepSeek-Original). Kein Tracker-Datum,
  kein Footer-Hinweis, keine `chinese-days`-Abhängigkeit.
- ~~Lib-Frische-Guard für `chinese-days`~~ — entfällt mit der Abhängigkeit; die Peak-Regeln
  brauchen keine Fremd-Lib mehr (Fenster und Wochentage kommen aus der Quelle).
- ~~`peakHours` als Legacy-Feld neben `peakRules` behalten~~ — der Scraper schreibt nur noch die
  neue Form; die Dual-Toleranz lebt ausschließlich im Consumer (`ai-10-usd`), nicht in den Daten.
- ~~Hartkodierte Wochenend-Konstanten (`weekendOffPeakDaysBeijing`, `isBeijingWeekend`) behalten
  und nur den Wochentags-Scope ergänzen~~ — genau die Hartkodierung ist der Anlass des Umbaus.
- ~~Funktionsnamen `parsePeakHours` beibehalten~~ — der Rückgabewert ist keine Stunden-Map mehr.
- ~~Feiertags-Aussage ohne Land auf einen Default-Kalender abbilden~~ — §3 verlangt rot.

### Abweichungen von der Spezifikation (bewusst, dokumentiert)
- **Kein `holidayCalendars` / keine Feiertage** (Spez. §3 erlaubt es, §7a-Footer entfällt):
  Quellenbindung schlägt das §7a-Beispiel. Der §7a-Footer ist damit nicht implementiert —
  Begründung s. o.
- **`offPeak.days` nicht leer** (§1.2) macht ein rein „tägliches" Peak-Muster unausdrückbar —
  in diesem Repo irrelevant; `provider-plans` (MiMo `offPeak.days: []`) führt ein eigenes Schema.

## Entscheidungen 2026-09-28 — zwei OpenCode-Go-Pläne (Go $10 / Go Plus $40)
Anlass: die Doku hat die Preistabellen auf Deutsch umgestellt **und** erstmals zwei Abonnemente
eingeführt; der Scraper lief dadurch rot. Vollständige Regeln stehen in `AGENTS.md` (Datenmodell,
Scraper-Regeln, UI-Regeln) — hier nur die getroffenen Entscheidungen samt Begründung.

- [x] `models[].usage` wird eine **Plan-Map** (`{go, go-plus}`), `plans[]` aus der Plan-Tabelle der
  Doku. `monthlyCredit`, `monthlyCost`, `models[].multiplier` und die vier `effective*` sind
  **entfernt** — sie sind plan-abhängig, die Rechnung liegt jetzt in `src/weighted.ts`
  (`usageOf`/`multiplierOf`/`fieldPrice`). Vorher zwei Quellen der Wahrheit, jetzt eine.
- [x] `creditsMonthly` = **höchste endliche `usage` des Plans** (Go 60, Go Plus 240). Die früheren
  Prosa-Parser („Nutzung im Wert von $60", „das Sechsfache") sind entfernt: die Doku hat die Sätze
  gestrichen, und ein stiller 60/10-Fallback wäre für Go Plus schlicht falsch. Fehlende Plan-Tabelle
  → rot, nicht Fallback.
- [x] Plan-Zuordnung der Preistabellen über **ARIA** (`tabpanel[aria-labelledby]` → `tab#id` → Label),
  nicht über Position; Preis-Kreuzprüfung über die Pläne (Doku sagt: Tokenpreise identisch),
  Abweichung → rot.
- [x] Changelog-Eventform nach **cc-price-tracker**: `usage_changed` = **ein Event pro Modell** mit
  `plans: [{plan, from, to}]` (statt 37 Events, je eines pro Plan). Legacy-Einträge ohne `plans`
  bleiben per zod-Union gültig, weil zu ihnen bereits Releases mit byte-identischen Notizen existieren.
- [x] Changelog ist **pro Plan** gefiltert: plan-spezifisch sind nur `usage_changed` und
  `plan_added`; `free_added`/`free_removed`, `text` sowie Modell-/Preis-/Datenschutz-/Fähigkeits-Events
  stehen in beiden Ansichten (die Modelle und Tokenpreise sind in beiden Plänen identisch). Legacy-
  Events ohne Plan-Feld gehören zu Go (es gab nur den). Einträge ohne verbleibendes Event verschwinden ganz.
- [x] `freeModels` (Zen) sind **plan-unabhängig**: kein `usage`/`plan`-Feld, `FreeModelSchema` ist
  `.strict()` (ein Plan-Key dort bricht rot), die UI filtert Free-/Datenschutz-Tabelle nie nach Plan.
  Abzugrenzen von den zwei Gratis-**Zeilen der Go-Preistabelle** (`Space Bunny Free`,
  `LongCat 2.5 Preview Free`): die stehen in beiden Plan-Tabellen mit `usage: null`.
- [x] `fieldPrice` bei unbegrenzter Nutzung: Basis `full` → **Listenpreis** (`0` → `$0`), Basis
  `paid` → `null` (`–`). Vor der Umstellung stand dort `$0`, im Refactor stand kurzzeitig `–`.
- [x] `ai-10-usd` liest die Daten über `scripts/normalize.mjs` (akzeptiert Legacy **und** Plan-Format)
  und wählt den **günstigsten** Plan — es ist eine $10-Seite, also Go, nicht Go Plus. Dualkompatibilität
  war Pflicht, weil die Live-JSON zwischen den beiden Deploys im alten Format ist.
- [x] **Reihenfolge beim Schema-Bruch:** erst der lokale Commit im **Consumer**, dann der
  `repository_dispatch`. Ein Dispatch gegen noch nicht committeten Consumer-Code sieht harmlos aus
  (der Dispatch selbst ist grün) und bricht dann im Smoke-Test des Consumers rot: `finite(model.usage)`
  bekommt eine Map statt eines Skalars, gibt `null` zurück, und **jede** Zeile verliert den Status
  `matched` — Symptom „kein gematchtes Modell für den Prerender-Check", Ursache weit weg vom
  eigentlichen Ort. Bei Schema-Brüchen generell: Consumer-Normalisierung zuerst lokalisieren,
  `pnpm generate && pnpm smoke` **lokal** gegen die Live-Daten prüfen, dann committen, dann triggern.
- [x] `history.json` ist bei Divergenz gegen `origin/main` als **Union** zu führen (chronologisch
  sortiert), nicht „eine Seite gewinnt": der Remote kann zwischenzeitlich einen eigenen CI-Snapshot
  bekommen haben (`data/latest.json` bleibt die lokal erzeugte, aktuelle Fassung). Ein naives
  Überschreiben hätte die Chronologie verkürzt und `firstSeen` verfälscht.
- [x] **`plan_added`**: genau **ein** Event, wenn ein Plan in `plans[]` neu auftaucht, mit `plan`,
  `name`, `priceMonthly`, `creditsMonthly`. Nutzungsänderungen für neu hinzugekommene Pläne werden im
  selben Lauf **unterdrückt** (vorher existierte nichts, was sich geändert haben könnte) — der Filter
  entfernt den neuen Plan aus dem `plans`-Array, damit eine echte Änderung an einem *bestehenden*
  Plan im selben Lauf überlebt. Bewusste Entscheidung gegen 37 Einzel-Events — informationsleer, sie
  überlagern die echten Nachrichten des Tages. **Typisiert statt `text`**, damit ein späteres
  `plan_removed` symmetrisch ergänzbar ist und der Plan maschinell filterbar bleibt. `plan_removed`
  selbst ist out of scope. Release-Notiz: `- **Go Plus** — new plan: $40/month, up to $240 included
  usage per model`.
- [x] Visuelle Verifikation ist Pflicht bei UI-Änderungen: `pnpm test:screenshots` + `pnpm test:contrast`
  (WCAG-AA-Matrix hell/dunkel, blockierend), Findings-Report nach dem `ui-review`-Skill, und **manuelle
  Abnahme über `pnpm preview` vor Commit/Push** (kein Push ohne Abnahme).
- [x] Arbeitsregel: **Entscheidungen immer als interaktive Frage** (Tool `question`) und anschließend in
  `AGENTS.md` **und** `AGENTS.todo.md` festhalten; verworfene Ansätze klar als verworfen markieren.

### Changelog: Reihenfolge, Legacy-Migration, Release-Rewrite (aus dem Screenshot-Review 2026-09-28)
- [x] **Keine Umkehrung mehr im Renderer.** Die UI rendert `entry.changes` in Erstellungsreihenfolge
  (`plan_added` → `model_added` → `model_removed` → Preis/Nutzung → `capabilities` → `privacy` → `free_*`).
  Die Umkehrung war mal drin, machte aber `plan_added` ans Ende jedes Eintrags und wich von
  `release-notes.mjs` ab (dort gilt die Erstellungsreihenfolge). Folge: die visuelle Reihenfolge **aller**
  Events dreht sich mit — gewollt, die alte Anordnung (Entfernungen oben) war nur die Kehrseite davon.
  Wer sie ändern will, ändert `buildChanges`, nicht das UI.
- [x] **Legacy-Formen einmalig migriert, Sonderfälle entfernt.** Die ~40 Einträge vor der Plan-Einführung
  hatten skalare `from`/`to` und skalares `pricing.usage`; sie sind jetzt `plans: [{plan:"go",…}]` bzw.
  `{go:…}`. Damit entfallen die zod-Union, die `DEFAULT_PLAN_ID`-Sonderbehandlung in `planScopedChange` und
  die Skalar-Zweige in UI + `release-notes.mjs` — der Plan-Name wird immer genannt. Einziger Rest:
  `pricingOf` normalisiert einen skalaren `usage` aus einem **alten** Snapshot (Lese-Schutz, kein
  Rendering-Fall).
- [x] **Releases neu geschrieben** über `ensure-release.mjs --all` (Notizen `@ $15` → `@ Go $15`),
  danach `check-release-sync.mjs` grün (41/41). **27 von 41** Releases editiert, 14 unverändert (nur
  Einträge mit Nutzungs-Angaben sind betroffen) — Stand des Rewrites im Commit `fee432b`, nicht
  später reproduzierbar. Die AGENTS.md-Regel „manuelle Release-Korrekturen nie über das
  Script" ist damit **eingeengt** auf inhaltliche Korrekturen; Renderer-/Formatmigrationen laufen über
  das Script. Bereits versendete E-Mail-/RSS-Benachrichtigungen bleiben naturgemäß unverändert.
- [x] **Tab-Leiste vollbreit ist gewollt** — als Befund aus dem Screenshot-Review verworfen, nichts geändert.
- [x] **Sticky-Header-Überlagerung ist gewollt.** In den Element-Aufnahmen überlagert der Sticky-Header
  mittig Inhalt (weiße Bande im Changelog, Filterzeile in sec1). Ich hatte das als offenen Punkt
  geführt, weil man es aus einem Bild nicht sicher als Defekt entscheiden kann; der Nutzer hat es
  geprüft: **passt so, kein Anker-Test nötig, nichts geändert.** Wichtig für künftige Reviews: eine
  Überlagerung in einem `*-changelog.png`/`*-secN.png` ist damit **kein** Befund — der Screenshot
  scrollt ins Element und der Header klebt darüber. Nur im Full-Page-PNG unterhalb des Folds zählt es.

### Verworfen (nicht implementieren)
- ~~„Alle Events außer den Zen-Free-Models sind plan-spezifisch"~~ (inkl. Modell-Verfügbarkeit pro Plan
  nach dem `cc-price-tracker`-`availability`-Muster). Zurückgezogen: hätte ein Plan-spezifisches
  Preismodell bedeutet, obwohl die Doku die Identität der Tokenpreise ausdrücklich zusichert. Modell-
  Verfügbarkeit ist derzeit für alle Pläne gleich; bei echter Divergenz wäre das ein neues Schema,
  kein Patch.

## Share-Cards (Portrait-Regel)
- [x] Portrait-Karten (IG 4:5 1080×1350 = Top 10, Story 9:16 1080×1920 = Top 15) füllen die Höhe mit
  **Constraints statt uninteressanten Modellen**: kompakte Zeilen (Min-Font, geteilter Raum, kein
  Overflow per Konstruktion), pro Zeile max. eine Constraint-Zeile (Peak-/Off-Peak-Badge,
  `peakHours`-Fenster), kompakter Constraints-Block unter der Liste (Peak-Hours/Off-Peak-Regeln
  + Stand + Domain-Quelle `ocgo-pricing.all-the.rest`).
- [x] Landscape (OG 1200×630, Twitter 1200×675): Top 5, Requests, keine Constraints.
- [x] Zeilen-Details: Rank + Name + Requests + Preis (Breite 1080px begrenzt keine weiteren Felder).
- [x] Footer IMMER bottom-anchored (alle Presets/TopN): flexibler Listenraum darüber.
- [x] Free/unlimitiert (usage=null → ∞) wie die Haupttabelle: oberster Rang, ∞ + Preis-Kontext.
- [x] Karten-Sortierung = Haupttabellen-Sortierung (aktive Basis, Requests desc).
- [x] Defaults von der Hauptseite (Basis, Theme, Lang, Capability-Filter) + Deep-Link round-trip.
- [x] Peak-/Off-Peak-Angaben IMMER mit UTC-Fenster + Wochentags-Scope (Mo–Fr (Peking-Zeit) aus
  `PEAK_PRICING_RULES`, sonst täglich; ohne Fenster als Quellenstand markiert), DE+EN.
- [x] TopN automatisch pro Preset (OG/Twitter Top 5, IG Top 10, Story Top 15),
  live aus Daten/Sortierung; legacy `?topN=` toleriert, ignoriert.
- [x] Keine Preise auf der Karte (Zeilen = Rank + Name + Requests), kein Preisbasis-Selektor
  im Dialog (legacy `?basis=` toleriert, ignoriert); Karten-Sortierung = List-Basis der Tabelle.
- [x] Footer: LINKS Domain, RECHTS lokalisiertes Datum + Uhrzeit (fetchedAt, UTC).
- [x] Dialog-Layout: Sprache zuerst (links neben Stil), 3er-Grid Desktop / Stack Mobile, X-Button.

## Zahlen-Pins auf generierte Daten (CI-Stopp 2026-10-02)
- [x] Harte Zahlen-Assertions gegen generierte Live-Daten entfernen. Auslöser: der 18:07Z-Scrape
  übernahm korrekt `ling-3.1-flash-free` (freeModels 10 → 11, mit `free_added`-Event), der nächste
  Push lief 28 s später rot — `assert.equal(data.freeModels.length, 10)` in `tests/scrape.test.mjs`,
  also **bevor** der Scrape überhaupt laufen konnte. Ein Pin auf generierte Daten ist strukturell
  falsch: er ist flüchtig, und die nächste echte Quelländerung bricht ihn wieder.
- [x] Absicherung wandert in den Scrape: `assertNonEmptyCatalog()` prüft, dass `plans`/`models`/
  `freeModels` befüllt sind, sonst `ScrapeError`. Das ist der Fehlerfall, den der Zahlen-Pin nebenbei
  mitabfing: eine umgebaute Doku liefert 0 Zeilen, und ohne die Prüfung hätte der Lauf einen leeren,
  schema-validen Snapshot committet und die Seite leer gerendert.
- [x] Struktur-Invarianten im Test bleiben erhalten (usage-Schlüssel == Plan-Ids, Free-Modelle ohne
  Plan-Feld, kein `holidayCalendars`, `validateSnapshot`) — nur ohne Zahlen.
- [x] Fixture-Counts bewusst **nicht** angefasst (`parseHtml: extrahiert 39 Modelle aus dem
  HTML-Dump`, `tests/fixtures/*.html`): deterministisch und korrekt. Ebenso Changelog-EVENT-Zählungen
  (`assert.equal(result.entries.length, 1)`), wo der Test die Eingabe selbst baut.
- [x] `freeModels` NICHT mit „nicht leer" erzwingen: **0 kostenlose Zen-Modelle sind ein legitimer
  Quellstand.** Ein Helper, der das abbricht, baut einen neuen Ausfall, den es vorher nicht gab. Die
  echte Lücke ist eine andere: nicht erreichbare Zen-Doku **ohne** Vorlauf. Dafür wirft
  `fetchZenFreeModels` jetzt `ScrapeError` — vorher warnte es und gab ein leeres Ergebnis zurück, das
  wie „0 Gratis-Modelle" aussah und einen Ausfall als Tatsache ausgab. Die Unterscheidung
  „nicht lesbar" vs. „leer" ist nur im Fetch möglich, nicht im späteren Helper.
- [x] `assertNonEmptyCatalog` auf `plans`/`models` beschränkt; für die beiden ist es redundant zu
  `SnapshotSchema` (dort bereits `.min(1)`). Bewusst als benannter Helper behalten, weil die
  zod-Meldung den Grund („Doku umgebaut?") nicht nennt — der Fehler soll lesbar sein.
- [x] Schwester-Repos (`ai-10-usd`, `cc-price-tracker`, `provider-plans`) geprüft: **keine** harten
  Pins auf generierte Daten. `cc-price-tracker` deckt leere Kataloge schon im Scrape ab (zod
  `.min(1)` in `SnapshotSchema` + `extractCatalog`), `provider-plans` in `validateVendorData`. Die
  einzigen Zahlen-Assertions dort sind Fixture-Pins — die bleiben.

### Verworfen
- **Zahl auf 11 hochzählen** (Symptomkur): hätte den Test gerettet und beim nächsten echten
  Katalog-Wechsel erneut rot werden lassen. Genau der Fehler, den die Regel oben beseitigt.
- **Den Testlocker als nicht-blockierend markieren / Test-Step nach den Commit verschieben**: der Test
  war nicht die Fehlerquelle, die Pipeline-Reihenfolge war es auch nicht — der Pin war es. Ein
  grüner Durchlauf mit leerem Katalog wäre schlimmer als ein roter.

## Browser-Konsolen-Test (Playwright, Follow-up zum Smoke-Test)
- [ ] Playwright-Test, der die Seite im echten Browser lädt und Konsolen-Fehler/pageerrors
  als Fehler wertet (fängt JS-Laufzeitfehler, die Build + `pnpm smoke` nicht sehen).
  Eigene Suite/config (nicht in die Screenshot-Suite — die bleibt assertion-frei),
  in CI nach dem Smoke-Step. Browser via Container-Image oder `playwright install`.

## Entscheidungen 2026-10-14 — Doku-Änderung (CI-Reparatur)
Anlass: CI rot (`Peak-Modelle ohne UTC-Zeitfenster: DeepSeek V4 Pro`). Ursache: die Live-Doku
hat am 2026-10-14 **DeepSeek V4 Flash** und **DeepSeek V4 Flash Vision Exp** entfernt (Preis-,
Rate-Limit- und Modell-Liste) und die Peak-Notiz auf `DeepSeek V4.1 Flash / V4 Pro:` verkürzt —
„V4 Pro“ steht dort als Listen-Eintrag ohne Familien-Präfix. Zusätzlich neu: **Gemini 4 Argon
Contributor** (mit Preisen, aber ohne dokumentiertes Anfragemuster). Regeln stehen in `AGENTS.md`.

- [x] **Peak-Notiz-Listen tolerant:** `parsePeakRules` zerlegt das Subjekt an `/ , ; + &` sowie
  `und`/`and` in Einträge; ein Eintrag ohne Familien-Präfix matcht, wenn das weggeworfene Präfix
  von einem Geschwister-Eintrag belegt ist („V4 Pro“ → „DeepSeek V4 Pro“). **Ein aus dem Eintrag
  entferntes Modell ist kein Parse-Fehler** (Nutzer-Vorgabe: „soll nicht failen wenn ein Eintrag
  weg ist“). Eine Notiz, der gar kein Modell mehr zugeordnet werden kann, bleibt rot (Gate gegen
  still schweigende Parser-Rückfälle); Kurzform ohne belegtes Präfix matcht nicht fremde Familien.
- [x] **Default-Anfragemuster statt hartem Abbruch:** Reihenfolge dokumentiertes Muster >
  Familien-Fallback (`PATTERN_FALLBACKS`) > `DEFAULT_PATTERN = 800/50.000/162`
  (Command-Code-Durchschnittsnachricht; identisch zu `AVERAGE_MESSAGE_PATTERN` in `ai-10-usd`,
  `scripts/comparison-core.mjs` — Nutzer-Vorgabe „als default fallback nutzen“). Gilt nur für
  Zeilen mit Preisen; kostenlose Zeilen bleiben ohne Muster. Ohne den Default blockierte EIN
  unvollständig ausgerolltes Modell per zod-Prüfung den gesamten Lauf und alle Preis-Updates.
- [x] **`isPricedRow`** als eine Wahrheit für Scrape-Default und zod-Backstop (preisbasiert —
  Nutzung sagt nichts darüber aus: Free-Preis + begrenzte Nutzung bleibt musterlose Zeile).
- [x] **Datenänderungen lokal committet** (Nutzer-Vorgabe): model_removed ×4 (DeepSeek V4 Flash /
  Vision Exp je Off-/Peak), model_added ×1 (Gemini 4 Argon Contributor); peakRules schrumpft auf
  `deepseekv4.1flash`/`deepseekv4pro` (ohne Events). Wegen lokalem Datencommit feuert der
  CI-Dispatch an `ai-10-usd` **nicht** → danach manuell per `gh api` triggern ( dokumentiert in
  `AGENTS.md`).

### Verworfen
- **Einmal-Override nur für Gemini** (`PATTERN_OVERRIDES`): Nutzer klarer als Default für alle
  musterlosen Preis-Zeilen haben — ein Sonderfall pro Modell wäre beim nächsten Rollout wieder
  rot geworden.

## Entscheidungen 2026-10-14 — Go-Referral-CTA entfernt
Anlass: Nutzer-Vorgabe „can you remove the referral link". Interaktive Klärung (Tool `question`)
→ **„Remove whole Go CTA"**: die gesamte Go-Empfehlungskarte im Hero (Button
`https://opencode.ai/go?ref=PKTZTZE0P0`, Referral-Hinweis, Badge, Benefit-Text) entfällt
ersatzlos — nicht nur der `?ref=`-Param.

- [x] `src/components/Hero.tsx`: Karten-`<div id={HEADING_IDS.go} …>` (Zeilen 21–40) entfernt,
  `HEADING_IDS`-Import wird ungenutzt → mit entfernen. Rest (Titel, Subtitle, Intro, Stats)
  bleibt unverändert.
- [x] `src/i18n.ts`: fünf Go-CTA-Keys in **beiden** Sprachen entfernt (`goCta`, `goTitle`,
  `goBadge`, `goBenefit`, `goRefHint`).
- [x] `src/headings.ts`: `go: "go"`-Eintrag aus `HEADING_IDS` entfernt (kein anderer
  Referenznutzer).
- [x] `tests/headings.test.mjs`: `'id="go"'` und `'anchor="go"'` aus `retiredLiterals` entfernt
  (Test-Edit → K3 verletzt → voller Loop: Implementer + unabhängiger Verifier).
- [x] Bestehende Screenshot-Suite enthält kein `toHaveScreenshot` (nur assertion-freie
  Captures) → kein Screenshot-Update nötig.
- **Warten, bis die Doku das Gemini-Muster nachliefert** (CI bleibt rot): blockiert alle Preis-
  Updates und Deploys wegen EINES unvollständig ausgerollten Modells — der Default hält den
  Tracker lebendig, ohne dass eine erfundene Zahl „dokumentiert“ aussieht (UI zeigt weiter das
  Muster, die Doku-Lücke ist im `AGENTS.md` vermerkt).
