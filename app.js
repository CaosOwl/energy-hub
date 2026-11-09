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
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const keyOf = (term) => String(term).trim().toLowerCase();

  const state = {
    articles: { items: [], health: [], generated: null },
    sources: [],
    companies: { companies: [], updated: "" },
    glossaryBase: { _about: "", terms: [] },
    saved: new Set(store.get("saved", [])),
    learned: new Set(store.get("learned", [])),
    glLocal: store.get("glossaryLocal", { added: [], edited: {}, deleted: [] }),
    feed: { q: "", topic: "all", sort: "score" },
    co: { q: "", kind: "all", stage: "all" },
    gl: { q: "", cat: "all", level: 0, hideLearned: false },
    literature: { categories: [], items: [], about: "", updated: "" },
    lit: { q: "", cat: "all", sort: "category", nuclear: false },
    scen: { scenarios: [], metrics: [] },
    sc: { sel: store.get("scSel", ["iea-steps", "iea-nze", "dnv-eto"]), mine: store.get("scMine", {}), group: "all", type: "all" },
  };

  const TOPICS = [["all", "All"], ["nuclear", "Nuclear"], ["markets", "Markets"], ["transition", "Transition"], ["tech", "Tech"]];
  const STAGES = ["concept", "design", "licensing", "construction", "critical", "experiment", "operating"];
  const STAGE_LABEL = { concept: "Concept", design: "Design", licensing: "Licensing", construction: "Construction", critical: "Went critical", experiment: "Experiment", operating: "Operating" };
  const CATS = [["all", "All"], ["nuclear", "Nuclear"], ["markets", "Markets"], ["transition", "Transition"], ["tech", "Tech"]];

  // ---------- theme ----------
  function applyTheme() {
    const t = store.get("theme", "system");
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    $("#theme-btn").title = "Theme: " + t;
  }
  $("#theme-btn").addEventListener("click", () => {
    const order = ["system", "dark", "light"];
    const cur = store.get("theme", "system");
    store.set("theme", order[(order.indexOf(cur) + 1) % order.length]);
    applyTheme();
  });

  // ---------- navigation ----------
  function show(view) {
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("hidden", v.id !== "view-" + view));
    document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $("#view-title").textContent = $("#view-" + view).dataset.title;
    store.set("view", view);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

  // ---------- data ----------
  async function load(path, fallback) {
    try {
      const r = await fetch(path, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch { return fallback; }
  }

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
        if (label && label.length >= 3) hlMap.set(label.toLowerCase(), t.term);
      }
    }
    const parts = [...hlMap.keys()].sort((a, b) => b.length - a.length)
      .map((s) => esc(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    hlRegex = parts.length ? new RegExp("\\b(" + parts.join("|") + ")\\b", "gi") : null;
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
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 86400 * 7) return Math.round(s / 86400) + "d ago";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function renderFeedChips() {
    const counts = {};
    for (const it of state.articles.items) for (const t of it.tags || []) counts[t] = (counts[t] || 0) + 1;
    $("#feed-chips").innerHTML = TOPICS.map(([k, label]) =>
      `<button class="chip ${state.feed.topic === k ? "on" : ""}" data-topic="${k}">${label}${k !== "all" && counts[k] ? `<span class="n">${counts[k]}</span>` : ""}</button>`).join("");
  }

  function renderFeed() {
    renderFeedChips();
    const { q, topic, sort } = state.feed;
    let items = state.articles.items.slice();
    if (sort === "saved") items = items.filter((i) => state.saved.has(i.link));
    if (topic !== "all") items = items.filter((i) => (i.tags || []).includes(topic));
    if (q) {
      const ql = q.toLowerCase();
      items = items.filter((i) => (i.title + " " + i.summary + " " + i.sourceName).toLowerCase().includes(ql));
    }
    items.sort(sort === "date" ? (a, b) => (b.date || "").localeCompare(a.date || "") : (a, b) => b.score - a.score);

    const list = $("#feed-list");
    if (!state.articles.generated) {
      list.innerHTML = `<li class="empty">No stories yet.<br><span class="small">The first GitHub Actions run fills the feed. Until then, explore the other tabs.</span></li>`;
      return;
    }
    if (!items.length) {
      list.innerHTML = `<li class="empty">${sort === "saved" ? "Nothing saved yet. Tap ☆ on a story to keep it." : "No stories match."}</li>`;
      return;
    }
    list.innerHTML = items.slice(0, 150).map((i) => {
      const tags = (i.tags || []).map((t) => `<span class="tag ${esc(t)}">${esc(t)}</span>`).join("");
      const also = i.also?.length ? `<span class="also">Also: ${i.also.map((a) => `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.sourceName)}</a>`).join(", ")}</span>` : "<span></span>";
      const lock = i.access === "partial" ? " · 🔒 may be paywalled" : "";
      return `<li class="card ${(i.tags || [])[0] === "nuclear" ? "lead-nuclear" : ""}">
        <div class="meta"><strong>${esc(i.sourceName)}</strong><span>${relTime(i.date)}${lock}</span>${tags}</div>
        <h3><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
        ${i.summary ? `<p>${highlight(esc(i.summary))}</p>` : ""}
        <div class="card-foot">${also}<button class="save ${state.saved.has(i.link) ? "on" : ""}" data-save="${esc(i.link)}" aria-label="Save">${state.saved.has(i.link) ? "★" : "☆"}</button></div>
      </li>`;
    }).join("");
  }

  function renderHealth() {
    const h = state.articles.health || [];
    const btn = $("#health-btn");
    if (!h.length) { btn.textContent = ""; return; }
    const bad = h.filter((x) => !x.ok);
    btn.textContent = bad.length ? `⚠ ${bad.length} of ${h.length} feeds failing` : `${h.length} feeds OK`;
    btn.style.color = bad.length ? "var(--warn)" : "";
    $("#health-panel").innerHTML = bad.length
      ? `<strong>Feeds that failed on the last run</strong><ul>${bad.map((b) => `<li>${esc(b.name)} <span class="muted">— ${esc(b.error || "unknown error")}</span></li>`).join("")}</ul><p class="muted small">Fix the feed URL in <code>data/sources.json</code> or set <code>enabled: false</code>.</p>`
      : `All feeds fetched successfully on the last run.`;
  }

  $("#health-btn").addEventListener("click", () => $("#health-panel").classList.toggle("hidden"));
  $("#feed-search").addEventListener("input", (e) => { state.feed.q = e.target.value.trim(); renderFeed(); });
  $("#feed-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-topic]"); if (b) { state.feed.topic = b.dataset.topic; renderFeed(); } });
  $("#feed-sort").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]"); if (!b) return;
    state.feed.sort = b.dataset.sort;
    document.querySelectorAll("#feed-sort button").forEach((x) => x.classList.toggle("on", x === b));
    renderFeed();
  });
  $("#feed-list").addEventListener("click", (e) => {
    const s = e.target.closest("[data-save]");
    if (s) {
      const l = s.dataset.save;
      state.saved.has(l) ? state.saved.delete(l) : state.saved.add(l);
      store.set("saved", [...state.saved]);
      renderFeed();
      return;
    }
    const t = e.target.closest("[data-term]");
    if (t) openTerm(t.dataset.term);
  });

  // ---------- COMPANIES ----------
  function renderCompanies() {
    const all = state.companies.companies || [];
    const { q, kind, stage } = state.co;
    $("#co-kind").innerHTML = [["all", "All"], ["fission", "Fission"], ["fusion", "Fusion"], ["swiss", "🇨🇭 Swiss link"]]
      .map(([k, l]) => `<button class="chip ${kind === k ? "on" : ""}" data-kind="${k}">${l}</button>`).join("");
    const present = STAGES.filter((s) => all.some((c) => c.stage === s));
    $("#co-stage").innerHTML = [`<button class="chip ${stage === "all" ? "on" : ""}" data-stage="all">Any stage</button>`]
      .concat(present.map((s) => `<button class="chip ${stage === s ? "on" : ""}" data-stage="${s}">${STAGE_LABEL[s]}<span class="n">${all.filter((c) => c.stage === s).length}</span></button>`)).join("");
    $("#co-note").textContent = state.companies.updated
      ? `${all.length} companies · milestones checked ${state.companies.updated}. This moves fast, so verify before relying on details.` : "";

    let list = all.filter((c) =>
      (kind === "all" || (kind === "swiss" ? c.swiss : c.kind === kind)) &&
      (stage === "all" || c.stage === stage) &&
      (!q || [c.name, c.design, c.tech, c.country, c.milestone].join(" ").toLowerCase().includes(q.toLowerCase())));
    list.sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) || a.name.localeCompare(b.name));

    $("#co-list").innerHTML = list.length ? list.map((c) => {
      const url = c.url || `https://duckduckgo.com/?q=${encodeURIComponent(c.name + " " + c.design + " reactor")}`;
      return `<li class="card">
        <div class="co-head">
          <div><h3>${esc(c.name)} ${c.swiss ? '<span class="swiss">✚ CH</span>' : ""}</h3>
          <div class="design">${esc(c.design)} · ${esc(c.country)}</div></div>
          <span class="stage stage-${esc(c.stage)}">${esc(STAGE_LABEL[c.stage] || c.stage)}</span>
        </div>
        <dl class="facts"><dt>Tech</dt><dd>${highlight(esc(c.tech))}</dd><dt>Power</dt><dd>${esc(c.power)}</dd></dl>
        <p>${esc(c.milestone)}</p>
        <div class="gl-actions"><a href="${esc(url)}" target="_blank" rel="noopener">${c.url ? "Website" : "Search web"} ↗</a><button class="link" data-news="${esc(c.name)}">News in feed</button></div>
      </li>`;
    }).join("") : `<li class="empty">No companies match.</li>`;
  }
  $("#co-search").addEventListener("input", (e) => { state.co.q = e.target.value.trim(); renderCompanies(); });
  $("#co-kind").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) { state.co.kind = b.dataset.kind; renderCompanies(); } });
  $("#co-stage").addEventListener("click", (e) => { const b = e.target.closest("[data-stage]"); if (b) { state.co.stage = b.dataset.stage; renderCompanies(); } });
  $("#co-list").addEventListener("click", (e) => {
    const n = e.target.closest("[data-news]");
    if (n) { state.feed.q = n.dataset.news; $("#feed-search").value = n.dataset.news; state.feed.topic = "all"; renderFeed(); show("feed"); return; }
    const t = e.target.closest("[data-term]"); if (t) openTerm(t.dataset.term);
  });

  // ---------- GLOSSARY ----------
  function filteredTerms() {
    const { q, cat, level, hideLearned } = state.gl;
    const ql = q.toLowerCase();
    return glossary().filter((t) =>
      (cat === "all" || t.category === cat) &&
      (!level || t.level === level) &&
      (!hideLearned || !state.learned.has(keyOf(t.term))) &&
      (!ql || [t.term, t.full, t.definition].join(" ").toLowerCase().includes(ql)));
  }

  function renderGlossary() {
    const all = glossary();
    $("#gl-cat").innerHTML = CATS.map(([k, l]) => {
      const n = k === "all" ? all.length : all.filter((t) => t.category === k).length;
      return `<button class="chip ${state.gl.cat === k ? "on" : ""}" data-cat="${k}">${l}<span class="n">${n}</span></button>`;
    }).join("");
    const learnedN = all.filter((t) => state.learned.has(keyOf(t.term))).length;
    $("#gl-progress").textContent = `${learnedN} of ${all.length} learned`;
    $("#gl-unlearned").textContent = state.gl.hideLearned ? "Show learned" : "Hide learned";

    const list = filteredTerms();
    $("#gl-list").innerHTML = list.length ? list.map((t) => {
      const k = keyOf(t.term), learned = state.learned.has(k);
      return `<li class="card ${learned ? "learned" : ""}" id="term-${esc(k.replace(/\W+/g, "-"))}">
        <div class="gl-head"><h3>${esc(t.term)}</h3><span class="lvl">${"●".repeat(t.level || 1)}${"○".repeat(3 - (t.level || 1))}</span></div>
        ${t.full ? `<div class="full">${esc(t.full)}</div>` : ""}
        <div class="meta" style="margin:6px 0 0"><span class="tag ${esc(t.category)}">${esc(t.category)}</span>${t._local ? '<span class="badge-local">edited on this device</span>' : ""}</div>
        <p>${esc(t.definition)}</p>
        ${t.related?.length ? `<div class="related">${t.related.map((r) => `<button data-term="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
        <div class="gl-actions"><button class="link" data-learn="${esc(t.term)}">${learned ? "✓ Learned" : "Mark learned"}</button><button class="link" data-edit="${esc(t.term)}">Edit</button></div>
      </li>`;
    }).join("") : `<li class="empty">No terms match.</li>`;
  }

  $("#gl-search").addEventListener("input", (e) => { state.gl.q = e.target.value.trim(); renderGlossary(); });
  $("#gl-cat").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { state.gl.cat = b.dataset.cat; renderGlossary(); } });
  $("#gl-level").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]"); if (!b) return;
    state.gl.level = +b.dataset.level;
    document.querySelectorAll("#gl-level button").forEach((x) => x.classList.toggle("on", x === b));
    renderGlossary();
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

  // ---------- sheet (popover / editor / export / flashcards) ----------
  const sheet = $("#sheet"), body = $("#sheet-body");
  function openSheet(html) { body.innerHTML = html; sheet.classList.remove("hidden"); document.body.style.overflow = "hidden"; }
  function closeSheet() { sheet.classList.add("hidden"); document.body.style.overflow = ""; }
  sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  function openTerm(name) {
    const t = findTerm(name);
    if (!t) {
      openSheet(`<h2>${esc(name)}</h2><p class="muted">Not in your glossary yet.</p>
        <div class="sheet-actions"><button class="btn ghost" data-close>Close</button><button class="btn" id="add-missing">Add it</button></div>`);
      $("#add-missing").onclick = () => openEditor({ term: name, full: "", category: "nuclear", level: 1, definition: "", related: [] }, true);
      return;
    }
    const learned = state.learned.has(keyOf(t.term));
    openSheet(`<h2>${esc(t.term)}</h2>${t.full ? `<div class="full">${esc(t.full)}</div>` : ""}
      <div class="meta" style="margin-top:8px"><span class="tag ${esc(t.category)}">${esc(t.category)}</span><span class="lvl">${"●".repeat(t.level || 1)}${"○".repeat(3 - (t.level || 1))}</span></div>
      <p>${esc(t.definition)}</p>
      ${t.related?.length ? `<div class="related">${t.related.map((r) => `<button data-rel="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
      <div class="sheet-actions"><button class="btn ghost" id="t-learn">${learned ? "✓ Learned" : "Mark learned"}</button><button class="btn" data-close>Done</button></div>`);
    $("#t-learn").onclick = () => { toggleLearned(t.term); renderGlossary(); openTerm(t.term); };
    body.querySelectorAll("[data-rel]").forEach((b) => (b.onclick = () => openTerm(b.dataset.rel)));
  }

  function openEditor(t, isNewPrefill = false) {
    const isNew = !t || isNewPrefill;
    const v = t || { term: "", full: "", category: "nuclear", level: 1, definition: "", related: [] };
    openSheet(`<h2>${isNew ? "Add term" : "Edit term"}</h2>
      <form class="form" id="term-form">
        <label>Term<input name="term" required value="${esc(v.term)}" ${isNew ? "" : "readonly"}></label>
        <label>Full name (optional)<input name="full" value="${esc(v.full)}"></label>
        <div class="row" style="flex-wrap:nowrap">
          <label style="flex:1">Category<select name="category">${CATS.slice(1).map(([k, l]) => `<option value="${k}" ${v.category === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label style="flex:1">Level<select name="level">${[1, 2, 3].map((n) => `<option value="${n}" ${v.level === n ? "selected" : ""}>${["", "Basics", "Intermediate", "Expert"][n]}</option>`).join("")}</select></label>
        </div>
        <label>Definition<textarea name="definition" required>${esc(v.definition)}</textarea></label>
        <label>Related terms (comma-separated)<input name="related" value="${esc((v.related || []).join(", "))}"></label>
      </form>
      <div class="sheet-actions">
        ${isNew ? '<button class="btn ghost" data-close>Cancel</button>' : '<button class="btn ghost" id="t-del" style="color:var(--warn);border-color:var(--warn)">Delete</button>'}
        <button class="btn" id="t-save">Save</button>
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
      saveLocal(); buildHighlighter(); renderGlossary(); closeSheet();
    };
    const del = $("#t-del");
    if (del) del.onclick = () => {
      if (!confirm(`Delete "${v.term}" from your glossary on this device?`)) return;
      const k = keyOf(v.term), L = state.glLocal;
      L.added = L.added.filter((x) => keyOf(x.term) !== k);
      delete L.edited[k];
      if (state.glossaryBase.terms.some((x) => keyOf(x.term) === k)) L.deleted.push(v.term);
      saveLocal(); buildHighlighter(); renderGlossary(); closeSheet();
    };
  }

  function exportJSON() {
    const terms = glossary().map(({ _local, ...t }) => t);
    return JSON.stringify({ _about: state.glossaryBase._about, terms }, null, 2);
  }
  function openExport() {
    const L = state.glLocal;
    const changes = L.added.length + Object.keys(L.edited).length + L.deleted.length;
    openSheet(`<h2>Export glossary</h2>
      <p class="muted">${changes ? `${changes} change(s) on this device. ` : "No local changes. "}Download the merged file and replace <code>data/glossary.json</code> in the repo to make your edits permanent and available on every device.</p>
      <div class="sheet-actions" style="flex-wrap:wrap">
        <button class="btn ghost" id="x-reset" ${changes ? "" : "disabled"}>Discard local edits</button>
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
    $("#x-reset").onclick = () => {
      if (!confirm("Discard all glossary edits made on this device?")) return;
      state.glLocal = { added: [], edited: {}, deleted: [] }; saveLocal(); buildHighlighter(); renderGlossary(); closeSheet();
    };
  }

  function openFlashcards() {
    let deck = filteredTerms().filter((t) => !state.learned.has(keyOf(t.term)));
    if (!deck.length) deck = filteredTerms();
    deck = deck.sort(() => Math.random() - 0.5);
    let i = 0, flipped = false;
    const draw = () => {
      if (!deck.length) { openSheet(`<h2>Flashcards</h2><p class="muted">No terms in this filter.</p><div class="sheet-actions"><span></span><button class="btn" data-close>Close</button></div>`); return; }
      const t = deck[i % deck.length];
      openSheet(`<div class="row"><h2>Flashcards</h2><span class="muted small">${(i % deck.length) + 1} / ${deck.length}</span></div>
        <div class="flash" id="fc">${flipped
          ? `<div class="big">${esc(t.term)}</div>${t.full ? `<div class="full">${esc(t.full)}</div>` : ""}<div class="def">${esc(t.definition)}</div>`
          : `<div class="big">${esc(t.term)}</div>${t.full ? `<div class="full">${esc(t.full)}</div>` : ""}<div class="muted small">Tap to reveal</div>`}</div>
        <div class="sheet-actions"><button class="btn ghost" id="fc-learn">${state.learned.has(keyOf(t.term)) ? "✓ Learned" : "I know this"}</button><button class="btn" id="fc-next">Next →</button></div>`);
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
      ["Headlines only (partly paywalled)", (s) => s.feed && s.access === "partial"],
      ["Open, no feed (visit directly)", (s) => !s.feed && s.access !== "paid"],
      ["Paid — worth it, never fetched", (s) => s.access === "paid"],
    ];
    $("#src-groups").innerHTML = groups.map(([title, fn]) => {
      const list = state.sources.filter(fn);
      if (!list.length) return "";
      return `<div class="src-group"><h2>${title} · ${list.length}</h2><ul class="cards">${list.map((s) => {
        const h = health.get(s.id);
        const st = !s.feed || s.access === "paid" ? "" : !s.enabled ? `<span class="status muted">muted</span>`
          : h ? (h.ok ? `<span class="status ok">● ${h.count} items</span>` : `<span class="status err" title="${esc(h.error)}">● failing</span>`)
          : `<span class="status muted">not fetched yet</span>`;
        return `<li class="card"><div class="src"><div><a class="name" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>
          <div class="meta" style="margin:4px 0 0"><span class="tag ${esc(s.topic)}">${esc(s.topic)}</span><span>${esc((s.region || "").toUpperCase())}</span>${s.weight && s.weight !== 1 ? `<span>weight ${s.weight}</span>` : ""}</div>
          ${s.note ? `<p class="small">${esc(s.note)}</p>` : ""}</div>${st}</div></li>`;
      }).join("")}</ul></div>`;
    }).join("");
  }

  // ---------- SCENARIOS ----------
  const SC_GROUPS = [["all", "All metrics"], ["Climate", "Climate"], ["Energy mix", "Mix"], ["Electrification", "Electricity"], ["Demand", "Demand"], ["Cost", "Cost"]];
  const SC_TYPE = { exploratory: "Exploratory", normative: "Normative", forecast: "Forecast" };
  const SC_PUB = { agency: "Agencies", analyst: "Analysts", company: "Industry", science: "Science" };
  function scById(id) { return (state.scen.scenarios || []).find((s) => s.id === id); }
  function scFmt(m, cell) {
    if (!cell) return `<span class="mval na">not published</span>`;
    if (cell.v == null) return `<span class="mval txt">${esc(cell.text || "—")}</span>`;
    const d = m.decimals ?? 0;
    let n = Number(cell.v).toFixed(d);
    if (m.signed && cell.v > 0) n = "+" + n;
    if (cell.range) n = `${cell.range[0]}–${cell.range[1]}`;
    const unit = m.unit === "%" ? "%" : m.unit ? " " + m.unit.replace("USD tn/yr", "tn") : "";
    return `<span class="mval">${cell.approx ? '<span class="approx">~</span>' : ""}${esc(n)}${esc(unit)}</span>`;
  }
  function scBar(m, v, cls) {
    const tv = state.scen.today?.[m.id];
    const lo0 = m.min ?? 0, hi0 = m.max ?? 1;
    const tick = tv != null && tv !== 0 ? `<div class="tick" style="left:${Math.max(0, Math.min(99, ((tv - lo0) / (hi0 - lo0)) * 100))}%"></div>` : "";
    if (v == null) return `<div class="track">${tick}</div>`;
    const lo = m.min ?? 0, hi = m.max ?? Math.max(v, 1);
    const pos = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
    const zero = pos(Math.max(lo, 0)), p = pos(v);
    const left = Math.min(zero, p), width = Math.max(Math.abs(p - zero), 1.5);
    return `<div class="track"><div class="fill ${cls}" style="left:${left}%;width:${width}%"></div>${tick}</div>`;
  }
  function renderScenarios() {
    const S = state.scen, all = S.scenarios || [];
    if (!all.length) { $("#sc-compare").innerHTML = `<p class="empty">Scenario data not loaded.</p>`; return; }
    const sel = state.sc.sel.filter((id) => id === "" || scById(id));
    $("#sc-about").innerHTML = `Pick up to three outlooks to compare on 2050 metrics. Tap a metric name for its definition.
      <details><summary>How to read this</summary><p>Values come from each publisher's public summaries, using the latest edition. <b>~</b> = approximate or derived. "Not published" means the publisher doesn't report it publicly, so no estimate is shown. The thin vertical line on each bar marks today's value. Political achievability and suggested likelihood are Claude's editorial judgements, not data. Data updated ${esc(S.updated)}.</p></details>`;

    // pickers
    const opts = (cur, allowNone) => (allowNone ? `<option value="">— none —</option>` : "") +
      all.map((s) => `<option value="${esc(s.id)}" ${s.id === cur ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    $("#sc-pickers").innerHTML = [0, 1, 2].map((i) =>
      `<label class="sc-pick"><span class="sw c${i}"></span><select data-i="${i}" aria-label="Scenario ${i + 1}">${opts(sel[i] || "", i > 0)}</select></label>`).join("");
    $("#sc-groups").innerHTML = SC_GROUPS.map(([k, l]) => `<button data-g="${k}" class="${state.sc.group === k ? "on" : ""}">${l}</button>`).join("");

    const chosen = sel.map((id, i) => ({ s: scById(id), i })).filter((x) => x.s);
    const today = S.today || {};
    const metrics = (S.metrics || []).filter((m) => state.sc.group === "all" || m.group === state.sc.group);
    $("#sc-compare").innerHTML = metrics.map((m) => {
      const tv = today[m.id];
      const todayTxt = tv == null ? "" : `today ${m.signed && tv > 0 ? "+" : ""}${tv}${m.unit === "%" ? "%" : m.unit ? " " + m.unit : ""}`;
      const rows = chosen.map(({ s, i }) => {
        const cell = s.values?.[m.id];
        return `<div class="mrow"><span class="who"><span class="sw c${i}"></span>${esc(s.short)}</span>${scBar(m, cell?.v, "c" + i)}${scFmt(m, cell)}</div>`;
      }).join("");
      return `<div class="metric"><div class="metric-head"><button data-metric="${esc(m.id)}">${esc(m.label)}</button><span class="today">${esc(todayTxt)}</span></div>${rows}</div>`;
    }).join("");

    // electricity mix
    const legend = `<div class="mix-legend"><span><i class="seg-ws"></i>Wind + solar</span><span><i class="seg-ren"></i>Other / all renewables</span><span><i class="seg-nuc"></i>Nuclear</span><span><i class="seg-fos"></i>Fossil</span><span><i class="seg-unk"></i>Not specified</span></div>`;
    const mixToday = `<div class="mix-row"><div class="mix-label">Today (approx.)</div><div class="mixbar"><span class="seg-ws" style="width:15%"></span><span class="seg-ren" style="width:17%"></span><span class="seg-nuc" style="width:9%"></span><span class="seg-fos" style="width:59%"></span></div></div>`;
    $("#sc-mix").innerHTML = legend + mixToday + chosen.map(({ s, i }) => {
      const x = s.mix;
      if (!x) return `<div class="mix-row"><div class="mix-label"><span class="sw c${i}"></span>${esc(s.short)}</div><div class="mixbar"><span class="seg-unk" style="width:100%"></span></div><div class="mix-note">The publisher doesn't report a 2050 electricity mix publicly.</div></div>`;
      const segs = [];
      if (x.windsolar != null) { segs.push(["seg-ws", x.windsolar, "Wind+solar"]); if (x.renewables != null) segs.push(["seg-ren", x.renewables - x.windsolar, "Other renewables"]); }
      else if (x.renewables != null) segs.push(["seg-ren", x.renewables, "Renewables"]);
      if (x.nuclear != null) segs.push(["seg-nuc", x.nuclear, "Nuclear"]);
      if (x.fossil != null) segs.push(["seg-fos", x.fossil, "Fossil"]);
      const sum = segs.reduce((a, b) => a + b[1], 0);
      if (sum < 99.5) segs.push(["seg-unk", 100 - sum, "Not specified"]);
      const bar = segs.filter((g) => g[1] > 0).map(([c, w, l]) => `<span class="${c}" style="width:${w}%" title="${l} ${Math.round(w)}%"></span>`).join("");
      const lab = segs.filter((g) => g[1] > 0 && g[0] !== "seg-unk").map(([, w, l]) => `${l} ${x.approx ? "~" : ""}${Math.round(w)}%`).join(" · ");
      return `<div class="mix-row"><div class="mix-label"><span class="sw c${i}"></span>${esc(s.short)}${x.year && x.year !== 2050 ? ` <span class="muted small">(${x.year})</span>` : ""}</div><div class="mixbar">${bar}</div><div class="mix-note">${esc(lab)}${x.note ? " — " + esc(x.note) : ""}</div></div>`;
    }).join("");

    // scores
    const dots = (n) => "●".repeat(n) + `<span style="opacity:.25">${"●".repeat(5 - n)}</span>`;
    $("#sc-scores").innerHTML = `<p class="muted small" style="margin:0 0 8px">Political achievability and the suggested likelihood are Claude's editorial judgements. Tap the stars to set your own likelihood; it's saved on this device.</p>` +
      chosen.map(({ s, i }) => {
        const mine = state.sc.mine[s.id];
        const val = mine ?? s.likelihood?.score ?? 0;
        const stars = [1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" data-sc="${esc(s.id)}" class="${n <= val ? "on" : ""}" aria-label="${n} of 5">★</button>`).join("");
        return `<div class="score-card"><h3><span class="sw c${i}"></span>${esc(s.name)}</h3>
          <div class="score-line"><span class="k">Political achievability</span><div><span class="dots">${dots(s.political?.score || 0)}</span><p class="why">${highlight(esc(s.political?.why || ""))}</p></div></div>
          <div class="score-line"><span class="k">Your likelihood</span><div><span class="stars">${stars}</span>
            <p class="why">${mine != null ? `Your score. Suggested: ${s.likelihood?.score}/5. <button class="link small" data-reset="${esc(s.id)}">Reset</button>` : `Suggested ${s.likelihood?.score}/5`} — ${highlight(esc(s.likelihood?.why || ""))}</p></div></div>
        </div>`;
      }).join("");

    // warming strip
    const lo = 1, hi = 3.5;
    const rowsW = all.map((s) => ({ s, t: s.values?.temp2100?.v })).filter((x) => x.t != null)
      .concat((S.context || []).map((c) => ({ ref: c, t: c.temp }))).sort((a, b) => b.t - a.t);
    $("#sc-strip").innerHTML = rowsW.map((r) => {
      const w = Math.max(2, ((r.t - lo) / (hi - lo)) * 100);
      const hue = Math.round(140 - Math.max(0, Math.min(1, (r.t - 1.4) / 1.6)) * 135);
      if (r.ref) return `<div class="strip-row ref"><span class="who" title="${esc(r.ref.label)}">${esc(r.ref.short || r.ref.label)}</span><div class="track"><div class="fill" style="width:${w}%"></div></div><span class="sval">${r.t.toFixed(1)}°</span></div>`;
      return `<button class="strip-row" data-pick="${esc(r.s.id)}"><span class="who">${esc(r.s.short)}</span><div class="track"><div class="fill" style="width:${w}%;background:hsl(${hue} 65% 45%)"></div></div><span class="sval">${r.t.toFixed(1)}°</span></button>`;
    }).join("") + `<div class="strip-axis"><span></span><div><span>1.0 °C</span><span>1.5</span><span>2.0</span><span>2.5</span><span>3.0</span><span>3.5</span></div><span></span></div><p class="muted small">Tap a scenario to load it as the first comparison. Grey rows are UNEP's 2025 estimates for where current policies, NDC pledges, and NDCs plus all net-zero pledges lead.</p>`;

    // list
    const tf = state.sc.type;
    $("#sc-type").innerHTML = [["all", "All"]].concat(Object.entries(SC_TYPE), Object.entries(SC_PUB)).map(([k, l]) =>
      `<button class="chip ${tf === k ? "on" : ""}" data-type="${k}">${l}</button>`).join("");
    const list = all.filter((s) => tf === "all" || s.type === tf || s.publisherType === tf);
    $("#sc-list").innerHTML = list.map((s) => `<li class="card">
      <div class="meta"><span class="sc-type-badge t-${esc(s.type)}">${esc(SC_TYPE[s.type] || s.type)}</span><span>${esc(SC_PUB[s.publisherType] || "")}</span></div>
      <h3><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></h3>
      <div class="design">${esc(s.publisher)} · ${esc(s.edition)}</div>
      <p>${highlight(esc(s.summary))}</p>
      ${s.facts?.length ? `<ul class="facts-list">${s.facts.map((f) => `<li>${highlight(esc(f))}</li>`).join("")}</ul>` : ""}
      <p class="small">Model: ${esc(s.model)}</p>
      <div class="cmp-btns">${[0, 1, 2].map((i) => `<button data-set="${i}" data-sc="${esc(s.id)}"><span class="sw c${i}"></span>Compare as ${i + 1}</button>`).join("")}</div>
    </li>`).join("");

    $("#sc-sources").innerHTML = `<strong>Sources</strong><ul>${(S.sources || []).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("")}</ul>
      <p>Exploratory = "what if current trends/policies continue"; normative = works back from a goal; forecast = the publisher's best guess. Edit <code>data/scenarios.json</code> to add or correct entries.</p>`;
  }
  function scSave() { store.set("scSel", state.sc.sel); store.set("scMine", state.sc.mine); }
  $("#sc-pickers").addEventListener("change", (e) => { const s = e.target.closest("select"); if (!s) return; state.sc.sel[+s.dataset.i] = s.value; scSave(); renderScenarios(); });
  $("#sc-groups").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { state.sc.group = b.dataset.g; renderScenarios(); } });
  $("#sc-type").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) { state.sc.type = b.dataset.type; renderScenarios(); } });
  $("#view-scenarios").addEventListener("click", (e) => {
    const st = e.target.closest("[data-star]");
    if (st) { state.sc.mine[st.dataset.sc] = +st.dataset.star; scSave(); renderScenarios(); return; }
    const rs = e.target.closest("[data-reset]");
    if (rs) { delete state.sc.mine[rs.dataset.reset]; scSave(); renderScenarios(); return; }
    const pk = e.target.closest("[data-pick]");
    if (pk) { state.sc.sel[0] = pk.dataset.pick; scSave(); renderScenarios(); $("#sc-pickers").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const set = e.target.closest("[data-set]");
    if (set) { state.sc.sel[+set.dataset.set] = set.dataset.sc; scSave(); renderScenarios(); $("#sc-pickers").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const mt = e.target.closest("[data-metric]");
    if (mt) {
      const m = (state.scen.metrics || []).find((x) => x.id === mt.dataset.metric); if (!m) return;
      const terms = (m.terms || []).filter((t) => findTerm(t));
      openSheet(`<h2>${esc(m.label)}</h2><p>${esc(m.desc)}</p>${terms.length ? `<div class="related">${terms.map((t) => `<button data-term="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}<div class="sheet-actions"><span></span><button class="btn ghost" data-close>Close</button></div>`);
      return;
    }
    const t = e.target.closest("[data-term]"); if (t) openTerm(t.dataset.term);
  });

  // ---------- LITERATURE ----------
  function litLink(i) {
    if (i.doi) return "https://doi.org/" + i.doi;
    if (i.url) return i.url;
    return "https://scholar.google.com/scholar?q=" + encodeURIComponent(i.title);
  }
  function litCard(i) {
    return `<li class="card${i.nuclear ? " lead-nuclear" : ""}">
      <div class="meta"><span class="tag tech">${esc(i.type)}</span>${i.nuclear ? '<span class="tag nuclear">⚛ nuclear</span>' : ""}${i.perspective ? `<span class="tag general">${esc(i.perspective)}</span>` : ""}<span>${esc(i.year)}</span></div>
      <h3><a href="${esc(litLink(i))}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
      <div class="design">${esc(i.authors)} · ${esc(i.venue)}</div>
      <p class="lit-finding">${highlight(esc(i.finding))}</p>
      <p class="small"><strong>Why it matters:</strong> ${esc(i.why)}</p>
    </li>`;
  }
  function renderLiterature() {
    const L = state.literature, { q, cat, sort, nuclear } = state.lit;
    const cats = L.categories || [], all = L.items || [];
    $("#lit-cat").innerHTML = [`<button class="chip ${cat === "all" ? "on" : ""}" data-cat="all">All<span class="n">${all.length}</span></button>`]
      .concat(cats.map((c) => `<button class="chip ${cat === c.id ? "on" : ""}" data-cat="${esc(c.id)}">${esc(c.label)}<span class="n">${all.filter((i) => i.category === c.id).length}</span></button>`)).join("");
    $("#lit-nuc").classList.toggle("on", nuclear);
    document.querySelectorAll("#lit-sort button").forEach((b) => b.classList.toggle("on", b.dataset.sort === sort));
    $("#lit-note").textContent = L.about ? `${L.about} Last updated ${L.updated}.` : "";
    const ql = q.toLowerCase();
    const items = all.filter((i) => (cat === "all" || i.category === cat) && (!nuclear || i.nuclear) &&
      (!ql || [i.title, i.authors, i.venue, i.finding, i.why, i.type, (i.tags || []).join(" ")].join(" ").toLowerCase().includes(ql)));
    if (!items.length) { $("#lit-list").innerHTML = `<p class="empty">No matching studies.</p>`; return; }
    if (sort === "category") {
      $("#lit-list").innerHTML = cats.map((c) => {
        const g = items.filter((i) => i.category === c.id);
        return g.length ? `<div class="src-group"><h2>${esc(c.label)}</h2><p class="muted small lit-blurb">${esc(c.blurb)}</p><ul class="cards">${g.map(litCard).join("")}</ul></div>` : "";
      }).join("");
    } else {
      const d = sort === "newest" ? -1 : 1;
      $("#lit-list").innerHTML = `<ul class="cards">${items.slice().sort((a, b) => d * (a.year - b.year)).map(litCard).join("")}</ul>`;
    }
  }
  $("#lit-search").addEventListener("input", (e) => { state.lit.q = e.target.value.trim(); renderLiterature(); });
  $("#lit-cat").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { state.lit.cat = b.dataset.cat; renderLiterature(); } });
  $("#lit-sort").addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (b) { state.lit.sort = b.dataset.sort; renderLiterature(); } });
  $("#lit-nuc").addEventListener("click", () => { state.lit.nuclear = !state.lit.nuclear; renderLiterature(); });
  $("#lit-list").addEventListener("click", (e) => { const t = e.target.closest("[data-term]"); if (t) openTerm(t.dataset.term); });

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
    state.scen = scen;
    state.literature = lit;
    state.articles = articles; state.sources = sources.sources || []; state.companies = companies; state.glossaryBase = gl;
    buildHighlighter();
    $("#updated").textContent = articles.generated ? "Updated " + relTime(articles.generated) : "";
    renderHealth(); renderFeed(); renderCompanies(); renderGlossary(); renderScenarios(); renderLiterature(); renderSources();
    show(store.get("view", "feed"));
  }
  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
