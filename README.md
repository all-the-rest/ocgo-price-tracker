# Price Tracking for OpenCode Go

Scrapet täglich die Preistabelle von `https://opencode.ai/docs/de/go/` und
berechnet die Preise wahlweise auf Basis des vollen $60/Monat-Guthabens
(Effektivpreis = Listenpreis × 60/Nutzung) oder dessen, was man tatsächlich
zahlst ($10/Monat, Effektivpreis = Listenpreis × 10/Nutzung). Die Ergebnisse
werden als statische SolidJS-Seite unter `https://ocgo-pricing.all-the.rest`
bereitgestellt.

## Lokal entwickeln

Voraussetzungen:

- Node ≥ 22
- pnpm — die `packageManager`-Version aus `package.json` ist maßgeblich

```bash
pnpm install
pnpm scrape
pnpm test
pnpm dev
pnpm build
pnpm preview
pnpm typecheck
```

`pnpm scrape` funktioniert auch lokal ohne CI: Es holt die aktuellen Preise und
aktualisiert dabei `data/latest.json`, `data/history.json`, `CHANGELOG.json` und
`src/data/changelog.json`.

## Daten

- `data/latest.json` — aktueller Snapshot mit folgendem Schema:
  - `monthlyCredit` = 60 (voller Monatsbetrag in USD)
  - `monthlyCost` = 10 (laufender Abo-Preis)
  - `usage` = $15 oder $60 pro Modell
  - `multiplier` = 60 / usage
  - `effective*` = Preis × multiplier
  - `pattern` = Token-Muster pro Anfrage (Pflicht, wird per zod validiert)
  - `freeModels` = kostenlose Zen-Modelle mit `availableFrom`
- `data/history.json` — Chronologie aller Snapshots (`{ "snapshots": [...] }`)
- `CHANGELOG.json` — strukturierte Änderungs-Events (neuer + alter Preis bei Preisänderungen), wird per CI committet → Git-History
- `pnpm test` — Scraper-Unit-Tests gegen den HTML-Dump in `tests/fixtures/go-de.html`

## Deployment

GitHub Pages über den Workflow in `.github/workflows/price-tracker.yml`.
Läuft täglich per Cron `0 5 * * *` (UTC) und kann manuell über
`workflow_dispatch` im Actions-Tab angestoßen werden.

Custom Domain: `ocgo-pricing.all-the.rest` (CNAME-Datei in `public/`).

Setup:

1. Repo anlegen: `reisi007/ocgo-price-tracker`
2. Lokal initialisieren und pushen:

   ```bash
   git init -b main
   git add .
   git commit -m "Initial commit"
   git remote add origin git@github.com:reisi007/ocgo-price-tracker.git
   git push -u origin main
   ```

3. Im GitHub-Repo: Settings → Pages → Source "GitHub Actions", Custom domain
   `ocgo-pricing.all-the.rest` setzen.
4. DNS: CNAME `ocgo-pricing.all-the.rest` → `reisi007.github.io`

## Hinweise

Das `dist/`-Build enthält `data/latest.json` als statisches Artefakt — abrufbar
unter `/data/latest.json` auf der veröffentlichten Seite.
