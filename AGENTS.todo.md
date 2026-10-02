# AGENTS.todo.md — ocgo-price-tracker

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
  `https://opencode.ai/docs/de/go/` nennt **keine** Feiertage (de **und** en). „excluding Chinese
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

## Browser-Konsolen-Test (Playwright, Follow-up zum Smoke-Test)
- [ ] Playwright-Test, der die Seite im echten Browser lädt und Konsolen-Fehler/pageerrors
  als Fehler wertet (fängt JS-Laufzeitfehler, die Build + `pnpm smoke` nicht sehen).
  Eigene Suite/config (nicht in die Screenshot-Suite — die bleibt assertion-frei),
  in CI nach dem Smoke-Step. Browser via Container-Image oder `playwright install`.
