# Price Tracking for OpenCode Go

Scrapet täglich die Preistabelle von `https://opencode.ai/docs/de/go/` und
berechnet die Preise wahlweise auf Basis des vollen Monatsguthabens
(Effektivpreis = Listenpreis × Guthaben/Nutzung) oder dessen, was man
tatsächlich zahlt (Monatspreis/Nutzung). Monatsguthaben und Monatspreis werden
dynamisch gefetchtt (Go-Landingpage `https://opencode.ai/de/go` → `$10/Monat`,
Doku-Seite → „das Sechsfache dieses Betrags“ → Guthaben `$60`; Fallback 60/10).
Die Ergebnisse werden als statische SolidJS-Seite unter
`https://ocgo-pricing.all-the.rest` bereitgestellt.

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
  - `monthlyCredit` = voller Monatsbetrag in USD (dynamisch aus Landingpage-Preis × Doku-Faktor, aktuell 60)
  - `monthlyCost` = laufender Abo-Preis (dynamisch aus der Landingpage, aktuell 10)
  - `usage` = $15 oder $60 pro Modell
  - `multiplier` = 60 / usage
  - `effective*` = Preis × multiplier
  - `pattern` = Token-Muster pro Anfrage (Pflicht, wird per zod validiert)
  - `peakHours` = UTC-Zeitfenster je normalisierter Modell-ID; Peak-/Off-Peak-Modelle stehen als getrennte `tier`-Zeilen in `models`
  - `freeModels` = kostenlose Zen-Modelle mit `availableFrom`
- `data/history.json` — Chronologie aller Snapshots (`{ "snapshots": [...] }`)
- `CHANGELOG.json` — strukturierte Änderungs-Events (neuer + alter Preis bei Preisänderungen), wird per CI committet → Git-History
- `pnpm test` — Scraper-Unit-Tests gegen den HTML-Dump in `tests/fixtures/go-de.html`

## Deployment

GitHub Pages über den Workflow in `.github/workflows/price-tracker.yml`.
Ein schedule-Cron (`20:28 UTC` ≈ 22:28 MEZ/MESZ) läuft täglich als Safety-Net.
Zusätzlich feuert ein externer Server-Cron alle 2h (06:00–20:00 Wochentage,
06:00+14:00 Wochenende) den Workflow via `workflow_dispatch`. Manuell über
`workflow_dispatch` im Actions-Tab oder `./scripts/install-cron.sh` anstoßen.

Custom Domain: `ocgo-pricing.all-the.rest` (CNAME-Datei in `public/`).

### Externer Cron (Server)

```bash
# Erstinstallation (token wird auf dem Server gespeichert):
GITHUB_PAT=ghp_xxx ./scripts/install-cron.sh

# Token erneuern (z.B. nach Ablauf):
GITHUB_PAT=ghp_yyy ./scripts/install-cron.sh

# Schedule aktualisieren (token wird vom Server wiederverwendet):
./scripts/install-cron.sh

# Deinstallieren:
./scripts/uninstall-cron.sh
```

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
