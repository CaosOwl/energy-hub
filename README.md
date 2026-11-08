# Energy Hub

A personal, phone-installable reader for energy news with a nuclear focus, a reactor-builder tracker and a glossary you can grow over time. No server, no build step: GitHub Actions fetches the feeds and GitHub Pages hosts the app.

## Tabs

| Tab | What it shows | File you edit |
|---|---|---|
| **Feed** | Headlines + short teaser, ranked by recency, source weight and a nuclear boost. Near-duplicate stories are merged ("Also: …"). Save with ☆. Glossary terms are underlined; tap for the definition. | `data/sources.json` (which feeds, weights) |
| **Builders** | Companies building new fission and fusion reactors, filterable by stage. "News in feed" searches the feed for that company. | `data/companies.json` |
| **Glossary** | Terms by category and level, "learned" tracking, flashcards, add/edit on the phone. | `data/glossary.json` |
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

- **Sources:** edit `data/sources.json`. `enabled: false` mutes a source, `weight` (0.5–2.0) ranks it lower/higher. `access: "paid"` entries are listed but never fetched.
- **Companies:** edit `data/companies.json`. `stage` is one of `concept`, `design`, `licensing`, `construction`, `critical`, `experiment`, `operating`. Add `"swiss": true` to tag a Swiss link.
- **Glossary:** edit `data/glossary.json` directly, or edit in the app and use **Export** to download the merged file, then replace `data/glossary.json` with it.
- **Failing feeds:** the Feed tab shows "⚠ N feeds failing". Fix the URL or disable the source.

## Run locally

```bash
python3 scripts/fetch_feeds.py      # fills data/articles.json
python3 -m http.server 8000         # open http://localhost:8000
```

## How the feed works

`scripts/fetch_feeds.py` (Python standard library only) reads RSS/Atom feeds, keeps the title, a ≤220-character teaser and the link (no full-text copying), tags each story (nuclear / markets / transition / tech), scores it, merges duplicates across sources, keeps a 45-day window in `data/articles.json` and moves older items to `data/archive/YYYY-MM.json`.

## Ideas for later

- Scraping for sources without feeds (OECD NEA, BFE, Swissgrid, ACER)
- ENTSO-E / Energy-Charts panel with Swiss and European power prices
- LLM layer: 2-line summaries per story and a weekly "Learn" card
- Daily digest notification
