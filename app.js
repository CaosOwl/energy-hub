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

  // ---------- boot ----------
  async function boot() {
    applyTheme();
    const [articles, sources, companies, gl] = await Promise.all([
      load("data/articles.json", state.articles),
      load("data/sources.json", { sources: [] }),
      load("data/companies.json", state.companies),
      load("data/glossary.json", state.glossaryBase),
    ]);
    state.articles = articles; state.sources = sources.sources || []; state.companies = companies; state.glossaryBase = gl;
    buildHighlighter();
    $("#updated").textContent = articles.generated ? "Updated " + relTime(articles.generated) : "";
    renderHealth(); renderFeed(); renderCompanies(); renderGlossary(); renderSources();
    show(store.get("view", "feed"));
  }
  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
