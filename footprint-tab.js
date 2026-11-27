/* CO₂ footprint tab for Energy Hub. Vanilla JS, no dependencies.
 * Data: data/footprint.json (hand-curated, every item links its study).
 * Sections: search box that opens a full card for any item, donut of the main offenders
 * (by sector / by country), "AI in context" bars, a log-scale carbon ladder, and the cards.
 * Items you add yourself are kept on this device (localStorage "eh.fp.custom").
 * Uses window.EH from app.js for escaping, glossary highlighting, the sheet and feed search. */
(() => {
  "use strict";
  const EH = window.EH;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = EH.esc;
  const store = {
    get(k, f) { try { const v = localStorage.getItem("eh.fp." + k); return v == null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem("eh.fp." + k, JSON.stringify(v)); } catch {} },
  };

  // Blue-to-yellow ramp shared with the Energy tab; largest slice darkest. "Rest" is neutral.
  const RAMP = ["#115f9a", "#1984c5", "#22a7f0", "#48b5c4", "#76c68f", "#a6d75b", "#c9e52f", "#f4f100", "#e0ae00"];
  const CAT_COL = { offender: "#115f9a", ai: "var(--tech)", digital: "#22a7f0", transport: "#48b5c4", food: "#76c68f", home: "#a6d75b", goods: "#c9e52f", people: "var(--nuclear)", mine: "var(--modelling)" };
  const CONF = { high: "Solid data", med: "Reasonable estimate", low: "Rough estimate" };

  let D = null;
  const st = Object.assign({ pie: "sector", slice: null, cat: "ai" }, store.get("state", {}));
  const save = () => store.set("state", { pie: st.pie, cat: st.cat });
  let custom = store.get("custom", []);

  // ---------- formatting ----------
  function num(v) {
    const a = Math.abs(v);
    if (a >= 100) return Math.round(v).toLocaleString("en-US");
    if (a >= 10) return String(Math.round(v * 10) / 10);
    if (a >= 1) return String(Math.round(v * 100) / 100);
    return String(Number(v.toPrecision(2)));
  }
  // kg → "0.15 g", "60 kg", "1.9 t", "180 Mt", "10.5 Gt"
  function mass(kg) {
    if (kg == null) return "–";
    const u = [[1e12, "Gt"], [1e9, "Mt"], [1e6, "kt"], [1e3, "t"], [1, "kg"]];
    for (const [f, n] of u) if (kg >= f) return num(kg / f) + " " + n;
    return num(kg * 1000) + " g";
  }
  const range = (it) => (it.lo !== it.hi && it.lo != null ? `${mass(it.lo)} – ${mass(it.hi)}` : "");
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.+ ]/g, " ").replace(/\s+/g, " ").trim();
  const catLabel = (id) => (id === "mine" ? "Added by you" : D.categories.find((c) => c.id === id)?.label || id);
  const all = () => D.items.concat(custom);
  const byId = (id) => all().find((x) => x.id === id);

  // ---------- tooltip (own copy, scoped to this tab) ----------
  const tip = document.createElement("div");
  tip.className = "en-tip hidden"; tip.setAttribute("role", "status");
  document.body.appendChild(tip);
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.remove("hidden");
    const r = tip.getBoundingClientRect(), pad = 14;
    let left = x + pad, top = y + pad;
    if (left + r.width > innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > innerHeight - 8) top = y - r.height - pad;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => tip.classList.add("hidden");
  const inTab = (t) => t && t.closest("#view-footprint");
  document.addEventListener("pointermove", (e) => { const t = e.target.closest?.("[data-fptip]"); if (inTab(t)) showTip(t.dataset.fptip, e.clientX, e.clientY); });
  document.addEventListener("pointerout", (e) => { if (e.target.closest?.("[data-fptip]")) hideTip(); });
  addEventListener("scroll", hideTip, { passive: true });

  // ---------- search ----------
  function trigrams(s) { const t = new Set(), p = `  ${s} `; for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3)); return t; }
  function sim(a, b) { const A = trigrams(a), B = trigrams(b); let n = 0; A.forEach((x) => B.has(x) && n++); return (2 * n) / (A.size + B.size); }
  function score(it, q) {
    const words = q.split(" ").filter(Boolean);
    let best = 0;
    for (const raw of [it.name, ...(it.aliases || [])]) {
      const c = norm(raw);
      let s = 0;
      if (c === q) s = 100;
      else if (c.startsWith(q)) s = 85;
      else if ((" " + c + " ").includes(" " + q + " ")) s = 75;
      else if (c.includes(q)) s = 60;
      else if (words.length > 1 && words.every((w) => c.includes(w))) s = 55;
      else s = 45 * sim(c, q);
      if (raw !== it.name) s -= 3;                         // a hit on the name beats one on an alias
      best = Math.max(best, s);
    }
    return best;
  }
  function search(q) {
    q = norm(q); if (!q) return [];
    return all().map((it) => ({ it, s: score(it, q) })).filter((x) => x.s >= 18).sort((a, b) => b.s - a.s || a.it.name.length - b.it.name.length);
  }

  function renderResults(q) {
    const box = $("#fp-results");
    if (!q.trim()) { box.classList.add("hidden"); box.innerHTML = ""; $("#fp-q").setAttribute("aria-expanded", "false"); return; }
    const hits = search(q).slice(0, 7);
    const strong = hits.filter((h) => h.s >= 40);
    let html = strong.map((h, i) => `<li role="option" id="fp-opt-${i}" data-open="${esc(h.it.id)}"${i === 0 ? ' aria-selected="true"' : ""}>
        <span class="fp-r-name">${esc(h.it.name)}</span><span class="fp-r-val">${esc(mass(h.it.kg))} <small>${esc(h.it.unit)}</small></span></li>`).join("");
    if (!strong.length) {
      const near = hits.slice(0, 4);
      html = `<li class="fp-r-none"><strong>No card for “${esc(q.trim())}” yet.</strong>${near.length ? " Closest:" : ""}</li>`
        + near.map((h) => `<li role="option" data-open="${esc(h.it.id)}"><span class="fp-r-name">${esc(h.it.name)}</span><span class="fp-r-val">${esc(mass(h.it.kg))}</span></li>`).join("");
    }
    html += `<li class="fp-r-add" role="option" data-add="${esc(q.trim())}">＋ Add “${esc(q.trim())}” as your own card</li>`;
    box.innerHTML = html; box.classList.remove("hidden"); $("#fp-q").setAttribute("aria-expanded", "true");
  }

  // ---------- hero ----------
  function renderHero() {
    const t = D.totals, dc = byId("datacentres-global"), ch = byId("person-ch");
    const k = [
      [`${t.gt} Gt`, `World greenhouse gases, ${t.year}`, t.gtNote],
      [`${num((t.gt * 1000) / t.population / 1000)} t`, "Per person per year, world average", "Total divided by 8.2 billion people."],
      [mass(ch.kg), "Swiss resident, incl. imports", ch.scope],
      [`${num((100 * dc.kg) / (t.gt * 1e12))}%`, "All data centres' share (AI included)", dc.summary],
    ];
    $("#fp-kpis").innerHTML = k.map(([v, l, n]) => `<div class="fp-kpi" data-fptip="${esc(n)}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
  }

  // ---------- donut ----------
  function arc(cx, cy, r0, r1, a0, a1) {
    const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    return `M${x0},${y0}A${r1},${r1} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${large} 0 ${x3},${y3}Z`;
  }
  function pieData() {
    const p = D.pies.find((x) => x.id === st.pie) || D.pies[0];
    const rest = p.slices.filter((s) => s.id === "rest");
    const sl = p.slices.filter((s) => s.id !== "rest").sort((a, b) => b.pct - a.pct).concat(rest);
    sl.forEach((s, i) => (s.color = s.id === "rest" ? "var(--general)" : RAMP[i % RAMP.length]));
    return { p, sl };
  }
  function renderPie() {
    const { p, sl } = pieData();
    $$("#fp-pie-kind button").forEach((b) => { const on = b.dataset.v === p.id; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    $("#fp-pie-title").textContent = p.title;
    const total = D.totals.gt, S = 260, c = S / 2, r1 = 122, r0 = 74;
    let a = 0;
    const sel = sl.find((s) => s.id === st.slice);
    const paths = sl.map((s) => {
      const a0 = a, a1 = a + (2 * Math.PI * s.pct) / 100; a = a1;
      const on = sel && sel.id === s.id, dim = sel && !on;
      const mid = (a0 + a1) / 2, off = on ? 6 : 0;
      const tr = off ? ` transform="translate(${off * Math.sin(mid)},${-off * Math.cos(mid)})"` : "";
      const gt = (total * s.pct) / 100;
      return `<path d="${arc(c, c, r0, r1, a0, a1)}" fill="${s.color}" class="fp-slice${dim ? " dim" : ""}"${tr} data-slice="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.label)}: ${s.pct}%, about ${num(gt)} Gt"
        data-fptip="<strong>${esc(s.label)}</strong><div class='tr'><b>${s.pct}%</b></div><div class='tn'>≈${num(gt)} Gt CO₂e a year</div>"/>`;
    }).join("");
    const big = sel ? `${sel.pct}%` : `${total} Gt`;
    const small = sel ? sel.label : `CO₂e in ${D.totals.year}`;
    $("#fp-pie").innerHTML = `<svg viewBox="0 0 ${S} ${S}" class="fp-donut" role="img" aria-label="${esc(p.title)}">${paths}
      <text x="${c}" y="${c - 2}" text-anchor="middle" class="fp-d-big">${esc(big)}</text>
      <foreignObject x="${c - 62}" y="${c + 8}" width="124" height="44"><div xmlns="http://www.w3.org/1999/xhtml" class="fp-d-small">${esc(small)}</div></foreignObject></svg>`;
    $("#fp-legend").innerHTML = sl.map((s) => `<button class="fp-leg${sel && sel.id === s.id ? " on" : ""}${sel && sel.id !== s.id ? " dim" : ""}" data-slice="${esc(s.id)}">
        <i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${s.pct}%</b><small>${((total * s.pct) / 100).toFixed(1)} Gt</small></button>`).join("");
    const items = sel ? sel.items.map(byId).filter(Boolean) : [];
    $("#fp-slice-items").innerHTML = sel
      ? (items.length ? `<p class="fp-slice-h">Cards in “${esc(sel.label)}”</p><div class="fp-pills">${items.map((it) => `<button class="fp-pill" data-open="${esc(it.id)}">${esc(it.name)} <span>${esc(mass(it.kg))}</span></button>`).join("")}</div>`
        : `<p class="fp-slice-h">No cards for this slice yet.</p>`)
      : `<p class="fp-slice-h muted">Tap a slice to see its cards.</p>`;
    $("#fp-pie-note").innerHTML = `${esc(p.note)} ${p.ref.map(refLink).join(" · ")}`;
  }

  // ---------- AI in context ----------
  function renderContext() {
    const ids = ["coal-power-global", "livestock-global", "road-global", "landuse-global", "steel-industry", "methane-fossil", "cement-industry", "military-global", "plastics-global", "fashion-global", "shipping-global", "cooling-global", "aviation-global", "datacentres-global", "bitcoin-year"];
    const rows = ids.map(byId).filter(Boolean).sort((a, b) => b.kg - a.kg);
    const max = rows[0].kg;
    $("#fp-context").innerHTML = rows.map((it) => {
      const hl = it.id === "datacentres-global" || it.id === "bitcoin-year";
      return `<button class="fp-hrow${hl ? " hl" : ""}" data-open="${esc(it.id)}" data-fptip="<strong>${esc(it.name)}</strong><div class='tn'>${esc(it.summary)}</div>">
        <span class="fp-hl">${esc(it.name.replace(/, worldwide| \(estimated\)/g, ""))}</span>
        <span class="fp-ht"><i style="width:${Math.max(0.6, (100 * it.kg) / max)}%"></i>${it.hi > it.kg ? `<em style="left:${(100 * it.kg) / max}%;width:${(100 * (Math.min(it.hi, max) - it.kg)) / max}%"></em>` : ""}</span>
        <b>${esc(mass(it.kg))}</b></button>`;
    }).join("");
  }

  // ---------- carbon ladder (log scale) ----------
  function visible() {
    if (st.cat === "all") return all();
    if (st.cat === "mine") return custom;
    return D.items.filter((i) => i.cat === st.cat);
  }
  function renderChips() {
    const cats = D.categories.concat(custom.length ? [{ id: "mine", label: "Added by you" }] : []);
    const n = (id) => (id === "all" ? all().length : id === "mine" ? custom.length : D.items.filter((i) => i.cat === id).length);
    $("#fp-cats").innerHTML = [{ id: "all", label: "All" }].concat(cats).map((c) =>
      `<button class="chip ${st.cat === c.id ? "on" : ""}" data-cat="${esc(c.id)}" aria-pressed="${st.cat === c.id}">${esc(c.label)}<span class="n">${n(c.id)}</span></button>`).join("");
    const c = cats.find((x) => x.id === st.cat);
    $("#fp-cat-blurb").textContent = c?.blurb || (st.cat === "all" ? "Everything, from one AI prompt to coal power worldwide: 17 orders of magnitude." : "");
  }
  function renderLadder() {
    const items = visible().slice().sort((a, b) => a.kg - b.kg);
    const el = $("#fp-ladder");
    if (!items.length) { el.innerHTML = `<p class="muted">Nothing here yet.</p>`; return; }
    const lo = Math.floor(Math.log10(Math.min(...items.map((i) => i.lo ?? i.kg)))), hi = Math.ceil(Math.log10(Math.max(...items.map((i) => i.hi ?? i.kg))));
    const L0 = Math.min(lo, hi - 2), L1 = Math.max(hi, lo + 2), span = L1 - L0;
    const x = (kg) => (100 * (Math.log10(kg) - L0)) / span;
    const step = span > 12 ? 3 : span > 6 ? 2 : 1;
    const ticks = []; for (let e = L0; e <= L1; e++) if ((e - L0) % step === 0 || e === L1) ticks.push(e);
    const axis = `<div class="fp-axis">${ticks.map((e) => `<span style="left:${x(10 ** e)}%">${esc(mass(10 ** e))}</span>`).join("")}</div>`;
    const grid = ticks.map((e) => `<i style="left:${x(10 ** e)}%"></i>`).join("");
    el.innerHTML = axis + items.map((it) => {
      const a = x(it.lo ?? it.kg), b = x(it.hi ?? it.kg), c = x(it.kg);
      return `<button class="fp-lrow" data-open="${esc(it.id)}" style="--c:${CAT_COL[it.cat] || "var(--accent)"}"
          data-fptip="<strong>${esc(it.name)}</strong><div class='tr'><b>${esc(mass(it.kg))}</b><span></span></div><div class='tn'>${esc(it.unit)}${range(it) ? " · range " + esc(range(it)) : ""}</div>">
        <span class="fp-ln">${esc(it.name)}<small>${esc(it.unit)}</small></span>
        <span class="fp-lt">${grid}${b - a > 0.3 ? `<em style="left:${a}%;width:${b - a}%"></em>` : ""}<b style="left:${c}%"></b></span>
        <span class="fp-lv">${esc(mass(it.kg))}</span></button>`;
    }).join("") + `<p class="en-foot">Log scale: each gridline is ${step === 1 ? "10×" : step === 2 ? "100×" : "1,000×"} the previous. Dot is the typical value, the bar the range between studies or producers. Units differ (per prompt, per kg, per year), so read the label.</p>`;
  }

  // ---------- cards ----------
  function card(it) {
    return `<li class="fp-card" style="--c:${CAT_COL[it.cat] || "var(--accent)"}"><button class="en-card-hit" data-open="${esc(it.id)}" aria-label="Full card: ${esc(it.name)}"></button>
      <div class="fp-c-top"><span class="fp-c-cat">${esc(catLabel(it.cat))}</span>${it.conf ? `<span class="fp-conf c-${it.conf}" title="${esc(CONF[it.conf])}">${esc(CONF[it.conf])}</span>` : ""}</div>
      <h3>${esc(it.name)}</h3>
      <div class="fp-c-val"><b>${esc(mass(it.kg))}</b> <span>CO₂e ${esc(it.unit)}</span></div>
      <p>${esc(it.summary || "")}</p></li>`;
  }
  function renderCards() {
    const items = visible().slice();
    if (st.cat === "all") items.sort((a, b) => D.categories.findIndex((c) => c.id === a.cat) - D.categories.findIndex((c) => c.id === b.cat));
    $("#fp-cards").innerHTML = items.map(card).join("") || `<li class="empty"><strong>No cards here.</strong></li>`;
  }

  // ---------- full card ----------
  function refLink(k) { const r = D.refs[k]; return r ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>` : esc(k); }
  function equivalents(it) {
    return D.equivalents
      .filter((e) => !(it.id === "flight-zrh-nyc" && e.id === "nyc") && !(it.id === "person-ch" && e.id === "swiss") && !(it.id.startsWith("beef") && e.id === "beef") && !(it.id === "kettle" && e.id === "kettle"))
      .map((e) => ({ e, n: it.kg / e.kg }))
      .filter((x) => x.n >= 0.02 && x.n <= 2e6)
      .sort((a, b) => Math.abs(Math.log10(a.n) - 1) - Math.abs(Math.log10(b.n) - 1))
      .slice(0, 4)
      .sort((a, b) => a.e.kg - b.e.kg);
  }
  function rank(it) {
    if (it.custom) return "";
    const same = D.items.filter((x) => x.cat === it.cat).sort((a, b) => b.kg - a.kg);
    return same.length > 2 ? `#${same.indexOf(it) + 1} of ${same.length} in ${catLabel(it.cat)}` : "";
  }
  function openItem(id) {
    const it = byId(id); if (!it) return;
    $("#fp-results").classList.add("hidden");
    const eq = equivalents(it);
    const phases = it.phases?.length ? `<h3 class="en-h3">Where it comes from</h3>
      <div class="fp-phase">${it.phases.map(([l, v], i) => `<i style="flex:${v};background:${RAMP[i * 2 % RAMP.length]}" data-fptip="${esc(l)}: ${v}%"></i>`).join("")}</div>
      <ul class="fp-phase-l">${it.phases.map(([l, v], i) => `<li><i style="background:${RAMP[i * 2 % RAMP.length]}"></i>${esc(l)}<b>${v}%</b></li>`).join("")}</ul>` : "";
    const facts = [["Typical", `${mass(it.kg)} CO₂e`], range(it) ? ["Range", range(it)] : null, it.energy ? ["Energy", it.energy] : null, it.water ? ["Water", it.water] : null].filter(Boolean);
    EH.openSheet(`<div class="fp-s-head" style="--c:${CAT_COL[it.cat] || "var(--accent)"}"><span class="fp-c-cat">${esc(catLabel(it.cat))}</span>${it.conf ? `<span class="fp-conf c-${it.conf}">${esc(CONF[it.conf])}</span>` : ""}<span class="muted small">${esc(rank(it))}</span></div>
      <h2>${esc(it.name)}</h2>
      <div class="fp-s-big"><b>${esc(mass(it.kg))}</b><span>CO₂e ${esc(it.unit)}</span></div>
      <dl class="fp-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${it.summary ? `<p>${EH.highlight(esc(it.summary))}</p>` : ""}
      ${eq.length ? `<h3 class="en-h3">That is about</h3><ul class="fp-eq">${eq.map(({ e, n }) => `<li>${n >= 1 ? esc(e.fmt).replace("{n}", `<b>${esc(num(n))}</b>`) : `<b>${esc(num(100 * n))}%</b> of ${esc(e.one)}`}</li>`).join("")}</ul>` : ""}
      ${phases}
      ${it.scope ? `<h3 class="en-h3">What is counted</h3><p>${EH.highlight(esc(it.scope))}</p>` : ""}
      ${it.context ? `<h3 class="en-h3">Context</h3><p>${EH.highlight(esc(it.context))}</p>` : ""}
      ${it.tips?.length ? `<h3 class="en-h3">How to cut it</h3><ul class="facts-list">${it.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${it.refs?.length ? `<h3 class="en-h3">Sources</h3><ol class="en-refs">${it.refs.map((r) => `<li>${refLink(r)}</li>`).join("")}</ol>` : ""}
      ${it.srcUrl ? `<h3 class="en-h3">Your source</h3><p class="small"><a href="${esc(it.srcUrl)}" target="_blank" rel="noopener">${esc(it.srcUrl)}</a></p>` : ""}
      ${it.custom ? "" : `<p class="basis">${esc(D.gridNote)}</p>`}
      <div class="sheet-actions"><span class="row gap">${it.custom ? `<button class="btn ghost" data-fpdel="${esc(it.id)}">Delete</button><button class="btn ghost" data-fpedit="${esc(it.id)}">Edit</button>` : `<button class="btn ghost" data-news="${esc((it.aliases && it.aliases[0]) || it.name)}">News in feed</button>`}</span><button class="btn" data-close>Done</button></div>`);
    const body = $("#sheet-body");
    $$("[data-news]", body).forEach((b) => (b.onclick = () => EH.searchFeed(b.dataset.news)));
    $$("[data-fpdel]", body).forEach((b) => (b.onclick = () => { custom = custom.filter((x) => x.id !== b.dataset.fpdel); store.set("custom", custom); if (!custom.length && st.cat === "mine") st.cat = "ai"; EH.closeSheet(); renderList(); }));
    $$("[data-fpedit]", body).forEach((b) => (b.onclick = () => openForm(b.dataset.fpedit)));
  }

  // ---------- your own cards ----------
  const UNIT = { g: 0.001, kg: 1, t: 1000 };
  function openForm(arg) {
    const ed = custom.find((x) => x.id === arg);
    const name = ed ? ed.name : arg || "";
    const [val, u] = ed ? (ed.kg >= 1000 ? [ed.kg / 1000, "t"] : ed.kg < 1 ? [ed.kg * 1000, "g"] : [ed.kg, "kg"]) : ["", "kg"];
    EH.openSheet(`<h2>${ed ? "Edit your card" : "Add your own card"}</h2>
      <p class="muted">Kept on this device only. Good sources: the product's own life-cycle report, Our World in Data, the UK government conversion factors, or a study's summary table.</p>
      <form class="form" id="fp-form">
        <label>Name<input name="name" required value="${esc(name)}" autocomplete="off"></label>
        <div class="pair"><label>Amount of CO₂e<input name="val" type="number" step="any" min="0" required value="${esc(String(val))}" inputmode="decimal"></label>
          <label>Unit<select name="u">${Object.keys(UNIT).map((k) => `<option ${k === u ? "selected" : ""}>${k}</option>`).join("")}</select></label></div>
        <label>Per (what one unit is)<input name="per" placeholder="per kg, per trip, per year…" value="${esc(ed?.unit || "")}"></label>
        <label>Other names to find it by (comma separated)<input name="aliases" value="${esc((ed?.aliases || []).join(", "))}"></label>
        <label>Notes: what is counted, context<textarea name="note">${esc(ed?.summary || "")}</textarea></label>
        <label>Source link<input name="src" type="url" placeholder="https://" value="${esc(ed?.srcUrl || "")}"></label>
        <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save</button></div>
      </form>`);
    $("#fp-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target), kg = Number(f.get("val")) * UNIT[f.get("u")];
      if (!(kg >= 0)) return;
      const it = { id: ed ? ed.id : "mine-" + Date.now().toString(36), cat: "mine", custom: true, name: String(f.get("name")).trim(),
        aliases: String(f.get("aliases") || "").split(",").map((s) => s.trim()).filter(Boolean), unit: String(f.get("per") || "").trim() || "per item",
        kg, lo: kg, hi: kg, summary: String(f.get("note") || "").trim(), srcUrl: String(f.get("src") || "").trim(), refs: [] };
      custom = ed ? custom.map((x) => (x.id === ed.id ? it : x)) : custom.concat(it);
      store.set("custom", custom); st.cat = "mine"; save(); renderList(); openItem(it.id);
    });
  }

  // ---------- wiring ----------
  function renderList() { renderChips(); renderLadder(); renderCards(); }
  function renderAll() {
    $("#fp-about").textContent = `${D.about} Last checked ${D.updated}.`;
    renderHero(); renderPie(); renderContext(); renderList();
    $("#fp-refs").innerHTML = `<ol class="en-refs">${Object.keys(D.refs).map((k) => `<li>${refLink(k)}</li>`).join("")}</ol>`;
  }
  function wire() {
    const v = $("#view-footprint"), q = $("#fp-q"), box = $("#fp-results");
    let active = 0;
    const opts = () => $$("li[data-open], li[data-add]", box);
    const mark = () => opts().forEach((o, i) => o.setAttribute("aria-selected", i === active));
    q.addEventListener("input", () => { active = 0; renderResults(q.value); });
    q.addEventListener("focus", () => q.value && renderResults(q.value));
    q.addEventListener("keydown", (e) => {
      const o = opts(); if (!o.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % o.length; mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + o.length) % o.length; mark(); }
      else if (e.key === "Enter") { e.preventDefault(); o[active].click(); }
      else if (e.key === "Escape") box.classList.add("hidden");
    });
    box.addEventListener("click", (e) => {
      const a = e.target.closest("[data-add]"); if (a) { box.classList.add("hidden"); return openForm(a.dataset.add); }
      const o = e.target.closest("[data-open]"); if (o) openItem(o.dataset.open);
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".fp-search")) box.classList.add("hidden"); });
    $$("#fp-examples button").forEach((b) => (b.onclick = () => { q.value = b.dataset.q; renderResults(q.value); q.focus(); }));
    $("#fp-pie-kind").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) { st.pie = b.dataset.v; st.slice = null; save(); renderPie(); } });
    const pick = (id) => { st.slice = st.slice === id ? null : id; renderPie(); };
    $("#fp-pie-wrap").addEventListener("click", (e) => { const s = e.target.closest("[data-slice]"); if (s) pick(s.dataset.slice); });
    $("#fp-pie").addEventListener("keydown", (e) => { const s = e.target.closest("[data-slice]"); if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(s.dataset.slice); } });
    $("#fp-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { st.cat = b.dataset.cat; save(); renderList(); } });
    $("#fp-add").addEventListener("click", () => openForm(""));
    v.addEventListener("click", (e) => {
      if (e.target.closest("#fp-results")) return;
      const o = e.target.closest("[data-open]"); if (o) openItem(o.dataset.open);
    });
  }

  async function init() {
    try { const r = await fetch("data/footprint.json", { cache: "no-cache" }); if (!r.ok) throw 0; D = await r.json(); }
    catch { $("#fp-about").textContent = "Could not load data/footprint.json."; return; }
    if (st.cat === "mine" && !custom.length) st.cat = "ai";
    wire(); renderAll();
  }
  init();
})();
