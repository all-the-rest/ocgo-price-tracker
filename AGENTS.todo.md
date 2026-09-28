# AGENTS.todo.md — ocgo-price-tracker

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
- [ ] **Nicht bewertet (bewusst offen):** In den Element-Aufnahmen überlagert der Sticky-Header mittig
  Inhalt (weiße Bande im Changelog, Filterzeile in sec1). Aus einem Bild nicht sicher als Defekt zu
  entscheiden — gehört in einen gezielten Test mit Deep-Link auf `#privacy`/`#changelog` (springt der
  Anker unter den Header?), nicht in einen visuellen Report.

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
