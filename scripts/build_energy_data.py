#!/usr/bin/env python3
"""Build data/energy-countries.json for the Energy sources tab.

Source: Our World in Data energy dataset (github.com/owid/energy-data), which
combines Ember (electricity, latest year) and the Energy Institute Statistical
Review (primary energy). Python standard library only.

Usage:
    python scripts/build_energy_data.py            # refresh if older than 7 days
    python scripts/build_energy_data.py --force    # always refresh
    python scripts/build_energy_data.py --csv path/to/owid-energy-data.csv
"""
import csv
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

URL = "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "energy-countries.json")
FIRST_YEAR = 1990
MAX_AGE = timedelta(days=7)

# id -> (label, OWID name, group)
ENTITIES = [
    ("world", "World", "World", "region"),
    ("europe", "Europe", "Europe", "region"),
    ("eu", "European Union", "European Union (27)", "region"),
    ("n-america", "North America", "North America", "region"),
    ("s-america", "South America", "South America", "region"),
    ("asia", "Asia", "Asia", "region"),
    ("africa", "Africa", "Africa", "region"),
    ("oceania", "Oceania", "Oceania", "region"),
    ("oecd", "OECD", "OECD (Ember)", "region"),
    ("ch", "Switzerland", "Switzerland", "europe"),
    ("de", "Germany", "Germany", "europe"),
    ("fr", "France", "France", "europe"),
    ("it", "Italy", "Italy", "europe"),
    ("at", "Austria", "Austria", "europe"),
    ("gb", "United Kingdom", "United Kingdom", "europe"),
    ("es", "Spain", "Spain", "europe"),
    ("pt", "Portugal", "Portugal", "europe"),
    ("nl", "Netherlands", "Netherlands", "europe"),
    ("be", "Belgium", "Belgium", "europe"),
    ("dk", "Denmark", "Denmark", "europe"),
    ("se", "Sweden", "Sweden", "europe"),
    ("no", "Norway", "Norway", "europe"),
    ("fi", "Finland", "Finland", "europe"),
    ("pl", "Poland", "Poland", "europe"),
    ("cz", "Czechia", "Czechia", "europe"),
    ("sk", "Slovakia", "Slovakia", "europe"),
    ("hu", "Hungary", "Hungary", "europe"),
    ("ro", "Romania", "Romania", "europe"),
    ("ua", "Ukraine", "Ukraine", "europe"),
    ("ru", "Russia", "Russia", "europe"),
    ("tr", "Turkey", "Turkey", "asia"),
    ("us", "United States", "United States", "americas"),
    ("ca", "Canada", "Canada", "americas"),
    ("mx", "Mexico", "Mexico", "americas"),
    ("br", "Brazil", "Brazil", "americas"),
    ("ar", "Argentina", "Argentina", "americas"),
    ("cl", "Chile", "Chile", "americas"),
    ("cn", "China", "China", "asia"),
    ("in", "India", "India", "asia"),
    ("jp", "Japan", "Japan", "asia"),
    ("kr", "South Korea", "South Korea", "asia"),
    ("tw", "Taiwan", "Taiwan", "asia"),
    ("id", "Indonesia", "Indonesia", "asia"),
    ("vn", "Vietnam", "Vietnam", "asia"),
    ("pk", "Pakistan", "Pakistan", "asia"),
    ("sa", "Saudi Arabia", "Saudi Arabia", "asia"),
    ("ae", "United Arab Emirates", "United Arab Emirates", "asia"),
    ("ir", "Iran", "Iran", "asia"),
    ("eg", "Egypt", "Egypt", "africa"),
    ("za", "South Africa", "South Africa", "africa"),
    ("ng", "Nigeria", "Nigeria", "africa"),
    ("ke", "Kenya", "Kenya", "africa"),
    ("ma", "Morocco", "Morocco", "africa"),
    ("au", "Australia", "Australia", "oceania"),
    ("nz", "New Zealand", "New Zealand", "oceania"),
]

# App source id -> OWID column stem. "bio" folds in geothermal and other renewables.
SOURCES = ["coal", "oil", "gas", "nuclear", "bio", "hydro", "wind", "solar"]
ELEC = {"coal": ["coal_electricity"], "oil": ["oil_electricity"], "gas": ["gas_electricity"],
        "nuclear": ["nuclear_electricity"], "hydro": ["hydro_electricity"], "wind": ["wind_electricity"],
        "solar": ["solar_electricity"], "bio": ["other_renewable_electricity"]}  # = biofuel + other renewables
PRIMARY = {"coal": ["coal_consumption"], "oil": ["oil_consumption"], "gas": ["gas_consumption"],
           "nuclear": ["nuclear_consumption"], "hydro": ["hydro_consumption"], "wind": ["wind_consumption"],
           "solar": ["solar_consumption"], "bio": ["other_renewable_consumption", "biofuel_consumption"]}
EXTRA = {"pop": "population", "elecpc": "per_capita_electricity", "ci": "carbon_intensity_elec",
         "demand": "electricity_demand", "imports": "net_elec_imports_share_demand", "energypc": "energy_per_capita"}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def rnd(v, d=1):
    if v is None:
        return None
    if abs(v) >= 1000:
        return round(v)
    return round(v, d)


def fresh_enough():
    try:
        with open(OUT, encoding="utf-8") as f:
            gen = json.load(f).get("generated")
        return datetime.now(timezone.utc) - datetime.fromisoformat(gen) < MAX_AGE
    except Exception:
        return False


def main():
    args = sys.argv[1:]
    if "--force" not in args and "--csv" not in args and fresh_enough():
        print("energy-countries.json is less than 7 days old; skipping (use --force).")
        return
    if "--csv" in args:
        text = open(args[args.index("--csv") + 1], encoding="utf-8").read()
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "energy-hub/1.0"})
        text = urllib.request.urlopen(req, timeout=120).read().decode("utf-8")
    rows = {}
    for r in csv.DictReader(io.StringIO(text)):
        rows.setdefault(r["country"], {})[int(r["year"])] = r

    # Last year with electricity data for the World, last year with primary energy.
    world = rows["World"]
    last_e = max(y for y, r in world.items() if num(r["electricity_generation"]))
    last_p = max(y for y, r in world.items() if num(r["primary_energy_consumption"]))
    years = list(range(FIRST_YEAR, max(last_e, last_p) + 1))

    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "source": "Our World in Data energy dataset (Ember; Energy Institute Statistical Review)",
           "url": "https://github.com/owid/energy-data",
           "years": years, "lastElec": last_e, "lastPrimary": last_p,
           "sources": SOURCES, "entities": []}

    for eid, label, owid, group in ENTITIES:
        data = rows.get(owid)
        if not data:
            print("missing", owid, file=sys.stderr)
            continue

        def series(cols):
            vals = []
            for y in years:
                r = data.get(y)
                parts = [num(r.get(c)) for c in cols] if r else [None]
                parts = [p for p in parts if p is not None]
                vals.append(rnd(sum(parts)) if parts else None)
            return vals

        ent = {"id": eid, "name": label, "group": group,
               "elec": {s: series(ELEC[s]) for s in SOURCES},
               "primary": {s: series(PRIMARY[s]) for s in SOURCES}}
        for k, col in EXTRA.items():
            ent[k] = [rnd(num(data[y].get(col)), 2 if k == "imports" else 1) if y in data else None for y in years]
        # Drop sources that are always empty to keep the file small.
        for kind in ("elec", "primary"):
            if all(v is None for s in SOURCES for v in ent[kind][s]):
                ent[kind] = None
        out["entities"].append(ent)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {len(out['entities'])} entities, {years[0]}–{years[-1]} (electricity to {last_e}, primary to {last_p}).")


if __name__ == "__main__":
    main()
