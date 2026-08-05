# AGENTS.md

## Projektüberblick

OpenCode-Go-Preistracker. Ein täglicher GitHub-Actions-Lauf scrapet
`https://opencode.ai/docs/de/go/`, berechnet die Preise auf Basis des vollen
`$60`/Monat-Guthabens (Effektivpreis = Listpreis × 60/Nutzung) und stellt eine
statische SolidJS-Seite unter `https://ocgo-pricing.all-the.rest` bereit.

- Repo (remote): `reisi007/ocgo-price-tracker`
- GitHub Pages Custom Domain: `ocgo-pricing.all-the.rest` (CNAME)
- Analytics: self-hosted `https://stats.all-the.rest/x7k2p.js` (Site-Alias `ocgo-pricing.all-the.rest` in stats-Dashboard registrieren)

## Stack

- SolidJS 1.9 + Vite 8 (`vite-plugin-solid`), TypeScript 7 (`tsc --noEmit`)
- Tailwind CSS 4 + daisyUI 5 — lokal gebündelt, **keine externen Fonts/Libs via URL**
- Scraper: Node ≥22, `scripts/scrape.mjs` mit cheerio (nur devDependency)
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

> **Changelog-Git-History:** `CHANGELOG.json` (strukturierte Änderungs-Events) wird bei jedem Lauf vom CI committet und gepusht
> (`git add CHANGELOG.json data src/data`) → vollständige Git-History der Preisänderungen.

## Datenmodell (`data/latest.json`)

```json
{
  "fetchedAt": "2026-08-05T22:00:00.000Z",
  "sourceUrl": "https://opencode.ai/docs/de/go/",
  "sourceLang": "de",
  "monthlyCredit": 60,
  "freeModels": [{ "id": "big-pickle", "availableFrom": "2026-08-05" }],
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
      "pattern": { "input": 1100, "cachedRead": 71500, "output": 220 }
    }
  ]
}
```

- `multiplier = 60 / usage` (usage ∈ {15, 60})
- `effective* = preis × multiplier`
- `pattern` = dokumentiertes Anfragemuster (Input/Cached/Output Tokens pro Anfrage) — **Pflicht** (zod). Kosten pro Anfrage = Muster × Modellpreis (Input: Input + Cached-Write, Cached: Cached Read, Output: Output). Fehlendes Muster bricht den Lauf rot ab.
- `freeModels` = kostenlose Zen-Modelle (ID enthält `free`) + `big-pickle` aus `https://opencode.ai/zen/v1/models`; `availableFrom` = erstes Beobachtungsdatum (bleibt über Läufe erhalten).
- `data/history.json` = `{ "snapshots": [ … ] }` (Chronologie, append)
- `CHANGELOG.json` = `{ "entries": [{ "date", "changes": [ … ] }] }`; Events: `baseline`, `model_added/removed`, `usage_changed`, `price_changed` (mit `from`/`to` = alter & neuer Preis), `free_added/removed` (mit `availableFrom`/`until`).

## Scraper-Regeln (`scripts/scrape.mjs`)

- Preistabelle über die **Header-Zeile** identifizieren (Zellen enthalten `Input` UND `Output`) — NICHT über `nth-child`-Selektoren.
- Preise: `$1.40` → `1.4`; `-` → `null`.
- `Nutzung` ist `$15` oder `$60`; Modellname mit `(… tokens)`-Suffix → `tier`-Feld.
- **Anfragemuster** (`Name — N Input-, M Cached-, K Output-Tokens pro Anfrage`) pro Modell extrahieren; Kurzschreibweisen (`GLM-5.2/5.1`, `Kimi K2.7/K2.6`) gegen die Modellnamen auflösen. Fehlende Muster über `PATTERN_FALLBACKS` (z. B. MiniMax M2.5 → M2.7) auffüllen.
- **zod-Validierung** (`validateSnapshot`): jedes Modell MUSS `pattern` haben; ungültige Daten → `process.exit(1)` → CI rot.
- Zen-Free-Models via `https://opencode.ai/zen/v1/models` (`extractFreeModels`), `availableFrom` aus dem vorherigen Lauf übernehmen (`mergeFreeModels`).
- Diff gegen das vorherige `latest.json`: Modell hinzugefügt/entfernt, Nutzung verbessert/verschlechtert, Preisänderungen (Float-Toleranz 1e-9) mit **altem und neuem Preis** (`from`/`to`), Free-Model-Events.
- CHANGELOG.json: neuer `{ date, changes }`-Eintrag oben, Datum UTC (`YYYY-MM-DD`), ein bestehender Eintrag mit demselben Datum wird ersetzt; Basis-Snapshot erzeugt **keine** Einzel-Events.
- **Parsing-Fehler** (keine Preistabelle, unerwartete Spaltenstruktur, unparsebare Werte) → `process.exit(1)` → CI-Lauf wird rot.

## UI-Regeln (daisyUI 5 / Tailwind 4)

- Nur daisyUI- und Tailwind-Klassen verwenden; Default-Varianten bevorzugen; daisyUI-Semantic-Colors (`base-*`, `primary`, `badge-success/-error/-warning/-info`), kein `dark:`-Präfix.
- Kein `tailwind.config.js` — Tailwind 4 braucht nur `@import "tailwindcss";` + `@plugin "daisyui";` in `src/index.css`.
- Sprache: localStorage `lang`, sonst Browser-Locale (automatisch `de` bei `navigator.language`-Präfix `de`); Default `en`. Theme via `theme-controller`-Checkbox (`value="dark"`), `basis` in localStorage.
- **Query-Params** (shareable URLs): `sort=field:asc|desc`, `fsort=…` (Free-Tabelle), `basis=list|full`, `lang=de|en` — beim Laden URL > localStorage, Änderungen via `history.replaceState`.
- Seitenstruktur: Kurzerklärung → Preistabelle (Sortierung je Spalte, `table-pin-cols` für horizontales Scrollen) → Free-Models-Tabelle (neuestes oben) → Changelog (JSON-Events, i18n-Texte, Badges) → Impressum/Datenschutz.
- Analytics-Skript (`stats.all-the.rest/x7k2p.js`, `defer`) gehört in `<head>` von `index.html`.

## CI/CD (`.github/workflows/price-tracker.yml`)

- Trigger: `schedule cron "0 5 * * *"`, `workflow_dispatch`, `push` auf `main`.
- Pipeline: install (`--frozen-lockfile`) → `pnpm test` → `pnpm scrape` → `pnpm build` → Commit (CHANGELOG.json + data + src/data, `github-actions[bot]`, nur bei Änderungen) → `upload-pages-artifact` (dist) + `upload-artifact` (dist-Zip) → `deploy-pages`.
- Ein fehlgeschlagenes `pnpm scrape` bricht die Pipeline ab (kein Commit/Deploy, Lauf rot).

## Verifikation

Nach jeder Umsetzung prüft ein **unabhängiger Agent**:
`pnpm scrape` (exit 0, korrekte Daten), `pnpm test` grün, `pnpm build` grün,
`dist/` enthält `data/latest.json` + `CNAME`, Workflow-YAML valide,
`pnpm preview` liefert 200 und der JSON-Endpunkt `/data/latest.json` antwortet.
Außerdem wird geprüft, dass **aktuelle Tool-Versionen** verwendet werden
(`pnpm outdated` ohne ungewollte Abweichungen, Node ≥22, pnpm aus `packageManager`).
