/* Energy Hub — vanilla JS, no build step. Data lives in /data/*.json. */
(() => {
  "use strict";

  // ---------- storage helpers (never throw) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("eh." + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem("eh." + key, JSON.stringify(value)); } catch {} },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const keyOf = (term) => String(term).trim().toLowerCase();

  const PAGE = 40;
  const VIEWS = ["feed", "companies", "glossary", "scenarios", "literature", "sources"];
  const TOPICS = [["nuclear", "Nuclear"], ["markets", "Markets"], ["transition", "Transition"], ["tech", "Tech"], ["general", "General"]];
  const CATS = [["nuclear", "Nuclear"], ["markets", "Markets"], ["transition", "Transition"], ["tech", "Tech"], ["modelling", "Modelling"]];
  const LABEL = Object.fromEntries([...TOPICS, ...CATS, ["data", "Data"], ["learning", "Learning"]]);
  // Six steps on the builders' progress track; "critical" and "experiment" both mean a test device is running.
  const STAGES = ["concept", "design", "licensing", "construction", "critical", "experiment", "operating"];
  const STAGE_STEP = { concept: 1, design: 2, licensing: 3, construction: 4, critical: 5, experiment: 5, operating: 6 };
  const STAGE_LABEL = { concept: "Concept", design: "Design", licensing: "Licensing", construction: "Construction", critical: "Test reactor critical", experiment: "Experiment running", operating: "Operating" };
  const REGION = { global: "Global", us: "US", eu: "EU", ch: "Switzerland", uk: "UK" };
  const ICON_SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h11v16.5l-5.5-4-5.5 4z"/></svg>';

  // Stories newer than the previous visit get a marker. The threshold stays fixed for the browser session.
  const since = (() => {
    let s = null;
    try { s = sessionStorage.getItem("eh.since"); } catch {}
    if (s == null) {
      s = store.get("lastVisit", "");
      try { sessionStorage.setItem("eh.since", s); } catch {}
      store.set("lastVisit", new Date().toISOString());
    }
    return s ? Date.parse(s) : 0;
  })();

  // Saved stories keep their own copy, so they survive the feed's 45-day window.
  function loadSaved() {
    const m = store.get("savedItems", null);
    return m && typeof m === "object" ? new Map(Object.entries(m)) : new Map();
  }

  const state = {
    articles: { items: [], health: [], generated: null },
    sources: [],
    companies: { companies: [], updated: "" },
    glossaryBase: { _about: "", terms: [] },
    literature: { about: "", updated: "", categories: [], items: [] },
    saved: loadSaved(),
    learned: new Set(store.get("learned", [])),
    glLocal: store.get("glossaryLocal", { added: [], edited: {}, deleted: [] }),
    feed: { q: "", topic: "all", sort: "score", shown: PAGE },
    co: { q: "", kind: "all", stage: "all" },
    gl: { q: "", cat: "all", level: 0, hideLearned: false },
    lit: { q: "", cat: "all", sort: "category", nuclear: false },
    scen: { scenarios: [], metrics: [] },
    sc: { sel: store.get("scSel", ["iea-steps", "iea-nze", "dnv-eto"]), mine: store.get("scMine", {}), group: "all", type: "all" },
  };

  // ---------- theme ----------
  function applyTheme() {
    const t = store.get("theme", "system");
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    const label = { system: "Theme: follows your device", dark: "Theme: dark", light: "Theme: light" }[t];
    $("#theme-btn").title = label;
    $("#theme-btn").setAttribute("aria-label", label + ". Tap to change.");
  }
  $("#theme-btn").addEventListener("click", () => {
    const order = ["system", "dark", "light"];
    store.set("theme", order[(order.indexOf(store.get("theme", "system")) + 1) % order.length]);
    applyTheme();
  });

  // ---------- navigation (also via #feed, #glossary … so views can be bookmarked) ----------
  function show(view, push = true) {
    if (!VIEWS.includes(view)) view = "feed";
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== "view-" + view));
    $$(".tabbar button").forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    const title = $("#view-" + view).dataset.title;
    $("#view-title").textContent = title;
    document.title = title + " · Energy Hub";
    store.set("view", view);
    if (push && location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
    window.scrollTo(0, 0);
  }
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1), false));

  // ---------- data ----------
  async function load(path, fallback) {
    try {
      const r = await fetch(path, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch { return fallback; }
  }

  // ---------- small render helpers ----------
  const tag = (t) => `<span class="tag c-${esc(t)}"><span class="dot"></span>${esc(LABEL[t] || t)}</span>`;
  const chip = (attr, value, label, on, n, colour) =>
    `<button class="chip ${colour ? "c-" + esc(colour) : ""} ${on ? "on" : ""}" ${attr}="${esc(value)}" aria-pressed="${on}">${colour ? '<span class="dot"></span>' : ""}${esc(label)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
  const level = (n) => `<span class="lvl" role="img" aria-label="Level ${n || 1} of 3">${[1, 2, 3].map((i) => `<i class="${i <= (n || 1) ? "f" : ""}"></i>`).join("")}</span>`;
  const empty = (title, hint = "") => `<li class="empty"><strong>${title}</strong>${hint}</li>`;
  function segOn(container, btn) { $$("button", container).forEach((x) => x.classList.toggle("on", x === btn)); }

  // ---------- glossary model ----------
  function glossary() {
    const { added, edited, deleted } = state.glLocal;
    const del = new Set(deleted.map(keyOf));
    const out = [];
    for (const t of state.glossaryBase.terms) {
      const k = keyOf(t.term);
      if (del.has(k)) continue;
      out.push(edited[k] ? { ...edited[k], _local: true } : t);
    }
    for (const t of added) if (!del.has(keyOf(t.term))) out.push({ ...t, _local: true });
    return out.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
  }
  function findTerm(name) { return glossary().find((t) => keyOf(t.term) === keyOf(name)); }
  function saveLocal() { store.set("glossaryLocal", state.glLocal); }

  // highlight glossary terms inside already-escaped text (first hit per term)
  let hlRegex = null, hlMap = null;
  function buildHighlighter() {
    hlMap = new Map();
    for (const t of glossary()) {
      for (const label of [t.term, t.full]) {
        if (label && label.length >= 3) hlMap.set(esc(label).toLowerCase(), t.term);
      }
    }
    const parts = [...hlMap.keys()].sort((a, b) => b.length - a.length)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    hlRegex = parts.length ? new RegExp("(?<![\\w&])(" + parts.join("|") + ")(?![\\w;])", "gi") : null;
  }
  function highlight(escaped) {
    if (!hlRegex) return escaped;
    const seen = new Set();
    return escaped.replace(hlRegex, (m) => {
      const term = hlMap.get(m.toLowerCase());
      // acronyms (all caps in glossary) must match case exactly
      if (!term || (term === term.toUpperCase() && /[A-Z]/.test(term) && m !== m.toUpperCase())) return m;
      if (seen.has(term)) return m;
      seen.add(term);
      return `<button class="term-hl" data-term="${esc(term)}">${m}</button>`;
    });
  }

  // ---------- FEED ----------
  function relTime(iso) {
    if (!iso) return "";
    const d = new Date(iso), s = (Date.now() - d) / 1000;
    if (isNaN(s)) return "";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 7) return Math.round(s / 86400) + " d ago";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  const primary = (i) => (i.tags || [])[0] || "general";
  const isNew = (i) => since && Date.parse(i.date) > since;

  function renderFeedFilters() {
    const items = state.articles.items;
    const counts = {}, lead = {};
    for (const it of items) {
      for (const t of it.tags || []) counts[t] = (counts[t] || 0) + 1;
      lead[primary(it)] = (lead[primary(it)] || 0) + 1;
    }
    const { topic } = state.feed;
    // The mix bar shows each topic's share of stories, like an energy-mix chart; tap a segment to filter.
    $("#feed-mix").innerHTML = TOPICS.filter(([k]) => lead[k]).map(([k, label]) =>
      `<button class="c-${k} ${topic !== "all" && topic !== k ? "dim" : ""}" style="flex:${lead[k]} 1 0" data-topic="${k}" title="${label}: ${lead[k]} stories" aria-label="${label}: ${lead[k]} stories"></button>`).join("");
    $("#feed-chips").innerHTML = chip("data-topic", "all", "All", topic === "all", items.length || null) +
      TOPICS.filter(([k]) => counts[k]).map(([k, label]) => chip("data-topic", k, label, topic === k, counts[k], k)).join("");
  }

  function storyHTML(i, lead) {
    const saved = state.saved.has(i.link);
    const also = i.also?.length ? `<span class="also">Also covered by ${i.also.map((a) => `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.sourceName)}</a>`).join(", ")}</span>` : "";
    const body = `
      <div class="meta">${isNew(i) ? '<span class="fresh" title="New since your last visit"></span>' : ""}<strong>${esc(i.sourceName)}</strong><span>${relTime(i.date)}</span>${i.access === "partial" ? "<span>may be paywalled</span>" : ""}${(i.tags || []).map(tag).join("")}</div>
      <${lead ? "h2" : "h3"}><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></${lead ? "h2" : "h3"}>
      ${i.summary ? `<p>${highlight(esc(i.summary))}</p>` : ""}
      <div class="story-foot">${also}<button class="save ${saved ? "on" : ""}" data-save="${esc(i.link)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save story"}">${ICON_SAVE}</button></div>`;
    return lead ? `<article class="lead">${body}</article>` : `<li class="story c-${esc(primary(i))}">${body}</li>`;
  }

  function feedItems() {
    const { q, topic, sort } = state.feed;
    let items = sort === "saved" ? [...state.saved.values()] : state.articles.items.slice();
    if (topic !== "all") items = items.filter((i) => (i.tags || []).includes(topic));
    if (q) {
      const ql = q.toLowerCase();
      items = items.filter((i) => (i.title + " " + i.summary + " " + i.sourceName).toLowerCase().includes(ql));
    }
    return items.sort(sort === "score" ? (a, b) => b.score - a.score : (a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  function renderFeed() {
    renderFeedFilters();
    const { q, topic, sort, shown } = state.feed;
    const items = feedItems();
    const list = $("#feed-list"), leadBox = $("#feed-lead"), more = $("#feed-more");
    leadBox.innerHTML = ""; more.classList.add("hidden");

    if (!items.length) {
      list.innerHTML = sort === "saved" ? empty("Nothing saved yet", "Tap the bookmark on a story to keep it here.")
        : !state.articles.generated ? empty("No stories yet", "The first scheduled run fills the feed. The other tabs work already.")
        : empty("No stories match", "Try another topic or clear the search.");
      return;
    }
    // The top-ranked story opens the page when nothing is filtered.
    const withLead = sort === "score" && !q && topic === "all";
    if (withLead) leadBox.innerHTML = storyHTML(items[0], true);
    const rest = withLead ? items.slice(1) : items;
    list.innerHTML = rest.slice(0, shown).map((i) => storyHTML(i, false)).join("");
    if (rest.length > shown) { more.textContent = `Show more stories (${rest.length - shown} left)`; more.classList.remove("hidden"); }
  }

  function renderHealth() {
    const h = state.articles.health || [];
    const btn = $("#health-btn");
    if (!h.length) { btn.textContent = ""; return; }
    const bad = h.filter((x) => !x.ok);
    btn.textContent = bad.length ? `${bad.length} of ${h.length} feeds failing` : `All ${h.length} feeds working`;
    btn.style.color = bad.length ? "var(--warn)" : "var(--muted)";
    $("#health-panel").innerHTML = bad.length
      ? `<strong>Feeds that failed on the last run</strong><ul>${bad.map((b) => `<li>${esc(b.name)} <span class="muted">${esc(b.error || "unknown error")}</span></li>`).join("")}</ul><p class="muted small">Fix the feed address in <code>data/sources.json</code>, or set <code>"feed": null</code> to list the source as visit-directly.</p>`
      : "Every feed was fetched on the last run.";
  }

  function setTopic(t) { state.feed.topic = state.feed.topic === t && t !== "all" ? "all" : t; state.feed.shown = PAGE; renderFeed(); }
  function toggleSave(link) {
    if (state.saved.has(link)) state.saved.delete(link);
    else { const it = state.articles.items.find((i) => i.link === link); if (it) state.saved.set(link, it); }
    store.set("savedItems", Object.fromEntries(state.saved));
    renderFeed();
  }
  function feedClick(e) {
    const s = e.target.closest("[data-save]");
    if (s) return toggleSave(s.dataset.save);
    const t = e.target.closest("[data-term]");
    if (t) openTerm(t.dataset.term);
  }
  $("#health-btn").addEventListener("click", () => $("#health-panel").classList.toggle("hidden"));
  $("#feed-search").addEventListener("input", (e) => { state.feed.q = e.target.value.trim(); state.feed.shown = PAGE; renderFeed(); });
  for (const id of ["#feed-chips", "#feed-mix"]) $(id).addEventListener("click", (e) => { const b = e.target.closest("[data-topic]"); if (b) setTopic(b.dataset.topic); });
  $("#feed-sort").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]"); if (!b) return;
    state.feed.sort = b.dataset.sort; state.feed.shown = PAGE;
    segOn($("#feed-sort"), b); renderFeed();
  });
  $("#feed-more").addEventListener("click", () => { state.feed.shown += PAGE; renderFeed(); });
  $("#feed-list").addEventListener("click", feedClick);
  $("#feed-lead").addEventListener("click", feedClick);

  // ---------- COMPANIES ----------
  function trackHTML(stage) {
    const step = STAGE_STEP[stage] || 1;
    const bars = [1, 2, 3, 4, 5, 6].map((n) => `<i class="${n < step ? "done" : n === step ? "now" : ""}"></i>`).join("");
    return `<div class="track"><div class="track-bar" role="img" aria-label="Step ${step} of 6: ${esc(STAGE_LABEL[stage] || stage)}">${bars}</div>
      <div class="track-label"><strong>${esc(STAGE_LABEL[stage] || stage)}</strong><span>step ${step} of 6</span></div></div>`;
  }

  function renderCompanies() {
    const all = state.companies.companies || [];
    const { q, kind, stage } = state.co;
    const nKind = (k) => all.filter((c) => (k === "swiss" ? c.swiss : c.kind === k)).length;
    $("#co-kind").innerHTML = [["all", "All", all.length], ["fission", "Fission", nKind("fission")], ["fusion", "Fusion", nKind("fusion")], ["swiss", "Swiss link", nKind("swiss")]]
      .filter(([k, , n]) => k === "all" || n).map(([k, l, n]) => chip("data-kind", k, l, kind === k, n)).join("");
    const present = STAGES.filter((s) => all.some((c) => c.stage === s));
    $("#co-stage").innerHTML = chip("data-stage", "all", "Any stage", stage === "all") +
      present.map((s) => chip("data-stage", s, STAGE_LABEL[s], stage === s, all.filter((c) => c.stage === s).length)).join("");
    $("#co-note").textContent = state.companies.updated
      ? `${all.length} companies, milestones checked ${state.companies.updated}. This field moves fast, so verify before relying on details.` : "";

    const ql = q.toLowerCase();
    const list = all.filter((c) =>
      (kind === "all" || (kind === "swiss" ? c.swiss : c.kind === kind)) &&
      (stage === "all" || c.stage === stage) &&
      (!ql || [c.name, c.design, c.tech, c.country, c.milestone].join(" ").toLowerCase().includes(ql)));
    list.sort((a, b) => (STAGE_STEP[b.stage] || 0) - (STAGE_STEP[a.stage] || 0) || a.name.localeCompare(b.name));

    $("#co-list").innerHTML = list.length ? list.map((c) => {
      const url = c.url || `https://duckduckgo.com/?q=${encodeURIComponent(c.name + " " + c.design + " reactor")}`;
      return `<li class="card">
        <div class="co-head">
          <div><h3>${esc(c.name)}${c.swiss ? '<span class="swiss" title="Swiss link">CH</span>' : ""}</h3>
          <div class="design">${esc(c.design)}, ${esc(c.country)}</div></div>
          <span class="kind">${c.kind === "fusion" ? "Fusion" : "Fission"}</span>
        </div>
        ${trackHTML(c.stage)}
        <dl class="facts"><dt>Technology</dt><dd>${highlight(esc(c.tech))}</dd><dt>Power</dt><dd>${esc(c.power)}</dd></dl>
        <p>${esc(c.milestone)}</p>
        <div class="card-actions"><a href="${esc(url)}" target="_blank" rel="noopener">${c.url ? "Website" : "Search the web"}</a><button class="link" data-news="${esc(c.name)}">News in feed</button></div>
      </li>`;
    }).join("") : empty("No companies match", "Clear a filter to see more.");
  }
  $("#co-search").addEventListener("input", (e) => { state.co.q = e.target.value.trim(); renderCompanies(); });
  $("#co-kind").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) { state.co.kind = b.dataset.kind; renderCompanies(); } });
  $("#co-stage").addEventListener("click", (e) => { const b = e.target.closest("[data-stage]"); if (b) { state.co.stage = b.dataset.stage; renderCompanies(); } });
  $("#co-list").addEventListener("click", (e) => {
    const n = e.target.closest("[data-news]");
    if (n) {
      Object.assign(state.feed, { q: n.dataset.news, topic: "all", sort: "date", shown: PAGE });
      $("#feed-search").value = n.dataset.news;
      segOn($("#feed-sort"), $('#feed-sort [data-sort="date"]'));
      renderFeed(); show("feed"); return;
    }
    const t = e.target.closest("[data-term]"); if (t) openTerm(t.dataset.term);
  });

  // ---------- GLOSSARY ----------
  function filteredTerms() {
    const { q, cat, level: lv, hideLearned } = state.gl;
    const ql = q.toLowerCase();
    return glossary().filter((t) =>
      (cat === "all" || t.category === cat) &&
      (!lv || t.level === lv) &&
      (!hideLearned || !state.learned.has(keyOf(t.term))) &&
      (!ql || [t.term, t.full, t.definition].join(" ").toLowerCase().includes(ql)));
  }

  function renderGlossary() {
    const all = glossary();
    $("#gl-cat").innerHTML = chip("data-cat", "all", "All", state.gl.cat === "all", all.length) +
      CATS.map(([k, l]) => [k, l, all.filter((t) => t.category === k).length]).filter(([, , n]) => n)
        .map(([k, l, n]) => chip("data-cat", k, l, state.gl.cat === k, n, k)).join("");
    const learnedN = all.filter((t) => state.learned.has(keyOf(t.term))).length;
    $("#gl-progress").textContent = `${learnedN} of ${all.length} learned`;
    $("#gl-bar").style.width = (all.length ? (100 * learnedN) / all.length : 0) + "%";
    $("#gl-unlearned").textContent = state.gl.hideLearned ? "Show learned" : "Hide learned";

    const list = filteredTerms();
    $("#gl-list").innerHTML = list.length ? list.map((t) => {
      const learned = state.learned.has(keyOf(t.term));
      return `<li class="card ${learned ? "learned" : ""}">
        <div class="gl-head"><h3>${esc(t.term)}</h3>${level(t.level)}</div>
        ${t.full ? `<div class="full">${esc(t.full)}</div>` : ""}
        <p>${esc(t.definition)}</p>
        <div class="meta" style="margin-top:10px">${tag(t.category)}${t._local ? '<span class="badge-local">edited on this device</span>' : ""}</div>
        ${t.related?.length ? `<div class="related">${t.related.map((r) => `<button data-term="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
        <div class="card-actions"><button class="link" data-learn="${esc(t.term)}">${learned ? "Learned ✓" : "Mark as learned"}</button><button class="link" data-edit="${esc(t.term)}">Edit</button></div>
      </li>`;
    }).join("") : empty("No terms match", "Clear a filter, or add the term yourself.");
  }

  $("#gl-search").addEventListener("input", (e) => { state.gl.q = e.target.value.trim(); renderGlossary(); });
  $("#gl-cat").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { state.gl.cat = b.dataset.cat; renderGlossary(); } });
  $("#gl-level").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]"); if (!b) return;
    state.gl.level = +b.dataset.level; segOn($("#gl-level"), b); renderGlossary();
  });
  $("#gl-unlearned").addEventListener("click", () => { state.gl.hideLearned = !state.gl.hideLearned; renderGlossary(); });
  $("#gl-list").addEventListener("click", (e) => {
    const l = e.target.closest("[data-learn]");
    if (l) { toggleLearned(l.dataset.learn); renderGlossary(); return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) { openEditor(findTerm(ed.dataset.edit)); return; }
    const r = e.target.closest("[data-term]");
    if (r) openTerm(r.dataset.term);
  });
  $("#gl-add").addEventListener("click", () => openEditor(null));
  $("#gl-export").addEventListener("click", openExport);
  $("#gl-cards").addEventListener("click", openFlashcards);

  function toggleLearned(term) {
    const k = keyOf(term);
    state.learned.has(k) ? state.learned.delete(k) : state.learned.add(k);
    store.set("learned", [...state.learned]);
  }

  // ---------- SCENARIOS ----------
  const SC_GROUPS = [["all", "All metrics"], ["Climate", "Climate"], ["Energy mix", "Mix"], ["Electrification", "Electricity"], ["Demand", "Demand"], ["Cost", "Cost"]];
  const SC_TYPE = { exploratory: "Exploratory", normative: "Normative", forecast: "Forecast" };
  const SC_PUB = { agency: "Agencies", analyst: "Analysts", company: "Industry", science: "Science" };
  const sw = (i) => `<span class="sw c${i}"></span>`;
  function scById(id) { return (state.scen.scenarios || []).find((s) => s.id === id); }
  function scFmt(m, cell) {
    if (!cell) return `<span class="mval na">not published</span>`;
    if (cell.v == null) return `<span class="mval txt">${esc(cell.text || "n/a")}</span>`;
    let n = Number(cell.v).toFixed(m.decimals ?? 0);
    if (m.signed && cell.v > 0) n = "+" + n;
    if (cell.range) n = `${cell.range[0]}–${cell.range[1]}`;
    const unit = m.unit === "%" ? "%" : m.unit ? " " + m.unit.replace("USD tn/yr", "tn") : "";
    return `<span class="mval">${cell.approx ? '<span class="approx">~</span>' : ""}${esc(n)}${esc(unit)}</span>`;
  }
  function scBar(m, v, cls) {
    const tv = state.scen.today?.[m.id];
    const lo = m.min ?? 0, hi = m.max ?? Math.max(v ?? 1, 1);
    const pos = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
    const tick = tv != null && tv !== 0 ? `<div class="sc-tick" style="left:${Math.min(99, pos(tv))}%"></div>` : "";
    if (v == null) return `<div class="sc-track">${tick}</div>`;
    const zero = pos(Math.max(lo, 0)), p = pos(v);
    return `<div class="sc-track"><div class="sc-fill ${cls}" style="left:${Math.min(zero, p)}%;width:${Math.max(Math.abs(p - zero), 1.5)}%"></div>${tick}</div>`;
  }
  function renderScenarios() {
    const S = state.scen, all = S.scenarios || [];
    if (!all.length) { $("#sc-compare").innerHTML = `<ul class="grid">${empty("No scenario data loaded", "Add entries to <code>data/scenarios.json</code>.")}</ul>`; return; }
    const sel = state.sc.sel.filter((id) => id === "" || scById(id));
    $("#sc-about").innerHTML = `Pick up to three outlooks to compare on 2050 metrics. Tap a metric name for its definition.
      <details><summary>How to read this</summary><p>Values come from each publisher's public summaries, using the latest edition. <b>~</b> marks an approximate or derived value. "Not published" means the publisher doesn't report it publicly, so no estimate is shown. The thin vertical line on each bar marks today's value. Political achievability and suggested likelihood are Claude's editorial judgements, not data. Data updated ${esc(S.updated)}.</p></details>`;

    const opts = (cur, allowNone) => (allowNone ? `<option value="">None</option>` : "") +
      all.map((s) => `<option value="${esc(s.id)}" ${s.id === cur ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    $("#sc-pickers").innerHTML = [0, 1, 2].map((i) =>
      `<label class="sc-pick">${sw(i)}<select data-i="${i}" aria-label="Scenario ${i + 1}">${opts(sel[i] || "", i > 0)}</select></label>`).join("");
    $("#sc-groups").innerHTML = SC_GROUPS.map(([k, l]) => `<button data-g="${k}" class="${state.sc.group === k ? "on" : ""}">${l}</button>`).join("");

    const chosen = sel.map((id, i) => ({ s: scById(id), i })).filter((x) => x.s);
    const today = S.today || {};
    $("#sc-compare").innerHTML = (S.metrics || []).filter((m) => state.sc.group === "all" || m.group === state.sc.group).map((m) => {
      const tv = today[m.id];
      const todayTxt = tv == null ? "" : `today ${m.signed && tv > 0 ? "+" : ""}${tv}${m.unit === "%" ? "%" : m.unit ? " " + m.unit : ""}`;
      const rows = chosen.map(({ s, i }) => {
        const cell = s.values?.[m.id];
        return `<div class="mrow"><span class="who">${sw(i)}${esc(s.short)}</span>${scBar(m, cell?.v, "c" + i)}${scFmt(m, cell)}</div>`;
      }).join("");
      return `<div class="metric"><div class="metric-head"><button data-metric="${esc(m.id)}">${esc(m.label)}</button><span class="today">${esc(todayTxt)}</span></div>${rows}</div>`;
    }).join("");

    // electricity mix
    const legend = `<div class="mix-legend"><span><i class="seg-ws"></i>Wind and solar</span><span><i class="seg-ren"></i>Other or all renewables</span><span><i class="seg-nuc"></i>Nuclear</span><span><i class="seg-fos"></i>Fossil</span><span><i class="seg-unk"></i>Not specified</span></div>`;
    const mixToday = `<div class="mix-row"><div class="mix-label">Today (approx.)</div><div class="mixbar"><span class="seg-ws" style="width:15%"></span><span class="seg-ren" style="width:17%"></span><span class="seg-nuc" style="width:9%"></span><span class="seg-fos" style="width:59%"></span></div></div>`;
    $("#sc-mix").innerHTML = legend + mixToday + chosen.map(({ s, i }) => {
      const x = s.mix;
      if (!x) return `<div class="mix-row"><div class="mix-label">${sw(i)}${esc(s.short)}</div><div class="mixbar"><span class="seg-unk" style="width:100%"></span></div><div class="mix-note">The publisher doesn't report a 2050 electricity mix publicly.</div></div>`;
      const segs = [];
      if (x.windsolar != null) { segs.push(["seg-ws", x.windsolar, "Wind and solar"]); if (x.renewables != null) segs.push(["seg-ren", x.renewables - x.windsolar, "Other renewables"]); }
      else if (x.renewables != null) segs.push(["seg-ren", x.renewables, "Renewables"]);
      if (x.nuclear != null) segs.push(["seg-nuc", x.nuclear, "Nuclear"]);
      if (x.fossil != null) segs.push(["seg-fos", x.fossil, "Fossil"]);
      const sum = segs.reduce((a, b) => a + b[1], 0);
      if (sum < 99.5) segs.push(["seg-unk", 100 - sum, "Not specified"]);
      const bar = segs.filter((g) => g[1] > 0).map(([c, w, l]) => `<span class="${c}" style="width:${w}%" title="${l} ${Math.round(w)}%"></span>`).join("");
      const lab = segs.filter((g) => g[1] > 0 && g[0] !== "seg-unk").map(([, w, l]) => `${l} ${x.approx ? "~" : ""}${Math.round(w)}%`).join(", ");
      return `<div class="mix-row"><div class="mix-label">${sw(i)}${esc(s.short)}${x.year && x.year !== 2050 ? ` <span class="muted small">(${x.year})</span>` : ""}</div><div class="mixbar">${bar}</div><div class="mix-note">${esc(lab)}${x.note ? ". " + esc(x.note) : ""}</div></div>`;
    }).join("");

    // achievability and likelihood
    const dots = (n) => `<span class="dots" role="img" aria-label="${n} of 5">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? "f" : ""}"></i>`).join("")}</span>`;
    $("#sc-scores").innerHTML = `<p class="note">Political achievability and the suggested likelihood are Claude's editorial judgements. Tap the stars to set your own likelihood; it is saved on this device.</p>` +
      chosen.map(({ s, i }) => {
        const mine = state.sc.mine[s.id];
        const val = mine ?? s.likelihood?.score ?? 0;
        const stars = [1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" data-sc="${esc(s.id)}" class="${n <= val ? "on" : ""}" aria-label="${n} of 5">★</button>`).join("");
        return `<div class="score-card"><h3>${sw(i)}${esc(s.name)}</h3>
          <div class="score-line"><span class="k">Political achievability</span><div>${dots(s.political?.score || 0)}<p class="sc-why">${highlight(esc(s.political?.why || ""))}</p></div></div>
          <div class="score-line"><span class="k">Your likelihood</span><div><span class="stars">${stars}</span>
            <p class="sc-why">${mine != null ? `Your score. Suggested ${s.likelihood?.score} of 5. <button class="link small" data-reset="${esc(s.id)}">Reset</button>` : `Suggested ${s.likelihood?.score} of 5.`} ${highlight(esc(s.likelihood?.why || ""))}</p></div></div>
        </div>`;
      }).join("");

    // warming strip
    const lo = 1, hi = 3.5;
    const rowsW = all.map((s) => ({ s, t: s.values?.temp2100?.v })).filter((x) => x.t != null)
      .concat((S.context || []).map((c) => ({ ref: c, t: c.temp }))).sort((a, b) => b.t - a.t);
    $("#sc-strip").innerHTML = rowsW.map((r) => {
      const w = Math.max(2, ((r.t - lo) / (hi - lo)) * 100);
      const hue = Math.round(140 - Math.max(0, Math.min(1, (r.t - 1.4) / 1.6)) * 135);
      if (r.ref) return `<div class="strip-row ref"><span class="who" title="${esc(r.ref.label)}">${esc(r.ref.short || r.ref.label)}</span><div class="sc-track"><div class="sc-fill" style="width:${w}%"></div></div><span class="sval">${r.t.toFixed(1)}°</span></div>`;
      return `<button class="strip-row" data-pick="${esc(r.s.id)}"><span class="who">${esc(r.s.short)}</span><div class="sc-track"><div class="sc-fill" style="width:${w}%;background:hsl(${hue} 62% 46%)"></div></div><span class="sval">${r.t.toFixed(1)}°</span></button>`;
    }).join("") + `<div class="strip-axis"><span></span><div><span>1.0 °C</span><span>1.5</span><span>2.0</span><span>2.5</span><span>3.0</span><span>3.5</span></div><span></span></div><p class="note">Tap a scenario to load it as the first comparison. Grey rows are UNEP's 2025 estimates for where current policies, NDC pledges, and NDCs plus all net-zero pledges lead.</p>`;

    // all scenarios
    const tf = state.sc.type;
    $("#sc-type").innerHTML = [["all", "All"]].concat(Object.entries(SC_TYPE), Object.entries(SC_PUB)).map(([k, l]) => chip("data-type", k, l, tf === k)).join("");
    $("#sc-list").innerHTML = all.filter((s) => tf === "all" || s.type === tf || s.publisherType === tf).map((s) => `<li class="card">
      <div class="meta"><span class="sc-type-badge t-${esc(s.type)}">${esc(SC_TYPE[s.type] || s.type)}</span><span>${esc(SC_PUB[s.publisherType] || "")}</span></div>
      <h3 style="margin-top:8px"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></h3>
      <div class="design">${esc(s.publisher)}, ${esc(s.edition)}</div>
      <p>${highlight(esc(s.summary))}</p>
      ${s.facts?.length ? `<ul class="facts-list">${s.facts.map((f) => `<li>${highlight(esc(f))}</li>`).join("")}</ul>` : ""}
      <div class="design" style="margin-top:8px">Model: ${esc(s.model)}</div>
      <div class="cmp-btns">${[0, 1, 2].map((i) => `<button data-set="${i}" data-sc="${esc(s.id)}">${sw(i)}Compare as ${i + 1}</button>`).join("")}</div>
    </li>`).join("");

    $("#sc-sources").innerHTML = `<strong>Sources</strong><ul>${(S.sources || []).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("")}</ul>
      <p>Exploratory asks what happens if current trends or policies continue; normative works back from a goal; forecast is the publisher's best guess. Edit <code>data/scenarios.json</code> to add or correct entries.</p>`;
  }
  function scSave() { store.set("scSel", state.sc.sel); store.set("scMine", state.sc.mine); }
  function scPick(slot, id) { state.sc.sel[slot] = id; scSave(); renderScenarios(); $("#sc-pickers").scrollIntoView({ behavior: "smooth", block: "center" }); }
  $("#sc-pickers").addEventListener("change", (e) => { const s = e.target.closest("select"); if (!s) return; state.sc.sel[+s.dataset.i] = s.value; scSave(); renderScenarios(); });
  $("#sc-groups").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { state.sc.group = b.dataset.g; renderScenarios(); } });
  $("#sc-type").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) { state.sc.type = b.dataset.type; renderScenarios(); } });
  $("#view-scenarios").addEventListener("click", (e) => {
    const st = e.target.closest("[data-star]");
    if (st) { state.sc.mine[st.dataset.sc] = +st.dataset.star; scSave(); renderScenarios(); return; }
    const rs = e.target.closest("[data-reset]");
    if (rs) { delete state.sc.mine[rs.dataset.reset]; scSave(); renderScenarios(); return; }
    const pk = e.target.closest("[data-pick]");
    if (pk) return scPick(0, pk.dataset.pick);
    const set = e.target.closest("[data-set]");
    if (set) return scPick(+set.dataset.set, set.dataset.sc);
    const mt = e.target.closest("[data-metric]");
    if (mt) {
      const m = (state.scen.metrics || []).find((x) => x.id === mt.dataset.metric); if (!m) return;
      const terms = (m.terms || []).filter((t) => findTerm(t));
      openSheet(`<h2>${esc(m.label)}</h2><p>${esc(m.desc)}</p>${terms.length ? `<div class="related">${terms.map((t) => `<button data-rel="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}<div class="sheet-actions"><span></span><button class="btn" data-close>Done</button></div>`);
      $$("[data-rel]", body).forEach((b) => (b.onclick = () => openTerm(b.dataset.rel)));
      return;
    }
    const t = e.target.closest("[data-term]"); if (t) openTerm(t.dataset.term);
  });

  // ---------- LITERATURE ----------
  const paperLink = (p) => p.doi ? "https://doi.org/" + p.doi : p.url || "https://scholar.google.com/scholar?q=" + encodeURIComponent(p.title);
  function paperHTML(p) {
    return `<article class="paper">
      <h3><a href="${esc(paperLink(p))}" target="_blank" rel="noopener">${esc(p.title)}</a></h3>
      <div class="cite"><em>${esc(p.year)}</em> ${esc(String(p.authors).replace(/\.$/, ""))}. ${esc(p.venue)}</div>
      <div class="badges"><span class="badge type">${esc(p.type)}</span>${p.nuclear ? '<span class="badge nuc">Nuclear-relevant</span>' : ""}${p.perspective ? `<span class="badge">${esc(p.perspective)}</span>` : ""}</div>
      <p class="finding">${highlight(esc(p.finding))}</p>
      <p class="why">Why it matters: ${esc(p.why)}</p>
    </article>`;
  }
  function renderLiterature() {
    const L = state.literature, { q, cat, sort, nuclear } = state.lit;
    $("#lit-about").textContent = L.items.length ? `${L.about} Last updated ${L.updated}.` : "";
    $("#lit-cat").innerHTML = chip("data-cat", "all", "All", cat === "all", L.items.length) +
      L.categories.map((c) => chip("data-cat", c.id, c.label, cat === c.id, L.items.filter((i) => i.category === c.id).length)).join("");
    const ql = q.toLowerCase();
    const items = L.items.filter((p) =>
      (cat === "all" || p.category === cat) && (!nuclear || p.nuclear) &&
      (!ql || [p.title, p.authors, p.venue, p.finding, p.why, p.type, (p.tags || []).join(" ")].join(" ").toLowerCase().includes(ql)));
    const box = $("#lit-list");
    if (!items.length) {
      box.innerHTML = `<ul class="grid">${L.items.length ? empty("No studies match", "Clear a filter to see more.") : empty("No literature loaded", "Add entries to <code>data/literature.json</code>.")}</ul>`;
      return;
    }
    if (sort === "category") {
      box.innerHTML = L.categories.map((c) => {
        const group = items.filter((p) => p.category === c.id);
        return group.length ? `<section class="lit-group"><h2>${esc(c.label)}</h2><p class="note">${esc(c.blurb)}</p><div class="rows">${group.map(paperHTML).join("")}</div></section>` : "";
      }).join("");
    } else {
      const dir = sort === "newest" ? -1 : 1;
      box.innerHTML = `<div class="rows">${items.slice().sort((a, b) => dir * (a.year - b.year) || a.title.localeCompare(b.title)).map(paperHTML).join("")}</div>`;
    }
  }
  $("#lit-search").addEventListener("input", (e) => { state.lit.q = e.target.value.trim(); renderLiterature(); });
  $("#lit-cat").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { state.lit.cat = b.dataset.cat; renderLiterature(); } });
  $("#lit-sort").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]"); if (!b) return;
    state.lit.sort = b.dataset.sort; segOn($("#lit-sort"), b); renderLiterature();
  });
  $("#lit-nuclear").addEventListener("change", (e) => { state.lit.nuclear = e.target.checked; renderLiterature(); });
  $("#lit-list").addEventListener("click", (e) => { const t = e.target.closest("[data-term]"); if (t) openTerm(t.dataset.term); });

  // ---------- sheet (popover / editor / export / flashcards) ----------
  const sheet = $("#sheet"), body = $("#sheet-body");
  let returnFocus = null;
  function openSheet(html) {
    if (sheet.classList.contains("hidden")) returnFocus = document.activeElement;
    body.innerHTML = html; sheet.classList.remove("hidden"); document.body.style.overflow = "hidden";
    body.scrollTop = 0; body.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (sheet.classList.contains("hidden")) return;
    sheet.classList.add("hidden"); document.body.style.overflow = "";
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  }
  sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  function openTerm(name) {
    const t = findTerm(name);
    if (!t) {
      openSheet(`<h2>${esc(name)}</h2><p class="muted">This term is not in your glossary yet.</p>
        <div class="sheet-actions"><button class="btn ghost" data-close>Close</button><button class="btn" id="add-missing">Add it</button></div>`);
      $("#add-missing").onclick = () => openEditor({ term: name, full: "", category: "nuclear", level: 1, definition: "", related: [] }, true);
      return;
    }
    const learned = state.learned.has(keyOf(t.term));
    openSheet(`<div class="gl-head"><h2>${esc(t.term)}</h2>${level(t.level)}</div>${t.full ? `<div class="full">${esc(t.full)}</div>` : ""}
      <p>${esc(t.definition)}</p>
      <div class="meta" style="margin-top:12px">${tag(t.category)}</div>
      ${t.related?.length ? `<div class="related">${t.related.map((r) => `<button data-rel="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
      <div class="sheet-actions"><button class="btn ghost" id="t-learn">${learned ? "Learned ✓" : "Mark as learned"}</button><button class="btn" data-close>Done</button></div>`);
    $("#t-learn").onclick = () => { toggleLearned(t.term); renderGlossary(); openTerm(t.term); };
    $$("[data-rel]", body).forEach((b) => (b.onclick = () => openTerm(b.dataset.rel)));
  }

  function openEditor(t, isNewPrefill = false) {
    const isNewTerm = !t || isNewPrefill;
    const v = t || { term: "", full: "", category: "nuclear", level: 1, definition: "", related: [] };
    openSheet(`<h2>${isNewTerm ? "Add term" : "Edit term"}</h2>
      <form class="form" id="term-form">
        <label>Term<input name="term" required value="${esc(v.term)}" ${isNewTerm ? "" : "readonly"}></label>
        <label>Full name (optional)<input name="full" value="${esc(v.full)}"></label>
        <div class="pair">
          <label>Category<select name="category">${CATS.map(([k, l]) => `<option value="${k}" ${v.category === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Level<select name="level">${[1, 2, 3].map((n) => `<option value="${n}" ${v.level === n ? "selected" : ""}>${["", "Basics", "Intermediate", "Expert"][n]}</option>`).join("")}</select></label>
        </div>
        <label>Definition<textarea name="definition" required>${esc(v.definition)}</textarea></label>
        <label>Related terms, separated by commas<input name="related" value="${esc((v.related || []).join(", "))}"></label>
      </form>
      <div class="sheet-actions">
        ${isNewTerm ? '<button class="btn ghost" data-close>Cancel</button>' : '<button class="btn danger" id="t-del">Delete term</button>'}
        <button class="btn" id="t-save">Save term</button>
      </div>`);
    $("#t-save").onclick = () => {
      const f = $("#term-form");
      if (!f.reportValidity()) return;
      const d = Object.fromEntries(new FormData(f));
      const entry = { term: d.term.trim(), full: d.full.trim(), category: d.category, level: +d.level, definition: d.definition.trim(),
        related: d.related.split(",").map((s) => s.trim()).filter(Boolean) };
      const k = keyOf(entry.term);
      const L = state.glLocal;
      L.deleted = L.deleted.filter((x) => keyOf(x) !== k);
      const inBase = state.glossaryBase.terms.some((x) => keyOf(x.term) === k);
      if (inBase) L.edited[k] = entry;
      else { L.added = L.added.filter((x) => keyOf(x.term) !== k); L.added.push(entry); }
      saveLocal(); glossaryChanged(); closeSheet();
    };
    const del = $("#t-del");
    if (del) del.onclick = () => {
      // Two-step confirmation inside the sheet (browser dialogs are unreliable in installed web apps).
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again to delete"; return; }
      const k = keyOf(v.term), L = state.glLocal;
      L.added = L.added.filter((x) => keyOf(x.term) !== k);
      delete L.edited[k];
      if (state.glossaryBase.terms.some((x) => keyOf(x.term) === k)) L.deleted.push(v.term);
      saveLocal(); glossaryChanged(); closeSheet();
    };
  }
  function glossaryChanged() { buildHighlighter(); renderGlossary(); renderFeed(); renderCompanies(); renderScenarios(); renderLiterature(); }

  function exportJSON() {
    const terms = glossary().map(({ _local, ...t }) => t);
    return JSON.stringify({ _about: state.glossaryBase._about, terms }, null, 2);
  }
  function openExport() {
    const L = state.glLocal;
    const changes = L.added.length + Object.keys(L.edited).length + L.deleted.length;
    openSheet(`<h2>Export glossary</h2>
      <p class="muted">${changes ? `${changes} change${changes > 1 ? "s" : ""} made on this device. ` : "No changes on this device. "}Download the merged file and replace <code>data/glossary.json</code> in the repository to keep your edits on every device.</p>
      <div class="sheet-actions">
        <button class="btn danger" id="x-reset" ${changes ? "" : "disabled"}>Discard edits</button>
        <span class="row gap"><button class="btn ghost" id="x-copy">Copy</button><button class="btn" id="x-dl">Download</button></span>
      </div>`);
    $("#x-dl").onclick = () => {
      const blob = new Blob([exportJSON()], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "glossary.json" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $("#x-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(exportJSON()); $("#x-copy").textContent = "Copied ✓"; }
      catch { $("#x-copy").textContent = "Copy failed"; }
    };
    $("#x-reset").onclick = (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to discard"; return; }
      state.glLocal = { added: [], edited: {}, deleted: [] }; saveLocal(); glossaryChanged(); closeSheet();
    };
  }

  function openFlashcards() {
    let deck = filteredTerms().filter((t) => !state.learned.has(keyOf(t.term)));
    if (!deck.length) deck = filteredTerms();
    for (let j = deck.length - 1; j > 0; j--) { const r = Math.floor(Math.random() * (j + 1)); [deck[j], deck[r]] = [deck[r], deck[j]]; }
    let i = 0, flipped = false;
    const draw = () => {
      if (!deck.length) { openSheet(`<h2>Flashcards</h2><p class="muted">No terms in this filter.</p><div class="sheet-actions"><span></span><button class="btn" data-close>Close</button></div>`); return; }
      const t = deck[i % deck.length];
      openSheet(`<div class="row"><h2>Flashcards</h2><span class="muted small">${(i % deck.length) + 1} of ${deck.length}</span></div>
        <button class="flash" id="fc" aria-label="Flip card"><span class="big">${esc(t.term)}</span>${t.full ? `<span class="full">${esc(t.full)}</span>` : ""}${flipped
          ? `<span class="def">${esc(t.definition)}</span>` : `<span class="hint">Tap to see the definition</span>`}</button>
        <div class="sheet-actions"><button class="btn ghost" id="fc-learn">${state.learned.has(keyOf(t.term)) ? "Learned ✓" : "I know this"}</button><button class="btn" id="fc-next">Next card</button></div>`);
      $("#fc").onclick = () => { flipped = !flipped; draw(); };
      $("#fc-next").onclick = () => { i++; flipped = false; draw(); };
      $("#fc-learn").onclick = () => { toggleLearned(t.term); renderGlossary(); i++; flipped = false; draw(); };
    };
    draw();
  }

  // ---------- SOURCES ----------
  function renderSources() {
    const health = new Map((state.articles.health || []).map((h) => [h.id, h]));
    const groups = [
      ["Fetched automatically", (s) => s.feed && s.access === "open"],
      ["Headlines only, partly paywalled", (s) => s.feed && s.access === "partial"],
      ["Open, no feed: visit directly", (s) => !s.feed && s.access !== "paid"],
      ["Paid, listed for reference", (s) => s.access === "paid"],
    ];
    $("#src-groups").innerHTML = groups.map(([title, fn]) => {
      const list = state.sources.filter(fn);
      if (!list.length) return "";
      return `<section class="src-group"><h2>${title}<span class="n">${list.length}</span></h2><div class="rows">${list.map((s) => {
        const h = health.get(s.id);
        const st = !s.feed || s.access === "paid" ? "" : s.enabled === false ? `<span class="status">muted</span>`
          : h ? (h.ok ? `<span class="status ok">${h.count} items</span>` : `<span class="status err" title="${esc(h.error)}">failing</span>`)
          : `<span class="status">not fetched yet</span>`;
        return `<div class="src"><div><a class="name" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>
          <div class="meta">${tag(s.topic)}<span>${esc(REGION[s.region] || s.region || "")}</span>${s.feed && s.weight && s.weight !== 1 ? `<span>weight ${s.weight}</span>` : ""}</div>
          ${s.note ? `<p>${esc(s.note)}</p>` : ""}${h && !h.ok ? `<p>${esc(h.error)}</p>` : ""}</div>${st}</div>`;
      }).join("")}</div></section>`;
    }).join("");
  }

  // ---------- boot ----------
  async function boot() {
    applyTheme();
    const [articles, sources, companies, gl, lit, scen] = await Promise.all([
      load("data/articles.json", state.articles),
      load("data/sources.json", { sources: [] }),
      load("data/companies.json", state.companies),
      load("data/glossary.json", state.glossaryBase),
      load("data/literature.json", state.literature),
      load("data/scenarios.json", state.scen),
    ]);
    state.articles = articles; state.sources = sources.sources || []; state.companies = companies;
    state.glossaryBase = gl; state.literature = { ...state.literature, ...lit }; state.scen = scen;

    // Stories saved by an earlier version were stored as links only; give them a full copy.
    const oldSaved = store.get("saved", null);
    if (Array.isArray(oldSaved)) {
      for (const link of oldSaved) { const it = articles.items.find((i) => i.link === link); if (it && !state.saved.has(link)) state.saved.set(link, it); }
      store.set("savedItems", Object.fromEntries(state.saved));
      try { localStorage.removeItem("eh.saved"); } catch {}
    }

    buildHighlighter();
    $("#updated").textContent = articles.generated ? "Updated " + relTime(articles.generated) : "";
    renderHealth(); renderFeed(); renderCompanies(); renderGlossary(); renderScenarios(); renderLiterature(); renderSources();
    show(location.hash.slice(1) || store.get("view", "feed"));
  }
  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
