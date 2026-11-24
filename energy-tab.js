/* Energy sources tab for Energy Hub. Vanilla JS, SVG charts, no dependencies.
 * Data: data/energy.json (technology metrics, hand-curated with sources)
 *       data/energy-countries.json (built by scripts/build_energy_data.py from OWID / Ember / Energy Institute)
 * One country picker at the top drives the hero, the mix chart, the highlights in the
 * country charts, the share/TWh/growth technology metrics and the source cards.
 * Uses window.EH from app.js for escaping, glossary highlighting, the sheet and feed search. */
(() => {
  "use strict";
  const EH = window.EH;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = EH.esc;
  const store = {
    get(k, f) { try { const v = localStorage.getItem("eh.en." + k); return v == null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem("eh.en." + k, JSON.stringify(v)); } catch {} },
  };

  // Stack order fossil → nuclear → renewables. Colours validated for colour-vision deficiency in this order.
  const SRC = ["coal", "oil", "gas", "nuclear", "bio", "hydro", "wind", "solar"];
  const SRC_NAME = { coal: "Coal", oil: "Oil & other fossil", gas: "Gas", nuclear: "Nuclear", bio: "Bio & other renewables", hydro: "Hydro", wind: "Wind", solar: "Solar" };
  const ITEM_SRC = { geothermal: "bio" };          // technology id → colour/series id
  const COUNTRY_SRC = { nuclear: "nuclear", hydro: "hydro", solar: "solar", wind: "wind", gas: "gas", coal: "coal", oil: "oil", bio: "bio" };
  const col = (id) => `var(--s-${ITEM_SRC[id] || id})`;
  const FOSSIL = ["coal", "oil", "gas"], RENEW = ["bio", "hydro", "wind", "solar"];

  const IND = [
    { id: "lowcarbon", label: "Low-carbon share (nuclear + renewables)", short: "Low-carbon", unit: "%", parts: ["nuclear", ...RENEW] },
    { id: "renew", label: "Renewable share", short: "Renewables", unit: "%", parts: RENEW },
    { id: "fossil", label: "Fossil share", short: "Fossil", unit: "%", parts: FOSSIL },
    { id: "nuclear", label: "Nuclear share", unit: "%", parts: ["nuclear"] },
    { id: "windsolar", label: "Wind + solar share", unit: "%", parts: ["wind", "solar"] },
    { id: "solar", label: "Solar share", unit: "%", parts: ["solar"] },
    { id: "wind", label: "Wind share", unit: "%", parts: ["wind"] },
    { id: "hydro", label: "Hydro share", unit: "%", parts: ["hydro"] },
    { id: "coal", label: "Coal share", unit: "%", parts: ["coal"] },
    { id: "gas", label: "Gas share", unit: "%", parts: ["gas"] },
    { id: "ci", label: "Carbon intensity of electricity", short: "Carbon intensity", unit: "g CO₂/kWh", field: "ci", lowGood: true },
    { id: "elecpc", label: "Electricity generation per person", unit: "kWh", field: "elecpc" },
    { id: "energypc", label: "Primary energy per person", unit: "kWh", field: "energypc", primary: true },
    { id: "gen", label: "Total electricity generation", unit: "TWh", total: true },
    { id: "imports", label: "Net electricity imports (share of demand)", unit: "%", field: "imports" },
  ];
  const REGION_GROUPS = [["all", "All"], ["region", "Regions"], ["europe", "Europe"], ["americas", "Americas"], ["asia", "Asia"], ["africa", "Africa"], ["oceania", "Oceania"]];
  const TRIO = ["var(--q-1)", "var(--q-2)", "var(--q-3)"];

  let T = null, C = null;                 // technology data, country data
  const st = Object.assign({
    country: "world", kind: "elec", pct: false,
    cmpGroup: "europe", cmpSort: "lowcarbon", cmpKind: "elec",
    rankInd: "lowcarbon", trendInd: "lowcarbon", trend: ["world", "ch", "de"],
    metric: "lcoe", tag: "all", sx: "co2", sy: "deaths", table: false,
  }, store.get("state", {}));
  if (st.ent && !store.get("state", {}).country) st.country = st.ent;   // migrate from first version
  const save = () => store.set("state", st);

  // ---------- formatting ----------
  function fmt(v) {
    if (v == null || Number.isNaN(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
    if (a >= 100) return String(Math.round(v));
    if (a >= 1) return String(+v.toFixed(1));
    if (a === 0) return "0";
    return String(+v.toPrecision(2));
  }
  const unitTxt = (u) => (u === "%" ? "%" : " " + u);
  const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(d);

  // ---------- tooltip ----------
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
  const inTab = (t) => t && t.closest("#view-energy, #sheet");
  document.addEventListener("pointerover", (e) => { const t = e.target.closest?.("[data-tip]"); if (inTab(t)) showTip(t.dataset.tip, e.clientX, e.clientY); });
  document.addEventListener("pointermove", (e) => { const t = e.target.closest?.("[data-tip]"); if (inTab(t)) showTip(t.dataset.tip, e.clientX, e.clientY); });
  document.addEventListener("pointerout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
  addEventListener("scroll", hideTip, { passive: true });

  // ---------- scales & paths ----------
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
    const steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];   // all divide cleanly into four ticks
    return steps.find((k) => n <= k + 1e-9) * p;
  }
  function linScale(max, a, b) { const m = niceMax(max); return { f: (v) => a + (b - a) * (v / m), ticks: [0, .25, .5, .75, 1].map((k) => k * m), max: m }; }
  function logScale(min, max, a, b) {
    const lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
    const span = Math.max(1, hi - lo);
    const ticks = []; for (let e = lo; e <= hi; e++) ticks.push(10 ** e);
    return { f: (v) => a + (b - a) * ((Math.log10(Math.max(v, 10 ** lo)) - lo) / span), ticks, min: 10 ** lo };
  }
  // Monotone cubic curve (no overshoot), as in d3.curveMonotoneX. Points must be ordered in x (either direction).
  function curve(pts, move = true) {
    const n = pts.length;
    if (!n) return "";
    const f = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
    if (n < 3) return (move ? "M" : "L") + pts.map(f).join("L");
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = (move ? "M" : "L") + f(pts[0]);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${f(pts[i + 1])}`;
    }
    return d;
  }
  const width = (el) => Math.max(280, Math.min(1000, el.clientWidth || $("#app").clientWidth - 32));
  const svgOpen = (w, h, label, cls = "") => `<svg class="ch ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">`;
  const yGrid = (ys, L, R, w, sfx = "") => ys.ticks.map((t) => `<line x1="${L}" x2="${w - R}" y1="${ys.f(t)}" y2="${ys.f(t)}" class="grid"/><text x="${L - 8}" y="${ys.f(t) + 4}" text-anchor="end">${fmt(t)}${sfx}</text>`).join("");
  function xYears(years, idx, X, w, L, R, h) {
    const x0 = idx[0], x1 = idx[idx.length - 1];
    const step = Math.ceil((x1 - x0) / Math.max(2, Math.floor((w - L - R) / 64)));
    return idx.filter((i) => (i - x0) % step === 0 || i === x1)
      .filter((i, k, a) => i === x1 || x1 - i >= step * 0.6 || k === 0)
      .map((i) => `<text x="${X(i)}" y="${h - 6}" text-anchor="${i === x1 ? "end" : i === x0 ? "start" : "middle"}">${years[i]}</text>`).join("");
  }

  // ---------- chart: stacked area over time ----------
  function stackArea(el, { years, layers, pct, unit, label }) {
    const w = width(el), h = w < 500 ? 240 : 300, L = 48, R = 6, Tp = 12, B = 26;
    const tot = years.map((_, i) => layers.reduce((s, l) => s + (l.values[i] || 0), 0));
    const idx = years.map((_, i) => i).filter((i) => tot[i] > 0);
    if (!idx.length) { el.innerHTML = `<p class="en-empty">No data for this selection.</p>`; return; }
    const x0 = idx[0], x1 = idx[idx.length - 1];
    const X = (i) => L + (w - L - R) * ((i - x0) / Math.max(1, x1 - x0));
    const ys = linScale(pct ? 100 : Math.max(...idx.map((i) => tot[i])), h - B, Tp);
    const val = (l, i) => (pct ? (100 * (l.values[i] || 0)) / tot[i] : l.values[i] || 0);
    let base = idx.map(() => 0), paths = "";
    layers.forEach((l, k) => {
      const top = idx.map((i, j) => base[j] + val(l, i));
      if (top.every((v, j) => v === base[j])) { base = top; return; }
      const up = idx.map((i, j) => [X(i), ys.f(top[j])]);
      const dn = idx.map((i, j) => [X(i), ys.f(base[j])]).reverse();
      paths += `<path class="area" style="--d:${k * 40}ms" d="${curve(up)}${curve(dn, false)}Z" fill="${l.color}"/>`;
      base = top;
    });
    el.innerHTML = svgOpen(w, h, label) + yGrid(ys, L, R, w, pct ? "%" : "") + paths + xYears(years, idx, X, w, L, R, h) +
      `<line class="xh hidden" y1="${Tp}" y2="${h - B}"/><rect class="hit" x="${L}" y="${Tp}" width="${w - L - R}" height="${h - B - Tp}" fill="transparent"/></svg>`;
    const svg = $("svg", el), xh = $(".xh", svg);
    const move = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * w;
      const i = Math.round(x0 + ((px - L) / (w - L - R)) * (x1 - x0));
      if (i < x0 || i > x1 || !tot[i]) return;
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.classList.remove("hidden");
      const rows = layers.filter((l) => l.values[i]).slice().reverse().map((l) =>
        `<div class="tr"><i style="background:${l.color}"></i>${esc(l.name)}<b>${fmt(l.values[i])}</b><span>${fmt((100 * l.values[i]) / tot[i])}%</span></div>`).join("");
      showTip(`<strong>${years[i]}</strong>${rows}<div class="tr tot">Total<b>${fmt(tot[i])} ${unit}</b><span></span></div>`, e.clientX, e.clientY);
    };
    $(".hit", svg).addEventListener("pointermove", move);
    $(".hit", svg).addEventListener("pointerdown", move);
    $(".hit", svg).addEventListener("pointerleave", () => { xh.classList.add("hidden"); hideTip(); });
  }

  // ---------- chart: lines over time ----------
  function lines(el, { years, series, unit, label, h: hh, area }) {
    const w = width(el), h = hh || (w < 500 ? 230 : 270), L = 44, Tp = 12, B = 26;
    const R = Math.min(140, Math.max(...series.map((s) => (s.name.length + 6) * 6.6)) + 14);
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    if (!all.length) { el.innerHTML = `<p class="en-empty">No data for this selection.</p>`; return; }
    const ys = linScale(Math.max(...all), h - B, Tp);
    const idx = years.map((_, i) => i).filter((i) => series.some((s) => s.values[i] != null));
    const X = (i) => L + (w - L - R) * ((i - idx[0]) / Math.max(1, idx[idx.length - 1] - idx[0]));
    let out = yGrid(ys, L, R, w) + xYears(years, idx, X, w, L, R, h);
    let defs = "";
    const ends = [];
    series.forEach((s, k) => {
      const segs = []; let cur = [];
      s.values.forEach((v, i) => { if (v == null || i < idx[0]) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), ys.f(v)]); });
      if (cur.length) segs.push(cur);
      if (area && segs.length) {
        const gid = "g" + Math.random().toString(36).slice(2, 8);
        defs += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
        for (const sg of segs) out += `<path d="${curve(sg)}L${sg[sg.length - 1][0]},${h - B}L${sg[0][0]},${h - B}Z" fill="url(#${gid})" class="fade"/>`;
      }
      for (const sg of segs) out += `<path class="line" style="--d:${k * 120}ms" pathLength="1" d="${curve(sg)}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
      const li = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
      if (li != null) ends.push({ s, y: ys.f(s.values[li]), x: X(li), v: s.values[li] });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15;
    for (const e of ends) out += `<circle cx="${e.x}" cy="${ys.f(e.v)}" r="4" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/><text x="${e.x + 9}" y="${e.y + 4}" class="lbl"><tspan class="strong">${fmt(e.v)}${unit === "%" ? "%" : ""}</tspan> ${esc(e.s.name)}</text>`;
    const dots = series.map((s) => `<circle class="hd hidden" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join("");
    el.innerHTML = svgOpen(w, h, label) + `<defs>${defs}</defs>` + out + `<line class="xh hidden" y1="${Tp}" y2="${h - B}"/>${dots}<rect class="hit" x="${L}" y="${Tp}" width="${w - L - R}" height="${h - B - Tp}" fill="transparent"/></svg>`;
    const svg = $("svg", el), xh = $(".xh", svg), hd = $$(".hd", svg);
    const move = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * w;
      const i = Math.max(idx[0], Math.min(idx[idx.length - 1], Math.round(idx[0] + ((px - L) / (w - L - R)) * (idx[idx.length - 1] - idx[0]))));
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.classList.remove("hidden");
      series.forEach((s, k) => { const v = s.values[i]; hd[k].classList.toggle("hidden", v == null); if (v != null) { hd[k].setAttribute("cx", X(i)); hd[k].setAttribute("cy", ys.f(v)); } });
      showTip(`<strong>${years[i]}</strong>` + series.map((s) => `<div class="tr"><i style="background:${s.color}"></i>${esc(s.name)}<b>${fmt(s.values[i])}${unitTxt(unit)}</b></div>`).join(""), e.clientX, e.clientY);
    };
    $(".hit", svg).addEventListener("pointermove", move);
    $(".hit", svg).addEventListener("pointerdown", move);
    $(".hit", svg).addEventListener("pointerleave", () => { xh.classList.add("hidden"); hd.forEach((d) => d.classList.add("hidden")); hideTip(); });
  }

  // ---------- chart: one tall segmented bar (today's mix), with direct labels ----------
  function mixBar(el, parts, total, label) {
    const w = width(el), h = 64, bh = 30;
    let x = 0, out = "", labels = "";
    const shown = parts.filter((p) => p.v > 0);
    shown.forEach((p, k) => {
      const pw = (w * p.v) / total;
      const first = k === 0, last = k === shown.length - 1, r = 10;
      const tipH = `<strong>${esc(p.name)}</strong><div class="tr">${fmt((100 * p.v) / total)}%<b>${fmt(p.v)} TWh</b></div>`;
      // rounded only on the outer ends
      const x0 = x, x1 = x + Math.max(0, pw - (last ? 0 : 2));
      const d = first && last ? `M${x0 + r},0H${x1 - r}Q${x1},0 ${x1},${r}V${bh - r}Q${x1},${bh} ${x1 - r},${bh}H${x0 + r}Q${x0},${bh} ${x0},${bh - r}V${r}Q${x0},0 ${x0 + r},0Z`
        : first ? `M${x0 + r},0H${x1}V${bh}H${x0 + r}Q${x0},${bh} ${x0},${bh - r}V${r}Q${x0},0 ${x0 + r},0Z`
        : last ? `M${x0},0H${x1 - r}Q${x1},0 ${x1},${r}V${bh - r}Q${x1},${bh} ${x1 - r},${bh}H${x0}Z`
        : `M${x0},0H${x1}V${bh}H${x0}Z`;
      out += `<path class="mseg" style="--d:${k * 50}ms" d="${d}" fill="${p.color}" data-tip="${esc(tipH)}"/>`;
      if (pw > 56) labels += `<text x="${x0 + 2}" y="${bh + 16}" class="lbl strong">${fmt((100 * p.v) / total)}%</text><text x="${x0 + 2}" y="${bh + 30}" class="mut">${esc(p.short || p.name)}</text>`;
      x += pw;
    });
    el.innerHTML = svgOpen(w, h, label, "en-mixbar") + out + labels + "</svg>";
  }

  // ---------- chart: 100% stacked horizontal bars ----------
  function stackBars(el, rows, label, focus) {
    const w = width(el), lw = Math.min(140, w * 0.3), rh = 16, gap = 12, Tp = 4;
    const h = Tp + rows.length * (rh + gap) + 18, bw = w - lw - 6;
    let out = [0, 25, 50, 75, 100].map((t) => `<line x1="${lw + (bw * t) / 100}" x2="${lw + (bw * t) / 100}" y1="${Tp}" y2="${h - 18}" class="grid"/><text x="${lw + (bw * t) / 100}" y="${h - 4}" text-anchor="${t === 0 ? "start" : t === 100 ? "end" : "middle"}">${t}%</text>`).join("");
    rows.forEach((r, k) => {
      const y = Tp + k * (rh + gap); let x = lw;
      const cls = r.id === focus ? "lbl strong focus" : r.id === "world" ? "lbl strong" : "lbl";
      if (r.id === focus) out += `<rect x="0" y="${y - 5}" width="${w}" height="${rh + 10}" rx="8" class="row-hl"/>`;
      out += `<text x="${lw - 10}" y="${y + rh / 2 + 4}" text-anchor="end" class="${cls}">${esc(r.label)}</text>`;
      const parts = r.parts.filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        const pw = (bw * p.v) / r.total, rr = rh / 2;
        const tipH = `<strong>${esc(r.label)} · ${esc(p.name)}</strong><div class="tr">${fmt((100 * p.v) / r.total)}%<b>${fmt(p.v)} TWh</b></div>`;
        const x0 = x, x1 = x + Math.max(0.5, pw - (j === parts.length - 1 ? 0 : 1.5));
        const first = j === 0, last = j === parts.length - 1;
        const d = `M${first ? x0 + rr : x0},${y}H${last ? x1 - rr : x1}${last ? `A${rr},${rr} 0 0 1 ${x1 - rr},${y + rh}` : `V${y + rh}`}H${first ? x0 + rr : x0}${first ? `A${rr},${rr} 0 0 1 ${x0 + rr},${y}` : `V${y}`}Z`;
        out += `<path class="bar" style="--d:${k * 18}ms" d="${d}" fill="${p.color}" data-tip="${esc(tipH)}"/>`;
        x += pw;
      });
    });
    el.innerHTML = svgOpen(w, h, label) + out + "</svg>";
  }

  // ---------- chart: horizontal bars (values or ranges, linear or log), pill style ----------
  function hbars(el, rows, { log, unit, label, track }) {
    const w = width(el), lw = Math.min(200, w * 0.4), rh = 14, gap = 14, Tp = 6, R = 70;
    const h = Tp + rows.length * (rh + gap) + 20;
    const vals = rows.flatMap((r) => [r.v, r.lo, r.hi]).filter((v) => v != null);
    const pos = vals.filter((v) => v > 0);
    const neg = vals.some((v) => v < 0);
    let sc;
    if (log && pos.length) sc = logScale(Math.min(...pos), Math.max(...pos), lw, w - R);
    else if (neg) {
      const m = niceMax(Math.max(...vals.map(Math.abs)));
      sc = { f: (v) => lw + (w - R - lw) * ((v + m) / (2 * m)), ticks: [-m, -m / 2, 0, m / 2, m] };
    } else sc = linScale(Math.max(...vals, 0), lw, w - R);
    const zero = log ? lw : sc.f(0);
    let out = sc.ticks.map((t) => `<line x1="${sc.f(t)}" x2="${sc.f(t)}" y1="${Tp}" y2="${h - 18}" class="grid"/><text x="${sc.f(t)}" y="${h - 4}" text-anchor="middle">${fmt(t)}</text>`).join("");
    rows.forEach((r, k) => {
      const y = Tp + k * (rh + gap), cy = y + rh / 2, dl = `style="--d:${Math.min(k, 30) * 20}ms"`;
      if (r.focus) out += `<rect x="0" y="${y - 6}" width="${w}" height="${rh + 12}" rx="8" class="row-hl"/>`;
      out += `<text x="${lw - 10}" y="${cy + 4}" text-anchor="end" class="lbl${r.dim ? " dim" : ""}${r.focus || r.bold ? " strong" : ""}">${esc(r.label)}</text>`;
      if (track) out += `<rect x="${lw}" y="${y}" width="${w - R - lw}" height="${rh}" rx="${rh / 2}" class="track"/>`;
      const tipH = `<strong>${esc(r.label)}</strong><div class="tr">${r.lo != null ? fmt(r.lo) + "–" + fmt(r.hi) : fmt(r.v)}${unitTxt(unit)}</div>${r.note ? `<div class="tn">${esc(r.note)}</div>` : ""}`;
      if (r.lo != null) {
        const a = sc.f(r.lo), b = sc.f(r.hi);
        out += `<rect class="bar" ${dl} x="${a}" y="${y}" width="${Math.max(rh, b - a)}" height="${rh}" rx="${rh / 2}" fill="${r.color}" opacity="${r.dim ? 0.5 : 1}" data-tip="${esc(tipH)}"/>`;
        out += `<text x="${Math.max(b, a + rh) + 8}" y="${cy + 4}" class="val">${fmt(r.lo)}–${fmt(r.hi)}</text>`;
      } else if (r.v != null) {
        const a = Math.min(zero, sc.f(r.v)), b = Math.max(zero, sc.f(r.v));
        out += `<rect class="bar" ${dl} x="${a}" y="${y}" width="${Math.max(rh, b - a)}" height="${rh}" rx="${rh / 2}" fill="${r.color}" opacity="${r.dim ? 0.5 : 1}" data-tip="${esc(tipH)}"/>`;
        out += `<text x="${Math.max(b, a + rh) + 8}" y="${cy + 4}" class="val">${fmt(r.v)}${unit === "%" ? "%" : ""}</text>`;
      } else {
        out += `<text x="${lw}" y="${cy + 4}" class="val dim" data-tip="${esc(tipH)}">${esc(r.note || "no value")}</text>`;
      }
    });
    if (neg) out += `<line x1="${zero}" x2="${zero}" y1="${Tp}" y2="${h - 18}" class="axis"/>`;
    el.innerHTML = svgOpen(w, h, label) + out + "</svg>";
  }

  // ---------- chart: scatter ----------
  function scatter(el, pts, { mx, my }) {
    const w = width(el), h = Math.min(440, Math.max(300, w * 0.62)), L = 54, R = 14, Tp = 14, B = 42;
    if (pts.length < 2) { el.innerHTML = `<p class="en-empty">These two metrics share fewer than two sources.</p>`; return; }
    const xs = pts.map((p) => p.x), yv = pts.map((p) => p.y);
    const sx = mx.log ? logScale(Math.min(...xs.filter((v) => v > 0)), Math.max(...xs), L, w - R) : linScale(Math.max(...xs), L, w - R);
    const sy = my.log ? logScale(Math.min(...yv.filter((v) => v > 0)), Math.max(...yv), h - B, Tp) : linScale(Math.max(...yv), h - B, Tp);
    let out = sx.ticks.map((t) => `<line x1="${sx.f(t)}" x2="${sx.f(t)}" y1="${Tp}" y2="${h - B}" class="grid"/><text x="${sx.f(t)}" y="${h - B + 16}" text-anchor="middle">${fmt(t)}</text>`).join("");
    out += sy.ticks.map((t) => `<line x1="${L}" x2="${w - R}" y1="${sy.f(t)}" y2="${sy.f(t)}" class="grid"/><text x="${L - 8}" y="${sy.f(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
    out += `<text x="${(L + w - R) / 2}" y="${h - 6}" text-anchor="middle" class="ax">${esc(mx.label)} · ${esc(mx.unit)}${mx.log ? " · log" : ""}</text>`;
    out += `<text transform="translate(13 ${(Tp + h - B) / 2}) rotate(-90)" text-anchor="middle" class="ax">${esc(my.label)} · ${esc(my.unit)}${my.log ? " · log" : ""}</text>`;
    // "better" corner hint
    const bx = mx.better === "high" ? w - R - 6 : L + 6, by = my.better === "high" ? Tp + 14 : h - B - 8;
    if (mx.better !== "info" && my.better !== "info") out += `<text x="${bx}" y="${by}" text-anchor="${mx.better === "high" ? "end" : "start"}" class="hint">better ${my.better === "high" ? "↑" : "↓"}${mx.better === "high" ? "→" : "←"}</text>`;
    const placed = pts.map((p) => { const x = sx.f(p.x), y = sy.f(p.y); return { x0: x - 8, x1: x + 8, y0: y - 8, y1: y + 8 }; });
    pts.forEach((p, k) => {
      const x = sx.f(p.x), y = sy.f(p.y);
      const tipH = `<strong>${esc(p.label)}</strong><div class="tr">${esc(mx.label)}<b>${fmt(p.x)}${unitTxt(mx.unit)}</b></div><div class="tr">${esc(my.label)}<b>${fmt(p.y)}${unitTxt(my.unit)}</b></div>`;
      out += `<g class="pt" style="--d:${k * 40}ms"><circle cx="${x}" cy="${y}" r="13" fill="${p.color}" opacity=".16"/><circle cx="${x}" cy="${y}" r="6.5" fill="${p.color}" stroke="var(--surface)" stroke-width="2"/><circle cx="${x}" cy="${y}" r="16" fill="transparent" data-tip="${esc(tipH)}"/></g>`;
      const tw = p.label.length * 6.6;
      const cands = [[x + 12, y + 4, "start"], [x - 12, y + 4, "end"], [x + 10, y - 12, "start"], [x + 10, y + 20, "start"], [x - 10, y - 12, "end"], [x - 10, y + 20, "end"]];
      const box = ([lx, ly, a]) => ({ x0: a === "start" ? lx : lx - tw, x1: a === "start" ? lx + tw : lx, y0: ly - 10, y1: ly + 2 });
      const fits = (c) => { const b = box(c); return b.x0 >= L && b.x1 <= w - 2 && !placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0); };
      const c = cands.find(fits) || cands[x < w - 110 ? 0 : 1];
      placed.push(box(c));
      out += `<text x="${c[0]}" y="${c[1]}" text-anchor="${c[2]}" class="lbl">${esc(p.label)}</text>`;
    });
    el.innerHTML = svgOpen(w, h, `${my.label} against ${mx.label}`) + out + "</svg>";
  }

  // ---------- sparkline for the hero ----------
  function spark(values, years, cls) {
    const w = 120, h = 34;
    const pts = values.map((v, i) => [i, v]).filter((p) => p[1] != null);
    if (pts.length < 2) return "";
    const mn = Math.min(...pts.map((p) => p[1])), mxv = Math.max(...pts.map((p) => p[1])), span = mxv - mn || 1;
    const P = pts.map(([i, v]) => [2 + ((w - 4) * (i - pts[0][0])) / (pts[pts.length - 1][0] - pts[0][0]), h - 3 - ((h - 8) * (v - mn)) / span]);
    const last = P[P.length - 1];
    return `<svg class="spark ${cls || ""}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${curve(P)}L${last[0]},${h}L${P[0][0]},${h}Z" class="sa"/><path d="${curve(P)}" class="sl"/><circle cx="${last[0]}" cy="${last[1]}" r="2.8" class="sd"/></svg>`;
  }

  // ---------- data helpers ----------
  const ent = (id) => C.entities.find((e) => e.id === id) || C.entities[0];
  function total(e, kind, i) { const d = e[kind]; if (!d) return null; let s = 0, any = false; for (const k of SRC) { const v = d[k][i]; if (v != null) { s += v; any = true; } } return any ? s : null; }
  function indVal(e, ind, i) {
    if (ind.field) return e[ind.field]?.[i] ?? null;
    const t = total(e, "elec", i); if (!t) return null;
    if (ind.total) return t;
    return (100 * ind.parts.reduce((s, k) => s + (e.elec[k][i] || 0), 0)) / t;
  }
  const lastIdx = (kind) => C.years.indexOf(kind === "primary" ? C.lastPrimary : C.lastElec);
  const here = () => ent(st.country);
  const isWorld = () => st.country === "world";
  // Technology values, with share/TWh/growth swapped for the selected country.
  function itemVals(item) {
    if (isWorld()) return item.values;
    const sid = COUNTRY_SRC[item.id], e = here(), i = lastIdx("elec");
    const v = { ...item.values };
    if (!sid || !e.elec) { v.share = v.twh = v.growth = null; return v; }
    const t = total(e, "elec", i), now = e.elec[sid][i], prev = e.elec[sid][i - 1];
    v.share = now != null && t ? [{ v: (100 * now) / t }] : null;
    v.twh = now != null ? [{ v: now }] : null;
    v.growth = now != null && prev != null ? [{ v: now - prev }] : null;
    return v;
  }
  function primary(item, mid) {
    const list = (itemVals(item)[mid] || []).filter((e) => !e.existing);
    for (const e of list) { if (e.v != null) return e.v; if (e.lo != null) return (e.lo + e.hi) / 2; }
    return null;
  }
  function metricLabel(m) {
    if (isWorld() || !["share", "twh", "growth"].includes(m.id)) return m.label;
    const n = here().name, y = C.lastElec;
    return { share: `Share of electricity in ${n}, ${y}`, twh: `Electricity generated in ${n}, ${y}`, growth: `Change in generation in ${n}, ${y - 1}→${y}` }[m.id];
  }
  const tagOk = (it) => st.tag === "all" || it.tags.includes(st.tag);
  const metric = (id) => T.metrics.find((m) => m.id === id);
  const refLink = (id) => { const r = T.refs[id]; return r ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>` : ""; };
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  const entOpts = (sel) => {
    const groups = [["region", "World & regions"], ["europe", "Europe"], ["americas", "Americas"], ["asia", "Asia & Middle East"], ["africa", "Africa"], ["oceania", "Oceania"]];
    return groups.map(([g, l]) => `<optgroup label="${l}">${C.entities.filter((e) => e.group === g || (g === "region" && e.id === "world")).filter((e) => g === "region" || e.id !== "world").map((e) => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</optgroup>`).join("");
  };
  const metricOpts = (sel) => {
    const gs = [...new Set(T.metrics.map((m) => m.group))];
    return gs.map((g) => `<optgroup label="${g}">${T.metrics.filter((m) => m.group === g).map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(metricLabel(m))}</option>`).join("")}</optgroup>`).join("");
  };
  const legend = (ids) => `<div class="en-legend">${ids.map((k) => `<span><i style="background:var(--s-${k})"></i>${esc(SRC_NAME[k])}</span>`).join("")}</div>`;
  const shortName = { "Oil & other fossil": "Oil", "Bio & other renewables": "Bio" };

  // ---------- sections ----------
  function renderHero() {
    const e = here(), i = lastIdx("elec"), y = C.years[i], ref = C.years.indexOf(y - 10);
    $("#en-country").innerHTML = entOpts(st.country);
    $("#en-place").textContent = e.name;
    const tot = total(e, "elec", i);
    $("#en-place-sub").textContent = tot ? `${fmt(tot)} TWh of electricity generated in ${y}` + (e.pop?.[i] ? ` · ${fmt(e.elecpc[i])} kWh per person` : "") : "No electricity data";
    const kpi = (id) => {
      const ind = IND.find((x) => x.id === id), vals = C.years.map((_, k) => indVal(e, ind, k)), v = vals[i], v0 = ref >= 0 ? vals[ref] : null;
      const d = v != null && v0 != null ? v - v0 : null;
      const good = d == null ? "" : (ind.lowGood ? d < 0 : id === "fossil" ? d < 0 : d > 0) ? "up" : "down";
      const dTxt = d == null ? "" : ind.unit === "%" ? `${signed(d)} pts since ${y - 10}` : `${signed(d, 0)} since ${y - 10}`;
      return `<div class="kpi"><span>${esc(ind.short || ind.label)}</span><strong>${fmt(v)}<small>${ind.unit === "%" ? "%" : " " + esc(ind.unit)}</small></strong>
        <em class="${good}">${dTxt}</em>${spark(vals, C.years)}</div>`;
    };
    $("#en-kpis").innerHTML = ["lowcarbon", "renew", "fossil", "ci"].map(kpi).join("");
    if (tot) {
      const parts = SRC.map((k) => ({ id: k, name: SRC_NAME[k], short: shortName[SRC_NAME[k]] || SRC_NAME[k], color: `var(--s-${k})`, v: e.elec[k][i] || 0 })).sort((a, b) => b.v - a.v);
      mixBar($("#en-now"), parts, tot, `Electricity mix of ${e.name} in ${y}`);
      $("#en-now-cap").textContent = `Electricity mix ${y}, largest source first`;
    } else { $("#en-now").innerHTML = ""; $("#en-now-cap").textContent = ""; }
  }

  function renderMix() {
    const e = here(), kind = e[st.kind] ? st.kind : "elec";
    segSet("#en-kind", kind); segSet("#en-unit", st.pct ? "pct" : "twh");
    $("#en-mix-title").textContent = `${kind === "elec" ? "Electricity" : "Primary energy"} by source · ${e.name}`;
    const layers = SRC.map((k) => ({ id: k, name: SRC_NAME[k], color: `var(--s-${k})`, values: e[kind] ? e[kind][k] : [] }));
    stackArea($("#en-mix"), { years: C.years, layers, pct: st.pct, unit: "TWh", label: $("#en-mix-title").textContent });
    $("#en-mix-legend").innerHTML = legend(SRC.slice().reverse());
    $("#en-mix-note").innerHTML = kind === "elec"
      ? `${st.pct ? "Share of generation" : "TWh generated"}, ${C.years[0]}–${C.lastElec}. Source: ${refLink("owid-energy")}.`
      : `${st.pct ? "Share of primary energy" : "TWh of primary energy"} (substitution method: nuclear and renewables counted as the fossil fuel they would replace), ${C.years[0]}–${C.lastPrimary}. Source: ${refLink("owid-energy")}.`;
  }

  function cmpRows(kind) {
    const i = lastIdx(kind);
    const list = C.entities.filter((e) => e[kind] && (st.cmpGroup === "all" || e.group === st.cmpGroup || e.id === st.country));
    const ind = IND.find((x) => x.id === st.cmpSort);
    return list.map((e) => {
      const tot = total(e, kind, i) || 0;
      const parts = SRC.map((k) => ({ id: k, name: SRC_NAME[k], color: `var(--s-${k})`, v: e[kind][k][i] || 0 }));
      const share = (ks) => (tot ? (100 * ks.reduce((s, k) => s + (e[kind][k][i] || 0), 0)) / tot : 0);
      return { id: e.id, label: e.name, parts, total: tot, key: share(ind?.parts || ["nuclear", ...RENEW]) };
    }).filter((r) => r.total > 0).sort((a, b) => b.key - a.key);
  }
  function renderCompare() {
    $("#en-cmp-group").innerHTML = REGION_GROUPS.map(([g, l]) => `<button class="chip ${st.cmpGroup === g ? "on" : ""}" data-g="${g}" aria-pressed="${st.cmpGroup === g}">${l}</button>`).join("");
    $("#en-cmp-sort").innerHTML = opts(IND.filter((x) => x.parts).map((x) => [x.id, "Sort by " + x.label.toLowerCase()]), st.cmpSort);
    segSet("#en-cmp-kind", st.cmpKind);
    const kind = st.cmpKind, y = kind === "primary" ? C.lastPrimary : C.lastElec;
    stackBars($("#en-cmp"), cmpRows(kind), `${kind === "elec" ? "Electricity" : "Primary energy"} mix by country, ${y}`, st.country);
    $("#en-cmp-legend").innerHTML = legend(SRC);
    $("#en-cmp-note").innerHTML = `${kind === "elec" ? "Electricity generation" : "Primary energy"} mix, ${y}. ${esc(here().name)} is highlighted and always included. Source: ${refLink("owid-energy")}.`;
  }

  function renderRank() {
    $("#en-rank-ind").innerHTML = opts(IND.map((x) => [x.id, x.label]), st.rankInd);
    const ind = IND.find((x) => x.id === st.rankInd), i = lastIdx(ind.primary ? "primary" : "elec");
    const rows = C.entities.filter((e) => st.cmpGroup === "all" || e.group === st.cmpGroup || e.id === st.country || e.id === "world")
      .map((e) => ({ e, v: indVal(e, ind, i) })).filter((r) => r.v != null).sort((a, b) => b.v - a.v)
      .map(({ e, v }) => ({ label: e.name, v, focus: e.id === st.country, bold: e.id === "world",
        color: e.id === st.country ? "var(--accent)" : e.id === "world" ? "var(--ink)" : "color-mix(in srgb, var(--general) 70%, var(--surface))" }));
    hbars($("#en-rank"), rows, { unit: ind.unit, label: ind.label, track: true });
    $("#en-rank-note").innerHTML = `${esc(ind.label)} (${esc(ind.unit)}), ${C.years[i]}. ${esc(here().name)} highlighted; World shown for reference. Region filter is shared with the chart above. Source: ${refLink("owid-energy")}.`;
  }

  function renderTrend() {
    $("#en-trend-ind").innerHTML = opts(IND.map((x) => [x.id, x.label]), st.trendInd);
    $$("#en-trend-ents select").forEach((s, k) => { s.innerHTML = `<option value="">None</option>` + entOpts(st.trend[k]); });
    $$("#en-trend-ents i").forEach((dot, k) => (dot.style.background = TRIO[k]));
    const ind = IND.find((x) => x.id === st.trendInd);
    const series = st.trend.map((id, k) => (id ? { name: ent(id).name, color: TRIO[k], values: C.years.map((_, i) => indVal(ent(id), ind, i)) } : null)).filter(Boolean);
    lines($("#en-trend"), { years: C.years, series, unit: ind.unit, label: ind.label + " over time" });
    $("#en-trend-note").innerHTML = `${esc(ind.label)} (${esc(ind.unit)}). The first slot follows the country picked at the top. Source: ${refLink("owid-energy")}.`;
  }

  function techRows(mid) {
    const rows = [];
    for (const it of T.items) {
      if (!tagOk(it)) continue;
      const list = itemVals(it)[mid];
      if (!list) continue;
      for (const e of list) rows.push({ label: it.name + (e.label ? " · " + e.label : ""), v: e.v, lo: e.lo, hi: e.hi, note: e.note, color: col(it.id), dim: !!e.existing });
    }
    const key = (r) => (r.v != null ? r.v : r.lo != null ? (r.lo + r.hi) / 2 : -Infinity);
    const m = metric(mid);
    return rows.sort((a, b) => (m.better === "low" ? key(a) - key(b) : key(b) - key(a)));
  }
  function renderTags() {
    $("#en-tags").innerHTML = [["all", "All sources"], ...T.tags.map((t) => [t.id, t.label])].map(([id, l]) => `<button class="chip ${st.tag === id ? "on" : ""}" data-tag="${id}" aria-pressed="${st.tag === id}">${esc(l)}</button>`).join("");
  }
  function renderTech() {
    $("#en-metric").innerHTML = metricOpts(st.metric);
    const m = metric(st.metric), rows = techRows(st.metric), box = $("#en-tech"), countryMetric = ["share", "twh", "growth"].includes(m.id);
    if (st.table) {
      box.innerHTML = `<div class="en-table-wrap"><table class="en-table"><thead><tr><th>Source</th><th class="num">${esc(m.unit)}</th><th>Note</th></tr></thead><tbody>${rows.map((r) =>
        `<tr><td><i class="sw" style="background:${r.color}"></i>${esc(r.label)}</td><td class="num">${r.lo != null ? fmt(r.lo) + "–" + fmt(r.hi) : fmt(r.v)}</td><td>${esc(r.note || "")}</td></tr>`).join("")}</tbody></table></div>`;
    } else hbars(box, rows, { log: m.log && rows.every((r) => (r.v ?? r.lo ?? 1) > 0), unit: m.unit, label: m.label });
    $("#en-tech-table").textContent = st.table ? "Chart" : "Table";
    $("#en-tech-title").textContent = metricLabel(m);
    const better = { low: "Lower is better.", high: "Higher is better.", info: "" }[m.better];
    const where = countryMetric && !isWorld() ? ` Values for ${here().name}, ${C.lastElec} (${refLink("owid-energy")}); geothermal is inside “Bio & other renewables”.` : "";
    $("#en-tech-note").innerHTML = `${esc(m.unit)}${m.log ? ", log scale" : ""}. ${better} ${EH.highlight(esc(m.desc))}${where}<br>Source: ${countryMetric && !isWorld() ? refLink("owid-energy") : refLink(m.source)}.`;
  }

  function renderScatter() {
    $("#en-sx").innerHTML = metricOpts(st.sx); $("#en-sy").innerHTML = metricOpts(st.sy);
    const mx = metric(st.sx), my = metric(st.sy);
    const pts = T.items.filter(tagOk).map((it) => ({ label: it.name, x: primary(it, mx.id), y: primary(it, my.id), color: col(it.id) }))
      .filter((p) => p.x != null && p.y != null && (!mx.log || p.x > 0) && (!my.log || p.y > 0));
    scatter($("#en-scatter"), pts, { mx: { ...mx, label: metricLabel(mx) }, my: { ...my, label: metricLabel(my) } });
    $("#en-scatter-note").innerHTML = `Each dot is one source at its main value (midpoint for ranges; existing plants excluded). Sources: ${refLink(mx.source)}; ${refLink(my.source)}.`;
  }

  function renderScore() {
    const ms = T.metrics.filter((m) => m.better !== "info");
    const items = T.items.filter(tagOk);
    const rank = {};
    for (const m of ms) {
      const vals = items.map((it) => ({ id: it.id, v: primary(it, m.id) })).filter((x) => x.v != null);
      vals.sort((a, b) => (m.better === "low" ? a.v - b.v : b.v - a.v));
      rank[m.id] = Object.fromEntries(vals.map((x, k) => [x.id, vals.length > 1 ? k / (vals.length - 1) : 0]));
    }
    const SHORT = { lcoe: "LCOE new (US)", lcoeGlobal: "LCOE global avg", capex: "CAPEX", fom: "Fixed OPEX", vom: "Variable OPEX", learning: "Learning rate", co2: "Life-cycle CO₂", land: "Land use", density: "Power density", water: "Water use", minerals: "Minerals", deaths: "Deaths per TWh", cf: "Capacity factor", eroi: "EROI", lead: "Build time", life: "Lifetime" };
    const head = `<tr><th></th>${ms.map((m) => `<th title="${esc(m.label)}"><span>${esc(SHORT[m.id] || m.label)}</span></th>`).join("")}</tr>`;
    const body = items.map((it) => `<tr><th><i class="sw" style="background:${col(it.id)}"></i>${esc(it.name)}</th>${ms.map((m) => {
      const v = primary(it, m.id), r = rank[m.id][it.id];
      if (v == null) return `<td class="na">·</td>`;
      const step = Math.round((1 - r) * 4);
      return `<td class="h${step}" data-tip="${esc(`<strong>${esc(it.name)}</strong><div class="tr">${esc(m.label)}<b>${fmt(v)}${unitTxt(m.unit)}</b></div>`)}">${fmt(v)}</td>`;
    }).join("")}</tr>`).join("");
    $("#en-score").innerHTML = `<div class="en-table-wrap"><table class="en-heat"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="en-scale"><span>worse</span>${[0, 1, 2, 3, 4].map((k) => `<i class="h${k}"></i>`).join("")}<span>better</span></div>`;
  }

  function renderCards() {
    const items = T.items.filter(tagOk), share = metric("share");
    $("#en-cards").innerHTML = items.map((it) => {
      const vals = itemVals(it);
      const tags = it.tags.map((t) => `<span class="en-tag t-${t}">${esc(T.tags.find((x) => x.id === t).label)}</span>`).join("");
      const fact = (mid, lbl) => { const m = metric(mid), list = vals[mid]; if (!list) return ""; const e = list.find((x) => !x.existing) || list[0];
        if (e.v == null && e.lo == null) return "";
        return `<div><dt>${lbl}</dt><dd>${e.lo != null ? fmt(e.lo) + "–" + fmt(e.hi) : fmt(e.v)}<small>${unitTxt(m.unit)}</small></dd></div>`; };
      return `<li class="en-card" style="--c:${col(it.id)}"><button class="en-card-hit" data-open="${it.id}" aria-label="Details for ${esc(it.name)}"></button>
        <div class="en-card-top"><span class="dot"></span><h3>${esc(it.name)}</h3><span class="kind">${esc(it.dispatch)}</span></div>
        <div class="en-tags">${tags}</div>
        <p>${esc(it.summary)}</p>
        <dl class="en-facts">${fact("share", isWorld() ? "World share" : `Share in ${here().name}`)}${fact("lcoe", "New-build cost")}${fact("co2", "Life-cycle CO₂")}${fact("deaths", "Deaths/TWh")}</dl>
        <div class="card-actions"><span class="link">Details & all metrics →</span><button class="link" data-news="${esc(it.news)}">News in feed</button></div></li>`;
    }).join("");
  }

  function openItem(id) {
    const it = T.items.find((x) => x.id === id); if (!it) return;
    const sid = ITEM_SRC[id] || id, w = ent("world"), e = here();
    const shareOf = (en) => C.years.map((_, i) => { const t = total(en, "elec", i); return t && en.elec?.[sid] ? (100 * (en.elec[sid][i] || 0)) / t : null; });
    const vals = itemVals(it);
    const rows = T.metrics.map((m) => {
      const list = vals[m.id]; if (!list) return "";
      return list.map((x) => `<tr><td>${esc(metricLabel(m))}${x.label ? ` <span class="muted">· ${esc(x.label)}</span>` : ""}</td><td class="num">${x.lo != null ? fmt(x.lo) + "–" + fmt(x.hi) : fmt(x.v)} <span class="muted">${esc(m.unit)}</span></td><td class="muted">${esc(x.note || "")}</td></tr>`).join("");
    }).join("");
    const terms = (it.terms || []).filter((t) => EH.findTerm(t));
    EH.openSheet(`<div class="en-sheet-head" style="--c:${col(id)}"><span class="dot"></span><h2>${esc(it.name)}</h2><span class="kind">${esc(it.dispatch)}</span></div>
      <div class="en-tags">${it.tags.map((t) => `<span class="en-tag t-${t}">${esc(T.tags.find((x) => x.id === t).label)}</span>`).join("")}</div>
      <p>${EH.highlight(esc(it.summary))}</p>
      <h3 class="en-h3">Share of electricity${id === "geothermal" ? " (bio & other renewables)" : ""}</h3><div id="en-spark" class="en-chart"></div>
      <h3 class="en-h3">How it works</h3><p>${EH.highlight(esc(it.how))}</p>
      <h3 class="en-h3">Key facts</h3><ul class="facts-list">${it.facts.map((f) => `<li>${EH.highlight(esc(f))}</li>`).join("")}</ul>
      <div class="en-pc"><div class="pro"><h3 class="en-h3">Strengths</h3><ul class="facts-list">${it.pros.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
      <div class="con"><h3 class="en-h3">Weaknesses</h3><ul class="facts-list">${it.cons.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div></div>
      <h3 class="en-h3">In Switzerland</h3><p>${EH.highlight(esc(it.ch))}</p>
      <h3 class="en-h3">All metrics</h3><div class="en-table-wrap"><table class="en-table">${rows}</table></div>
      <p class="note">Sources for each metric are listed under the comparison charts and at the bottom of the tab.</p>
      ${terms.length ? `<div class="related">${terms.map((t) => `<button data-rel="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
      ${it.links?.length ? `<p class="small">${it.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}</p>` : ""}
      <div class="sheet-actions"><button class="btn ghost" data-news="${esc(it.news)}">News in feed</button><button class="btn" data-close>Done</button></div>`);
    const body = $("#sheet-body");
    const series = [{ name: "World", color: "var(--q-1)", values: shareOf(w) }];
    if (!isWorld() && e.elec) series.push({ name: e.name, color: "var(--q-2)", values: shareOf(e) });
    lines($("#en-spark", body), { years: C.years, series, unit: "%", label: "Share of electricity", h: 190, area: series.length === 1 });
    $$("[data-rel]", body).forEach((b) => (b.onclick = () => EH.openTerm(b.dataset.rel)));
    $$("[data-news]", body).forEach((b) => (b.onclick = () => EH.searchFeed(b.dataset.news)));
  }

  function renderRefs() {
    $("#en-refs").innerHTML = `<ol class="en-refs">${Object.keys(T.refs).map((k) => `<li>${refLink(k)}</li>`).join("")}</ol>`;
  }

  function segSet(sel, v) { $$(sel + " button").forEach((b) => { const on = b.dataset.v === v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); }

  function renderAll() {
    if (!T || !C) return;
    $("#en-about").textContent = `${T.about} Technology data checked ${T.updated}; country data built ${C.generated.slice(0, 10)}.`;
    renderHero(); renderMix(); renderCompare(); renderRank(); renderTrend(); renderTags(); renderTech(); renderScatter(); renderScore(); renderCards(); renderRefs();
  }
  const charts = () => { renderHero(); renderMix(); renderCompare(); renderRank(); renderTrend(); renderTech(); renderScatter(); };

  function setCountry(id) {
    st.country = id;
    const g = ent(id).group;
    if (g !== "region" && id !== "world") st.cmpGroup = g;
    if (!st.trend.includes(id)) st.trend[0] = id;
    save(); renderAll();
  }

  // ---------- events ----------
  function wire() {
    const v = $("#view-energy");
    $("#en-country").addEventListener("change", (e) => setCountry(e.target.value));
    $("#en-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.kind = b.dataset.v; save(); renderMix(); } });
    $("#en-unit").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.pct = b.dataset.v === "pct"; save(); renderMix(); } });
    $("#en-cmp-group").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { st.cmpGroup = b.dataset.g; save(); renderCompare(); renderRank(); } });
    $("#en-cmp-sort").addEventListener("change", (e) => { st.cmpSort = e.target.value; save(); renderCompare(); });
    $("#en-cmp-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.cmpKind = b.dataset.v; save(); renderCompare(); } });
    $("#en-rank-ind").addEventListener("change", (e) => { st.rankInd = e.target.value; save(); renderRank(); });
    $("#en-trend-ind").addEventListener("change", (e) => { st.trendInd = e.target.value; save(); renderTrend(); });
    $$("#en-trend-ents select").forEach((s, k) => s.addEventListener("change", () => { st.trend[k] = s.value; save(); renderTrend(); }));
    $("#en-tags").addEventListener("click", (e) => { const b = e.target.closest("[data-tag]"); if (b) { st.tag = b.dataset.tag; save(); renderTags(); renderTech(); renderScatter(); renderScore(); renderCards(); } });
    $("#en-metric").addEventListener("change", (e) => { st.metric = e.target.value; save(); renderTech(); });
    $("#en-tech-table").addEventListener("click", () => { st.table = !st.table; save(); renderTech(); });
    $("#en-sx").addEventListener("change", (e) => { st.sx = e.target.value; save(); renderScatter(); });
    $("#en-sy").addEventListener("change", (e) => { st.sy = e.target.value; save(); renderScatter(); });
    // Tap a country in the comparison or ranking to make it the selected country.
    v.addEventListener("click", (e) => {
      const n = e.target.closest("[data-news]"); if (n) { e.stopPropagation(); return EH.searchFeed(n.dataset.news); }
      const o = e.target.closest("[data-open]"); if (o) return openItem(o.dataset.open);
      const t = e.target.closest("[data-term]"); if (t) EH.openTerm(t.dataset.term);
    });
    let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!v.classList.contains("hidden")) charts(); }, 150); });
    // Charts measure their width, so redraw when the tab becomes visible.
    new MutationObserver(() => { if (!v.classList.contains("hidden")) charts(); }).observe(v, { attributes: true, attributeFilter: ["class"] });
  }

  async function init() {
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    [T, C] = await Promise.all([get("data/energy.json"), get("data/energy-countries.json")]);
    if (!T || !C) { $("#en-about").textContent = "Could not load data/energy.json or data/energy-countries.json."; return; }
    if (!C.entities.some((e) => e.id === st.country)) st.country = "world";
    wire(); renderAll();
  }
  init();
})();
