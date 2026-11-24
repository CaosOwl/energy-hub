# Energy Hub

A personal, phone-installable reader for energy news with a nuclear focus, a reactor-builder tracker, a glossary you can grow over time and a curated reading list on energy system modelling. No server, no build step: GitHub Actions fetches the feeds and GitHub Pages hosts the app.

## Tabs

| Tab | What it shows | File you edit |
|---|---|---|
| **Feed** | Headlines + short teaser, ranked by recency, source weight and a nuclear boost. Near-duplicate stories are merged ("Also: …"). The coloured bar shows the share of stories per topic; tap a segment to filter. A blue dot marks stories that are new since your last visit. Saved stories are kept on the device even after they leave the feed. Glossary terms are underlined; tap for the definition. | `data/sources.json` (which feeds, weights) |
| **Builders** | Companies building new fission and fusion reactors, filterable by stage, each with a six-step progress track from concept to operation. "News in feed" searches the feed for that company. | `data/companies.json` |
| **Energy** | The main energy sources compared: mix over time for 55 countries and regions (electricity or primary energy, TWh or share), countries side by side, rankings, trends since 1990, and 19 technology metrics (LCOE, CAPEX, fixed/variable OPEX, learning rate, life-cycle CO₂, land, power density, water, minerals, deaths per TWh, capacity factor, EROI, build time, lifetime) as bars, scatter and a scorecard. Tags: clean (low-carbon), renewable, fossil. Every figure names its source. | `data/energy.json` (technology metrics); `data/energy-countries.json` is generated |
| **Glossary** | Terms by category and level, "learned" tracking, flashcards, add/edit on the phone. | `data/glossary.json` |
| **Models** | Compare up to three major energy outlooks (IEA, BNEF, DNV, IPCC and others) on 2050 metrics, electricity mix, warming and achievability, with your own likelihood score. Each model links to its original report and has an Assumptions and an Authors tab. | `data/scenarios.json` |
| **IPCC** | Every IPCC assessment report and the energy-relevant special reports by year, with main messages and a link to the report. | `data/ipcc.json` |
| **Literature** | Assessments, meta-studies, reviews and landmark papers on energy system modelling, grouped by theme, with a nuclear-relevant filter. | `data/literature.json` |
| **Sources** | Every source grouped by access (fetched / headlines only / visit directly / paid), with live feed status. | `data/sources.json` |

## Publish (one time)

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions** tab → *Fetch news and deploy* → **Run workflow**.
4. The site appears at `https://<user>.github.io/energy-hub/`.
5. On the phone, open it and *Add to Home Screen*.

After that, the workflow runs every 3 hours and on every push.

> GitHub Pages on a free account needs a **public** repo. Everything personal (saved stories, learned terms, glossary edits) stays in your phone's browser storage, not in the repo.

## Updating content

- **Sources:** edit `data/sources.json`. `enabled: false` mutes a source, `weight` (0.5–2.0) ranks it lower/higher. `access: "paid"` entries are listed but never fetched. To follow specific writers inside a big feed, add `"authors": ["Name"]` (matched against the byline) and/or `"mentions": ["Word"]` (matched against title and teaser); `"feeds": [...]` adds more feed URLs to the same source (e.g. several sections of one paper). Filtered sources that find nothing are not counted as failing. Il Foglio section feeds follow the pattern `https://naxos.ilfoglio.it/api/v5/rss/stories/<section>` (`economia`, `politica`, …).
- **Companies:** edit `data/companies.json`. `stage` is one of `concept`, `design`, `licensing`, `construction`, `critical`, `experiment`, `operating`. Add `"swiss": true` to tag a Swiss link.
- **Glossary:** edit `data/glossary.json` directly, or edit in the app and use **Export** to download the merged file, then replace `data/glossary.json` with it.
- **Literature:** edit `data/literature.json`. Each item needs `category` (one of the ids in `categories`), `type`, `title`, `authors`, `year`, `venue`, `finding`, `why`; always give a `doi` or `url` so the entry links to the original. `assumptions` (a list of sentences), `checked` (`full`, `summary` or `outline`: how closely the assumptions were checked against the study), `group` (a short note on the authors), `open` (link to a free version), `nuclear: true` and `perspective` are optional.
- **Models:** edit `data/scenarios.json`. `assumptions`, `checked` and `group` work as in the literature file.
- **IPCC reports:** edit `data/ipcc.json`. Each report has `year`, `released`, `kind` (`assessment`, `synthesis`, `special`, `upcoming`), `title`, `url`, `messages` (a list), and optional `attribution`, `energy` and `impact`.
- **Literature:** edit `data/literature.json`. Each item needs `category` (one of the ids in `categories`), `type`, `title`, `authors`, `year`, `venue`, `finding`, `why`; `doi` or `url`, `nuclear: true` and `perspective` are optional.
- **Energy sources:** edit `data/energy.json`. Each item's `values` holds, per metric id, a list of entries `{label?, v}` or `{label?, lo, hi}` with an optional `note`; `existing: true` marks existing-plant costs. Add new references to `refs`. Country data is rebuilt weekly by the workflow from the Our World in Data GitHub dataset (`python3 scripts/build_energy_data.py --force` to do it by hand).
- **Failing feeds:** the Feed tab shows "N of M feeds failing" and the Sources tab shows the error. Fix the address, or set `"feed": null` to list the source as visit-directly. A feed that answers but is empty also counts as failing.

## Run locally

```bash
python3 scripts/fetch_feeds.py      # fills data/articles.json
python3 -m http.server 8000         # open http://localhost:8000
```

## How the feed works

`scripts/fetch_feeds.py` (Python standard library only) reads RSS/Atom feeds, keeps the title, a ≤220-character teaser and the link (no full-text copying), tags each story (nuclear / markets / transition / tech), scores it, merges duplicates across sources, keeps the date an undated story was first seen (so it ages normally), keeps a 45-day window in `data/articles.json` and moves older items to `data/archive/YYYY-MM.json`.

## Look and offline behaviour

- Colours follow a reactor pool: deep water, Cherenkov blue, yellowcake. Light and dark themes; the button in the top bar cycles device / dark / light.
- Fonts are bundled in `assets/fonts` (Archivo and Source Serif 4, both SIL Open Font License), so the app works offline and loads nothing from third parties.
- `sw.js` always asks the network first (bypassing the browser cache), so a new deploy shows on the next open when online; offline it falls back to the last saved copy.

## Ideas for later

- Scraping for sources without feeds (OECD NEA, BFE, Swissgrid, ACER)
- ENTSO-E / Energy-Charts panel with Swiss and European power prices
- LLM layer: 2-line summaries per story and a weekly "Learn" card
- Daily digest notification
