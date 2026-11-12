#!/usr/bin/env python3
"""Fetch RSS/Atom feeds listed in data/sources.json into data/articles.json.

Standard library only. Keeps headlines plus a short teaser and a link to the
original (no full-text copying). Scores items by recency, source weight and
topic (nuclear gets a boost), merges near-duplicate stories, keeps a rolling
window and moves older items into data/archive/YYYY-MM.json.
"""
import html
import json
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "articles.json"
ARCHIVE = DATA / "archive"
WINDOW_DAYS = 45
MAX_PER_SOURCE = 40
TEASER_CHARS = 220
UA = "EnergyHubBot/1.0 (+personal news reader; https://github.com/CaosOwl/energy-hub)"

NUCLEAR_KW = [
    "nuclear", "reactor", "smr", "small modular", "microreactor", "uranium", "haleu",
    "enrichment", "fission", "fusion", "tokamak", "stellarator", "iaea", "nrc", "ensi",
    "radioactive", "spent fuel", "thorium", "plutonium", "criticality", "isotope",
    "natrium", "bwrx", "nuscale", "terrapower", "x-energy", "kairos", "oklo", "rosatom",
    "westinghouse", "edf", "framatome", "candu", "gösgen", "goesgen", "leibstadt", "beznau",
    "decommission", "nagra", "geological repository",
]
TOPIC_KW = {
    "markets": ["price", "market", "tariff", "auction", "ppa", "contract", "futures",
                "wholesale", "capacity", "trading", "investment", "financing", "cost",
                "subsidy", "regulator", "entso", "acer", "grid fee", "spot"],
    "transition": ["renewable", "solar", "wind", "climate", "emission", "decarbon",
                   "net zero", "net-zero", "transition", "hydrogen", "electrification",
                   "heat pump", "carbon", "coal phase", " ev ", "electric vehicle"],
    "tech": ["battery", "storage", "grid", "transmission", "inverter", "electrolys",
             "geothermal", "turbine", "data center", "data centre", "superconduct"],
}


def strip_html(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def teaser(text):
    text = strip_html(text)
    if len(text) <= TEASER_CHARS:
        return text
    cut = text[:TEASER_CHARS].rsplit(" ", 1)[0]
    return cut + "…"


def parse_date(value):
    if not value:
        return None
    value = value.strip()
    try:
        d = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        d = None
    if d is None:
        try:
            d = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def child_text(el, *names):
    for c in el:
        if local(c.tag) in names and (c.text or "").strip():
            return c.text.strip()
    return ""


def parse_feed(raw):
    root = ET.fromstring(raw)
    items = []
    for el in root.iter():
        name = local(el.tag)
        if name not in ("item", "entry"):
            continue
        title = strip_html(child_text(el, "title"))
        link = ""
        for c in el:
            if local(c.tag) == "link":
                href = c.attrib.get("href")
                rel = c.attrib.get("rel", "alternate")
                if href and rel == "alternate":
                    link = href.strip()
                    break
                if (c.text or "").strip():
                    link = c.text.strip()
                    break
        if not link:
            link = child_text(el, "guid", "id")
        summary = child_text(el, "description", "summary", "content", "encoded")
        date = parse_date(child_text(el, "pubdate", "published", "updated", "date", "issued"))
        if title and link.startswith("http"):
            items.append({"title": title, "link": link, "summary": teaser(summary), "date": date})
    return items


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
        return r.read()


def fetch_source(s):
    """Returns (items, error). Never raises, so one bad feed cannot stop the run."""
    try:
        return parse_feed(fetch(s["feed"]))[:MAX_PER_SOURCE], None
    except Exception as e:
        return [], f"{type(e).__name__}: {e}"[:200]


def classify(text, source_topic):
    t = " " + text.lower() + " "
    tags = []
    nuclear_hits = sum(1 for k in NUCLEAR_KW if k in t)
    if nuclear_hits or source_topic == "nuclear":
        tags.append("nuclear")
    for topic, kws in TOPIC_KW.items():
        if any(k in t for k in kws):
            tags.append(topic)
    if source_topic in ("markets", "transition", "tech") and source_topic not in tags:
        tags.append(source_topic)
    return tags or ["general"], nuclear_hits


def score(item, weight, nuclear_hits, now):
    age_h = max((now - item["date"]).total_seconds() / 3600, 0) if item["date"] else 72
    recency = 1 / (1 + age_h / 36)  # halves after ~1.5 days
    boost = 1 + min(nuclear_hits, 4) * 0.25  # up to 2x for strongly nuclear stories
    return round(100 * recency * weight * boost, 2)


def norm_tokens(title):
    words = re.findall(r"[a-z0-9]+", title.lower())
    stop = {"the", "a", "an", "of", "to", "in", "for", "and", "on", "with", "at", "by", "as", "is", "its", "new"}
    return {w for w in words if w not in stop and len(w) > 2}


def similar(a, b):
    if not a or not b:
        return False
    return len(a & b) / len(a | b) >= 0.6


def main():
    now = datetime.now(timezone.utc)
    sources = json.loads((DATA / "sources.json").read_text())["sources"]
    previous = {}
    if OUT.exists():
        try:
            for it in json.loads(OUT.read_text()).get("items", []):
                previous[it["link"]] = it
        except (json.JSONDecodeError, KeyError):
            pass

    active = [s for s in sources if s.get("enabled", True) and s.get("feed") and s.get("access") != "paid"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch_source, active))

    cutoff = now - timedelta(days=WINDOW_DAYS)
    fresh, health = [], []
    for s, (items, error) in zip(active, results):
        entry = {"id": s["id"], "name": s["name"], "ok": error is None, "count": len(items), "error": error}
        if error is None and not items:
            # A feed that parses but is empty is almost always a moved or blocked feed.
            entry.update(ok=False, error="Feed returned no items")
        for it in items:
            seen = previous.get(it["link"])
            # Undated items keep the date they were first seen, so they age like the rest.
            date = it["date"] or (parse_date(seen["date"]) if seen else None) or now
            if date > now:
                date = now
            if date < cutoff and not seen:
                continue  # already older than the window: neither show nor archive
            tags, _ = classify(it["title"] + " " + it["summary"], s.get("topic", ""))
            fresh.append({
                "title": it["title"], "link": it["link"], "summary": it["summary"],
                "date": date.isoformat(timespec="minutes"),
                "source": s["id"], "sourceName": s["name"], "access": s.get("access", "open"),
                "region": s.get("region", ""), "tags": tags,
                "score": 0,  # set below, together with older items
            })
        health.append(entry)
        print(("OK  " if entry["ok"] else "ERR ") + s["id"], entry["count"], entry["error"] or "", file=sys.stderr)

    # merge with previous run (rescore old items so they decay)
    merged = dict(previous)
    for it in fresh:
        merged[it["link"]] = it
    for it in merged.values():
        d = parse_date(it["date"]) or now
        weight = next((float(s.get("weight", 1)) for s in sources if s["id"] == it["source"]), 1.0)
        nh = sum(1 for k in NUCLEAR_KW if k in (it["title"] + " " + it["summary"]).lower())
        it["score"] = score({"date": d}, weight, nh, now)

    keep, old = [], []
    for it in merged.values():
        (keep if (parse_date(it["date"]) or now) >= cutoff else old).append(it)

    # archive old items by month
    if old:
        ARCHIVE.mkdir(exist_ok=True)
        by_month = {}
        for it in old:
            by_month.setdefault(it["date"][:7], []).append(it)
        for month, items in by_month.items():
            p = ARCHIVE / f"{month}.json"
            existing = json.loads(p.read_text()) if p.exists() else []
            links = {i["link"] for i in existing}
            existing += [i for i in items if i["link"] not in links]
            p.write_text(json.dumps(existing, ensure_ascii=False, indent=1))

    # cluster near-duplicates: best-scored item becomes the lead, others attach as "also"
    keep.sort(key=lambda x: x["score"], reverse=True)
    leads = []
    for it in keep:
        it.pop("also", None)
    for it in keep:
        tok = norm_tokens(it["title"])
        for lead in leads:
            if lead["source"] != it["source"] and similar(lead["_tok"], tok):
                lead.setdefault("also", []).append({"sourceName": it["sourceName"], "link": it["link"]})
                break
        else:
            it["_tok"] = tok
            leads.append(it)
    for it in leads:
        it.pop("_tok", None)

    out = {
        "generated": now.isoformat(timespec="minutes"),
        "health": health,
        "items": leads,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    ok = sum(1 for h in health if h["ok"])
    print(f"{len(leads)} stories, {ok}/{len(health)} feeds ok", file=sys.stderr)


if __name__ == "__main__":
    main()
