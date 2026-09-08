# AGENTS.todo.md — ocgo-price-tracker

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
