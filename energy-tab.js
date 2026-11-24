/* Energy sources tab for Energy Hub. Vanilla JS, SVG charts, no dependencies.
 * Data: data/energy.json (technology metrics, hand-curated with sources)
 *       data/energy-countries.json (built by scripts/build_energy_data.py from OWID / Ember / Energy Institute)
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
  const col = (id) => `var(--s-${ITEM_SRC[id] || id})`;
  const FOSSIL = ["coal", "oil", "gas"], RENEW = ["bio", "hydro", "wind", "solar"];

  const IND = [
    { id: "lowcarbon", label: "Low-carbon share (nuclear + renewables)", unit: "%", parts: ["nuclear", ...RENEW] },
    { id: "renew", label: "Renewable share", unit: "%", parts: RENEW },
    { id: "fossil", label: "Fossil share", unit: "%", parts: FOSSIL },
    { id: "nuclear", label: "Nuclear share", unit: "%", parts: ["nuclear"] },
    { id: "windsolar", label: "Wind + solar share", unit: "%", parts: ["wind", "solar"] },
    { id: "solar", label: "Solar share", unit: "%", parts: ["solar"] },
    { id: "wind", label: "Wind share", unit: "%", parts: ["wind"] },
    { id: "hydro", label: "Hydro share", unit: "%", parts: ["hydro"] },
    { id: "coal", label: "Coal share", unit: "%", parts: ["coal"] },
    { id: "gas", label: "Gas share", unit: "%", parts: ["gas"] },
    { id: "ci", label: "Carbon intensity of electricity", unit: "g CO₂/kWh", field: "ci" },
    { id: "elecpc", label: "Electricity generation per person", unit: "kWh", field: "elecpc" },
    { id: "energypc", label: "Primary energy per person", unit: "kWh", field: "energypc" },
    { id: "gen", label: "Total electricity generation", unit: "TWh", total: true },
    { id: "imports", label: "Net electricity imports (share of demand)", unit: "%", field: "imports" },
  ];
  const REGION_GROUPS = [["all", "All"], ["region", "Regions"], ["europe", "Europe"], ["americas", "Americas"], ["asia", "Asia"], ["africa", "Africa"], ["oceania", "Oceania"]];
  const TRIO = ["var(--q-1)", "var(--q-2)", "var(--q-3)"];

  let T = null, C = null;                 // technology data, country data
  const st = Object.assign({
    ent: "world", kind: "elec", pct: false,
    cmpGroup: "europe", cmpSort: "lowcarbon", cmpKind: "elec",
    rankInd: "lowcarbon", trendInd: "lowcarbon", trend: ["world", "ch", "de"],
    metric: "lcoe", tag: "all", sx: "co2", sy: "deaths", table: false,
  }, store.get("state", {}));
  const save = () => store.set("state", st);

  // ---------- formatting ----------
  function fmt(v) {
    if (v == null || Number.isNaN(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
    if (a >= 100) return String(Math.round(v));
    if (a >= 10) return String(+v.toFixed(1));
    if (a >= 1) return String(+v.toFixed(1));
    if (a === 0) return "0";
    return String(+v.toPrecision(2));
  }
  const unitTxt = (u) => (u === "%" ? "%" : " " + u);

  // ---------- tooltip ----------
  const tip = document.createElement("div");
  tip.className = "en-tip hidden"; tip.setAttribute("role", "status");
  document.body.appendChild(tip);
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.remove("hidden");
    const r = tip.getBoundingClientRect(), pad = 12;
    let left = x + pad, top = y + pad;
    if (left + r.width > innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > innerHeight - 8) top = y - r.height - pad;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => tip.classList.add("hidden");
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest?.("[data-tip]"); if (!t || !t.closest("#view-energy")) return;
    showTip(t.dataset.tip, e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", (e) => { const t = e.target.closest?.("[data-tip]"); if (t && t.closest("#view-energy")) showTip(t.dataset.tip, e.clientX, e.clientY); });
  document.addEventListener("pointerout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
  addEventListener("scroll", hideTip, { passive: true });

  // ---------- scales ----------
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
  const width = (el) => Math.max(300, Math.min(1000, el.clientWidth || $("#app").clientWidth - 32));
  const svgOpen = (w, h, label) => `<svg class="ch" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">`;

  // ---------- chart: stacked area over time ----------
  function stackArea(el, { years, layers, pct, unit, label }) {
    const w = width(el), h = 280, L = 46, R = 10, Tp = 10, B = 26;
    const tot = years.map((_, i) => layers.reduce((s, l) => s + (l.values[i] || 0), 0));
    const ok = years.map((_, i) => tot[i] > 0);
    const idx = years.map((_, i) => i).filter((i) => ok[i]);
    if (!idx.length) { el.innerHTML = `<p class="note">No data for this selection.</p>`; return; }
    const x0 = idx[0], x1 = idx[idx.length - 1];
    const X = (i) => L + (w - L - R) * ((i - x0) / Math.max(1, x1 - x0));
    const maxV = pct ? 100 : Math.max(...idx.map((i) => tot[i]));
    const ys = linScale(maxV, h - B, Tp);
    const val = (l, i) => (pct ? (100 * (l.values[i] || 0)) / tot[i] : l.values[i] || 0);
    let base = idx.map(() => 0), paths = "";
    for (const l of layers) {
      const top = idx.map((i, k) => base[k] + val(l, i));
      if (top.every((v, k) => v === base[k])) { base = top; continue; }
      const up = idx.map((i, k) => `${X(i).toFixed(1)},${ys.f(top[k]).toFixed(1)}`);
      const dn = idx.map((i, k) => `${X(i).toFixed(1)},${ys.f(base[k]).toFixed(1)}`).reverse();
      paths += `<path d="M${up.join("L")}L${dn.join("L")}Z" fill="${l.color}" stroke="var(--surface)" stroke-width="1"/>`;
      base = top;
    }
    const grid = ys.ticks.map((t) => `<line x1="${L}" x2="${w - R}" y1="${ys.f(t)}" y2="${ys.f(t)}" class="grid"/><text x="${L - 6}" y="${ys.f(t) + 4}" text-anchor="end">${fmt(t)}${pct ? "%" : ""}</text>`).join("");
    const step = Math.ceil((x1 - x0) / Math.max(2, Math.floor((w - L) / 70)));
    const xt = idx.filter((i) => (i - x0) % step === 0 || i === x1).map((i) => `<text x="${X(i)}" y="${h - 8}" text-anchor="${i === x1 ? "end" : "middle"}">${years[i]}</text>`).join("");
    el.innerHTML = svgOpen(w, h, label) + grid + paths + xt + `<line class="xh hidden" y1="${Tp}" y2="${h - B}"/><rect class="hit" x="${L}" y="${Tp}" width="${w - L - R}" height="${h - B - Tp}" fill="transparent"/></svg>`;
    const svg = $("svg", el), xh = $(".xh", svg);
    $(".hit", svg).addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * w;
      const i = Math.round(x0 + ((px - L) / (w - L - R)) * (x1 - x0));
      if (i < x0 || i > x1 || !ok[i]) return;
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.classList.remove("hidden");
      const rows = layers.filter((l) => l.values[i]).slice().reverse().map((l) =>
        `<div class="tr"><i style="background:${l.color}"></i>${esc(l.name)}<b>${fmt(l.values[i])} ${unit}</b><span>${fmt((100 * l.values[i]) / tot[i])}%</span></div>`).join("");
      showTip(`<strong>${years[i]}</strong>${rows}<div class="tr tot">Total<b>${fmt(tot[i])} ${unit}</b></div>`, e.clientX, e.clientY);
    });
    $(".hit", svg).addEventListener("pointerleave", () => { xh.classList.add("hidden"); hideTip(); });
  }

  // ---------- chart: lines over time ----------
  function lines(el, { years, series, unit, label }) {
    const w = width(el), h = 260, L = 46, R = 130, Tp = 10, B = 26;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    if (!all.length) { el.innerHTML = `<p class="note">No data for this selection.</p>`; return; }
    const ys = linScale(Math.max(...all), h - B, Tp);
    const X = (i) => L + (w - L - R) * (i / (years.length - 1));
    let out = ys.ticks.map((t) => `<line x1="${L}" x2="${w - R}" y1="${ys.f(t)}" y2="${ys.f(t)}" class="grid"/><text x="${L - 6}" y="${ys.f(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
    const step = Math.ceil(years.length / Math.max(2, Math.floor((w - L - R) / 70)));
    out += years.map((y, i) => (i % step === 0 || i === years.length - 1 ? `<text x="${X(i)}" y="${h - 8}" text-anchor="${i === years.length - 1 ? "end" : "middle"}">${y}</text>` : "")).join("");
    const ends = [];
    for (const s of series) {
      let d = "", pen = false;
      s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + X(i).toFixed(1) + "," + ys.f(v).toFixed(1); pen = true; });
      out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const li = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
      if (li != null) ends.push({ s, y: ys.f(s.values[li]), x: X(li), v: s.values[li] });
    }
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
    for (const e of ends) out += `<circle cx="${e.x}" cy="${ys.f(e.v)}" r="3.5" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/><text x="${e.x + 8}" y="${e.y + 4}" class="lbl">${esc(e.s.name)} ${fmt(e.v)}</text>`;
    el.innerHTML = svgOpen(w, h, label) + out + `<line class="xh hidden" y1="${Tp}" y2="${h - B}"/><rect class="hit" x="${L}" y="${Tp}" width="${w - L - R}" height="${h - B - Tp}" fill="transparent"/></svg>`;
    const svg = $("svg", el), xh = $(".xh", svg);
    $(".hit", svg).addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * w;
      const i = Math.max(0, Math.min(years.length - 1, Math.round(((px - L) / (w - L - R)) * (years.length - 1))));
      xh.setAttribute("x1", X(i)); xh.setAttribute("x2", X(i)); xh.classList.remove("hidden");
      showTip(`<strong>${years[i]}</strong>` + series.map((s) => `<div class="tr"><i style="background:${s.color}"></i>${esc(s.name)}<b>${fmt(s.values[i])}${unitTxt(unit)}</b></div>`).join(""), e.clientX, e.clientY);
    });
    $(".hit", svg).addEventListener("pointerleave", () => { xh.classList.add("hidden"); hideTip(); });
  }

  // ---------- chart: 100% stacked horizontal bars ----------
  function stackBars(el, rows, label) {
    const w = width(el), lw = Math.min(150, w * 0.3), rh = 22, gap = 6, Tp = 4;
    const h = Tp + rows.length * (rh + gap) + 20, bw = w - lw - 8;
    let out = "";
    rows.forEach((r, k) => {
      const y = Tp + k * (rh + gap); let x = lw;
      out += `<text x="${lw - 8}" y="${y + rh / 2 + 4}" text-anchor="end" class="${r.bold ? "lbl strong" : "lbl"}">${esc(r.label)}</text>`;
      for (const p of r.parts) {
        if (!p.v) continue;
        const pw = (bw * p.v) / r.total;
        const tipH = `<strong>${esc(r.label)} · ${esc(p.name)}</strong><div class="tr">${fmt((100 * p.v) / r.total)}%<b>${fmt(p.v)} TWh</b></div>`;
        out += `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(0, pw - 1).toFixed(1)}" height="${rh}" fill="${p.color}" data-tip="${esc(tipH)}"/>`;
        x += pw;
      }
    });
    [0, 25, 50, 75, 100].forEach((t) => { out += `<text x="${lw + (bw * t) / 100}" y="${h - 4}" text-anchor="middle">${t}%</text>`; });
    el.innerHTML = svgOpen(w, h, label) + out + "</svg>";
  }

  // ---------- chart: horizontal bars, values or ranges, linear or log ----------
  function hbars(el, rows, { log, unit, label }) {
    const w = width(el), lw = Math.min(210, w * 0.38), rh = 20, gap = 8, Tp = 6, R = 64;
    const h = Tp + rows.length * (rh + gap) + 22;
    const vals = rows.flatMap((r) => [r.v, r.lo, r.hi]).filter((v) => v != null);
    const pos = vals.filter((v) => v > 0);
    const neg = vals.some((v) => v < 0);
    let sc;
    if (log && pos.length) sc = logScale(Math.min(...pos), Math.max(...pos), lw, w - R);
    else if (neg) {
      const m = niceMax(Math.max(...vals.map(Math.abs)));
      sc = { f: (v) => lw + (w - R - lw) * ((v + m) / (2 * m)), ticks: [-m, -m / 2, 0, m / 2, m], zero: 0 };
    } else sc = linScale(Math.max(...vals, 0), lw, w - R);
    const zero = log ? lw : sc.f(0);
    let out = sc.ticks.map((t) => `<line x1="${sc.f(t)}" x2="${sc.f(t)}" y1="${Tp}" y2="${h - 20}" class="grid"/><text x="${sc.f(t)}" y="${h - 6}" text-anchor="middle">${fmt(t)}</text>`).join("");
    rows.forEach((r, k) => {
      const y = Tp + k * (rh + gap), cy = y + rh / 2;
      out += `<text x="${lw - 8}" y="${cy + 4}" text-anchor="end" class="lbl${r.dim ? " dim" : ""}">${esc(r.label)}</text>`;
      const tipH = `<strong>${esc(r.label)}</strong><div class="tr">${r.lo != null ? fmt(r.lo) + "–" + fmt(r.hi) : fmt(r.v)}${unitTxt(unit)}</div>${r.note ? `<div class="tn">${esc(r.note)}</div>` : ""}`;
      if (r.lo != null) {
        const a = sc.f(r.lo), b = sc.f(r.hi);
        out += `<rect x="${a}" y="${y + 3}" width="${Math.max(3, b - a)}" height="${rh - 6}" rx="4" fill="${r.color}" opacity="${r.dim ? 0.45 : 1}" data-tip="${esc(tipH)}"/>`;
        out += `<text x="${b + 6}" y="${cy + 4}" class="val">${fmt(r.lo)}–${fmt(r.hi)}</text>`;
      } else if (r.v != null) {
        const a = Math.min(zero, sc.f(r.v)), b = Math.max(zero, sc.f(r.v));
        out += `<rect x="${a}" y="${y + 3}" width="${Math.max(2, b - a)}" height="${rh - 6}" rx="4" fill="${r.color}" opacity="${r.dim ? 0.45 : 1}" data-tip="${esc(tipH)}"/>`;
        out += `<text x="${b + 6}" y="${cy + 4}" class="val">${fmt(r.v)}</text>`;
      } else {
        out += `<text x="${lw}" y="${cy + 4}" class="val dim" data-tip="${esc(tipH)}">${esc(r.note || "no value")}</text>`;
      }
    });
    if (neg) out += `<line x1="${zero}" x2="${zero}" y1="${Tp}" y2="${h - 20}" class="axis"/>`;
    el.innerHTML = svgOpen(w, h, label) + out + "</svg>";
  }

  // ---------- chart: scatter ----------
  function scatter(el, pts, { mx, my }) {
    const w = width(el), h = Math.min(420, Math.max(300, w * 0.6)), L = 56, R = 16, Tp = 12, B = 40;
    if (pts.length < 2) { el.innerHTML = `<p class="note">These two metrics share fewer than two sources.</p>`; return; }
    const sx = mx.log ? logScale(Math.min(...pts.map((p) => p.x).filter((v) => v > 0)), Math.max(...pts.map((p) => p.x)), L, w - R) : linScale(Math.max(...pts.map((p) => p.x)), L, w - R);
    const sy = my.log ? logScale(Math.min(...pts.map((p) => p.y).filter((v) => v > 0)), Math.max(...pts.map((p) => p.y)), h - B, Tp) : linScale(Math.max(...pts.map((p) => p.y)), h - B, Tp);
    let out = sx.ticks.map((t) => `<line x1="${sx.f(t)}" x2="${sx.f(t)}" y1="${Tp}" y2="${h - B}" class="grid"/><text x="${sx.f(t)}" y="${h - B + 16}" text-anchor="middle">${fmt(t)}</text>`).join("");
    out += sy.ticks.map((t) => `<line x1="${L}" x2="${w - R}" y1="${sy.f(t)}" y2="${sy.f(t)}" class="grid"/><text x="${L - 6}" y="${sy.f(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("");
    out += `<text x="${(L + w - R) / 2}" y="${h - 6}" text-anchor="middle" class="ax">${esc(mx.label)} (${esc(mx.unit)})${mx.log ? " · log" : ""}</text>`;
    out += `<text transform="translate(12 ${(Tp + h - B) / 2}) rotate(-90)" text-anchor="middle" class="ax">${esc(my.label)} (${esc(my.unit)})${my.log ? " · log" : ""}</text>`;
    const placed = pts.map((p) => { const x = sx.f(p.x), y = sy.f(p.y); return { x0: x - 7, x1: x + 7, y0: y - 7, y1: y + 7 }; });
    for (const p of pts) {
      const x = sx.f(p.x), y = sy.f(p.y);
      const tipH = `<strong>${esc(p.label)}</strong><div class="tr">${esc(mx.label)}<b>${fmt(p.x)}${unitTxt(mx.unit)}</b></div><div class="tr">${esc(my.label)}<b>${fmt(p.y)}${unitTxt(my.unit)}</b></div>`;
      out += `<circle cx="${x}" cy="${y}" r="6" fill="${p.color}" stroke="var(--surface)" stroke-width="2"/><circle cx="${x}" cy="${y}" r="14" fill="transparent" data-tip="${esc(tipH)}"/>`;
      // label to the right unless near the edge; on collision try the other side, then above/below
      const tw = p.label.length * 6.4;
      const cands = [[x + 10, y + 4, "start"], [x - 10, y + 4, "end"], [x + 10, y - 10, "start"], [x + 10, y + 18, "start"], [x - 10, y - 10, "end"], [x - 10, y + 18, "end"]];
      const box = ([lx, ly, a]) => ({ x0: a === "start" ? lx : lx - tw, x1: a === "start" ? lx + tw : lx, y0: ly - 10, y1: ly + 2 });
      const fits = (c) => { const b = box(c); return b.x0 >= L && b.x1 <= w - 2 && !placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0); };
      const c = cands.find(fits) || cands[x < w - 110 ? 0 : 1];
      placed.push(box(c));
      out += `<text x="${c[0]}" y="${c[1]}" text-anchor="${c[2]}" class="lbl">${esc(p.label)}</text>`;
    }
    el.innerHTML = svgOpen(w, h, `${my.label} against ${mx.label}`) + out + "</svg>";
  }

  // ---------- data helpers ----------
  const ent = (id) => C.entities.find((e) => e.id === id);
  function total(e, kind, i) { const d = e[kind]; if (!d) return null; let s = 0, any = false; for (const k of SRC) { const v = d[k][i]; if (v != null) { s += v; any = true; } } return any ? s : null; }
  function indVal(e, ind, i) {
    if (ind.field) return e[ind.field]?.[i] ?? null;
    const t = total(e, "elec", i); if (!t) return null;
    if (ind.total) return t;
    return (100 * ind.parts.reduce((s, k) => s + (e.elec[k][i] || 0), 0)) / t;
  }
  const lastIdx = (kind) => C.years.indexOf(kind === "primary" ? C.lastPrimary : C.lastElec);
  // primary value of a technology metric: first numeric entry, or midpoint of first range (skip "existing" entries)
  function primary(item, mid) {
    const list = (item.values[mid] || []).filter((e) => !e.existing);
    for (const e of list) { if (e.v != null) return e.v; if (e.lo != null) return (e.lo + e.hi) / 2; }
    return null;
  }
  const tagOk = (it) => st.tag === "all" || it.tags.includes(st.tag);
  const metric = (id) => T.metrics.find((m) => m.id === id);
  const refLink = (id) => { const r = T.refs[id]; return r ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>` : ""; };
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  const entOpts = (sel) => {
    const groups = [["region", "Regions"], ["europe", "Europe"], ["americas", "Americas"], ["asia", "Asia & Middle East"], ["africa", "Africa"], ["oceania", "Oceania"]];
    return groups.map(([g, l]) => `<optgroup label="${l}">${C.entities.filter((e) => e.group === g).map((e) => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</optgroup>`).join("");
  };
  const metricOpts = (sel, filter = () => true) => {
    const gs = [...new Set(T.metrics.map((m) => m.group))];
    return gs.map((g) => `<optgroup label="${g}">${T.metrics.filter((m) => m.group === g && filter(m)).map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</optgroup>`).join("");
  };
  const legend = (ids) => `<div class="en-legend">${ids.map((k) => `<span><i style="background:var(--s-${k})"></i>${esc(SRC_NAME[k])}</span>`).join("")}</div>`;

  // ---------- sections ----------
  function renderKpis() {
    const w = ent("world"), i = lastIdx("elec"), y = C.years[i];
    const k = (ind) => fmt(indVal(w, IND.find((x) => x.id === ind), i));
    const solarPrev = w.elec.solar[i - 1], solarNow = w.elec.solar[i];
    $("#en-kpis").innerHTML = [
      ["Low-carbon electricity", k("lowcarbon") + "%", `World, ${y}`],
      ["Renewable electricity", k("renew") + "%", `World, ${y}`],
      ["Fossil electricity", k("fossil") + "%", `World, ${y}`],
      ["Solar growth", "+" + fmt(solarNow - solarPrev) + " TWh", `${y - 1}→${y}, largest of any source`],
    ].map(([a, b, c]) => `<div class="kpi"><span>${a}</span><strong>${b}</strong><em>${c}</em></div>`).join("");
  }

  function renderMix() {
    const e = ent(st.ent), kind = e[st.kind] ? st.kind : "elec";
    $("#en-ent").innerHTML = entOpts(st.ent);
    segSet("#en-kind", kind); segSet("#en-unit", st.pct ? "pct" : "twh");
    const layers = SRC.map((k) => ({ id: k, name: SRC_NAME[k], color: `var(--s-${k})`, values: e[kind][k] }));
    const unit = "TWh";
    stackArea($("#en-mix"), { years: C.years, layers, pct: st.pct, unit, label: `${kind === "elec" ? "Electricity" : "Primary energy"} by source, ${e.name}` });
    $("#en-mix-legend").innerHTML = legend(SRC.slice().reverse());
    $("#en-mix-note").innerHTML = kind === "elec"
      ? `Electricity generation, ${C.years[0]}–${C.lastElec}. Source: ${refLink("owid-energy")} (Ember, Energy Institute).`
      : `Primary energy (substitution method: nuclear and renewables are counted as the fossil fuel they would replace), ${C.years[0]}–${C.lastPrimary}. Source: ${refLink("owid-energy")} (Energy Institute).`;
  }

  function cmpRows(kind) {
    const i = lastIdx(kind);
    const list = C.entities.filter((e) => e[kind] && (st.cmpGroup === "all" || e.group === st.cmpGroup));
    const ind = IND.find((x) => x.id === st.cmpSort);
    return list.map((e) => {
      const tot = total(e, kind, i) || 0;
      const parts = SRC.map((k) => ({ id: k, name: SRC_NAME[k], color: `var(--s-${k})`, v: e[kind][k][i] || 0 }));
      const share = (ks) => (tot ? (100 * ks.reduce((s, k) => s + (e[kind][k][i] || 0), 0)) / tot : 0);
      return { label: e.name, parts, total: tot, bold: e.id === "ch" || e.id === "world", key: ind?.parts ? share(ind.parts) : share(["nuclear", ...RENEW]) };
    }).filter((r) => r.total > 0).sort((a, b) => b.key - a.key);
  }
  function renderCompare() {
    $("#en-cmp-group").innerHTML = REGION_GROUPS.map(([g, l]) => `<button class="chip ${st.cmpGroup === g ? "on" : ""}" data-g="${g}" aria-pressed="${st.cmpGroup === g}">${l}</button>`).join("");
    $("#en-cmp-sort").innerHTML = opts(IND.filter((x) => x.parts).map((x) => [x.id, "Sort: " + x.label]), st.cmpSort);
    segSet("#en-cmp-kind", st.cmpKind);
    const kind = st.cmpKind, y = kind === "primary" ? C.lastPrimary : C.lastElec;
    stackBars($("#en-cmp"), cmpRows(kind), `${kind === "elec" ? "Electricity" : "Primary energy"} mix by country, ${y}`);
    $("#en-cmp-legend").innerHTML = legend(SRC);
    $("#en-cmp-note").innerHTML = `${kind === "elec" ? "Electricity generation" : "Primary energy"} mix, ${y}. Source: ${refLink("owid-energy")}.`;
  }

  function renderRank() {
    $("#en-rank-ind").innerHTML = opts(IND.map((x) => [x.id, x.label]), st.rankInd);
    const ind = IND.find((x) => x.id === st.rankInd), i = lastIdx(ind.field === "energypc" ? "primary" : "elec");
    const rows = C.entities.filter((e) => st.cmpGroup === "all" || e.group === st.cmpGroup)
      .map((e) => ({ e, v: indVal(e, ind, i) })).filter((r) => r.v != null).sort((a, b) => b.v - a.v)
      .map(({ e, v }) => ({ label: e.name, v, color: e.id === "ch" ? "var(--accent)" : e.id === "world" ? "var(--ink)" : "var(--general)" }));
    hbars($("#en-rank"), rows, { unit: ind.unit, label: ind.label });
    $("#en-rank-note").innerHTML = `${esc(ind.label)} (${esc(ind.unit)}), ${C.years[i]}. Switzerland highlighted. Filter by region with the chips above. Source: ${refLink("owid-energy")}.`;
  }

  function renderTrend() {
    $("#en-trend-ind").innerHTML = opts(IND.map((x) => [x.id, x.label]), st.trendInd);
    $$("#en-trend-ents select").forEach((s, k) => { s.innerHTML = `<option value="">—</option>` + entOpts(st.trend[k]); });
    $$("#en-trend-ents i").forEach((dot, k) => (dot.style.background = TRIO[k]));
    const ind = IND.find((x) => x.id === st.trendInd);
    const series = st.trend.map((id, k) => (id ? { name: ent(id).name, color: TRIO[k], values: C.years.map((_, i) => indVal(ent(id), ind, i)) } : null)).filter(Boolean);
    lines($("#en-trend"), { years: C.years, series, unit: ind.unit, label: ind.label + " over time" });
    $("#en-trend-note").innerHTML = `${esc(ind.label)} (${esc(ind.unit)}). Pick up to three countries or regions. Source: ${refLink("owid-energy")}.`;
  }

  function techRows(mid) {
    const rows = [];
    for (const it of T.items) {
      if (!tagOk(it)) continue;
      const list = it.values[mid];
      if (!list) continue;
      for (const e of list) rows.push({ label: it.name + (e.label ? " · " + e.label : ""), v: e.v, lo: e.lo, hi: e.hi, note: e.note, color: col(it.id), dim: !!e.existing, item: it });
    }
    const key = (r) => (r.v != null ? r.v : r.lo != null ? (r.lo + r.hi) / 2 : -Infinity);
    const m = metric(mid);
    return rows.sort((a, b) => (m.better === "low" ? key(a) - key(b) : key(b) - key(a)));
  }
  function renderTech() {
    $("#en-tags").innerHTML = [["all", "All sources"], ...T.tags.map((t) => [t.id, t.label])].map(([id, l]) => `<button class="chip ${st.tag === id ? "on" : ""}" data-tag="${id}" aria-pressed="${st.tag === id}">${esc(l)}</button>`).join("");
    $("#en-metric").innerHTML = metricOpts(st.metric);
    const m = metric(st.metric), rows = techRows(st.metric);
    const box = $("#en-tech");
    if (st.table) {
      box.innerHTML = `<div class="en-table-wrap"><table class="en-table"><thead><tr><th>Source</th><th>${esc(m.unit)}</th><th>Note</th></tr></thead><tbody>${rows.map((r) =>
        `<tr><td><i class="sw" style="background:${r.color}"></i>${esc(r.label)}</td><td class="num">${r.lo != null ? fmt(r.lo) + "–" + fmt(r.hi) : fmt(r.v)}</td><td>${esc(r.note || "")}</td></tr>`).join("")}</tbody></table></div>`;
    } else hbars(box, rows, { log: m.log, unit: m.unit, label: m.label });
    $("#en-tech-table").textContent = st.table ? "Show chart" : "Show table";
    const better = { low: "Lower is better.", high: "Higher is better.", info: "" }[m.better];
    $("#en-tech-note").innerHTML = `<strong>${esc(m.label)}</strong> (${esc(m.unit)}${m.log ? ", log scale" : ""}). ${better} ${EH.highlight(esc(m.desc))}<br>Source: ${refLink(m.source)}.`;
  }

  function renderScatter() {
    $("#en-sx").innerHTML = metricOpts(st.sx); $("#en-sy").innerHTML = metricOpts(st.sy);
    const mx = metric(st.sx), my = metric(st.sy);
    const pts = T.items.filter(tagOk).map((it) => ({ label: it.name, x: primary(it, mx.id), y: primary(it, my.id), color: col(it.id) }))
      .filter((p) => p.x != null && p.y != null && (!mx.log || p.x > 0) && (!my.log || p.y > 0));
    scatter($("#en-scatter"), pts, { mx, my });
    $("#en-scatter-note").innerHTML = `Each dot is one source, using its main value (midpoint for ranges; existing plants excluded). Sources: ${refLink(mx.source)}; ${refLink(my.source)}.`;
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
    const head = `<tr><th></th>${ms.map((m) => `<th title="${esc(m.label)}"><span>${esc(m.label.replace(/ \(.*\)/, ""))}</span></th>`).join("")}</tr>`;
    const body = items.map((it) => `<tr><th><i class="sw" style="background:${col(it.id)}"></i>${esc(it.name)}</th>${ms.map((m) => {
      const v = primary(it, m.id), r = rank[m.id][it.id];
      if (v == null) return `<td class="na">–</td>`;
      const step = Math.round((1 - r) * 4);  // 4 = best
      return `<td class="h${step}" data-tip="${esc(`<strong>${esc(it.name)}</strong><div class="tr">${esc(m.label)}<b>${fmt(v)}${unitTxt(m.unit)}</b></div>`)}">${fmt(v)}</td>`;
    }).join("")}</tr>`).join("");
    $("#en-score").innerHTML = `<div class="en-table-wrap"><table class="en-heat"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function renderCards() {
    const items = T.items.filter(tagOk);
    $("#en-cards").innerHTML = items.map((it) => {
      const tags = it.tags.map((t) => `<span class="badge ${t === "fossil" ? "" : "type"}">${esc(T.tags.find((x) => x.id === t).label)}</span>`).join("");
      const fact = (mid) => { const m = metric(mid), list = it.values[mid]; if (!list) return ""; const e = list.find((x) => !x.existing) || list[0];
        return `<dt>${esc(m.label.replace(/,.*| \(.*\)/, ""))}</dt><dd>${e.lo != null ? fmt(e.lo) + "–" + fmt(e.hi) : fmt(e.v)}${e.v != null || e.lo != null ? unitTxt(m.unit) : ""}</dd>`; };
      return `<li class="card en-card" style="--c:${col(it.id)}"><div class="co-head"><h3>${esc(it.name)}</h3><span class="kind">${esc(it.dispatch)}</span></div>
        <div class="badges">${tags}</div>
        <p>${EH.highlight(esc(it.summary))}</p>
        <dl class="facts">${["share", "lcoe", "co2", "deaths", "cf"].map(fact).join("")}</dl>
        <div class="card-actions"><button class="link" data-open="${it.id}">Details & all metrics</button><button class="link" data-news="${esc(it.news)}">News in feed</button></div></li>`;
    }).join("");
  }

  function openItem(id) {
    const it = T.items.find((x) => x.id === id); if (!it) return;
    const sid = ITEM_SRC[id] || id, w = ent("world");
    const shares = C.years.map((_, i) => { const t = total(w, "elec", i); return t && w.elec[sid] ? (100 * (w.elec[sid][i] || 0)) / t : null; });
    const rows = T.metrics.map((m) => {
      const list = it.values[m.id]; if (!list) return "";
      return list.map((e) => `<tr><td>${esc(m.label)}${e.label ? ` <span class="muted">· ${esc(e.label)}</span>` : ""}</td><td class="num">${e.lo != null ? fmt(e.lo) + "–" + fmt(e.hi) : fmt(e.v)} <span class="muted">${esc(m.unit)}</span></td><td class="muted">${esc(e.note || "")}</td></tr>`).join("");
    }).join("");
    const terms = (it.terms || []).filter((t) => EH.findTerm(t));
    EH.openSheet(`<div class="gl-head"><h2>${esc(it.name)}</h2><span class="kind">${esc(it.dispatch)}</span></div>
      <div class="badges">${it.tags.map((t) => `<span class="badge type">${esc(T.tags.find((x) => x.id === t).label)}</span>`).join("")}</div>
      <p>${EH.highlight(esc(it.summary))}</p>
      <h3 class="en-h3">How it works</h3><p>${EH.highlight(esc(it.how))}</p>
      <h3 class="en-h3">Share of world electricity${id === "geothermal" ? " (bio & other renewables)" : ""}</h3><div id="en-spark"></div>
      <h3 class="en-h3">Key facts</h3><ul class="facts-list">${it.facts.map((f) => `<li>${EH.highlight(esc(f))}</li>`).join("")}</ul>
      <div class="en-pc"><div><h3 class="en-h3">Strengths</h3><ul class="facts-list">${it.pros.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
      <div><h3 class="en-h3">Weaknesses</h3><ul class="facts-list">${it.cons.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div></div>
      <h3 class="en-h3">In Switzerland</h3><p>${EH.highlight(esc(it.ch))}</p>
      <h3 class="en-h3">All metrics</h3><div class="en-table-wrap"><table class="en-table">${rows}</table></div>
      <p class="note">Sources for each metric are listed under the comparison charts and at the bottom of the tab.</p>
      ${terms.length ? `<div class="related">${terms.map((t) => `<button data-rel="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
      ${it.links?.length ? `<p class="small">${it.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(" · ")}</p>` : ""}
      <div class="sheet-actions"><button class="btn ghost" data-news="${esc(it.news)}">News in feed</button><button class="btn" data-close>Done</button></div>`);
    const body = $("#sheet-body");
    lines($("#en-spark", body), { years: C.years, series: [{ name: SRC_NAME[sid], color: col(id), values: shares }], unit: "%", label: "Share of world electricity" });
    $$("[data-rel]", body).forEach((b) => (b.onclick = () => EH.openTerm(b.dataset.rel)));
    $$("[data-news]", body).forEach((b) => (b.onclick = () => EH.searchFeed(b.dataset.news)));
  }

  function renderRefs() {
    $("#en-refs").innerHTML = `<ul class="facts-list">${Object.keys(T.refs).map((k) => `<li>${refLink(k)}</li>`).join("")}</ul>`;
  }

  function segSet(sel, v) { $$(sel + " button").forEach((b) => b.classList.toggle("on", (b.dataset.v) === v)); }

  function renderAll() {
    if (!T || !C) return;
    $("#en-about").textContent = `${T.about} Technology data checked ${T.updated}; country data built ${C.generated.slice(0, 10)}.`;
    renderKpis(); renderMix(); renderCompare(); renderRank(); renderTrend(); renderTech(); renderScatter(); renderScore(); renderCards(); renderRefs();
  }
  const charts = () => { renderMix(); renderCompare(); renderRank(); renderTrend(); renderTech(); renderScatter(); };

  // ---------- events ----------
  function wire() {
    const v = $("#view-energy");
    $("#en-ent").addEventListener("change", (e) => { st.ent = e.target.value; save(); renderMix(); });
    $("#en-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.kind = b.dataset.v; save(); renderMix(); } });
    $("#en-unit").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.pct = b.dataset.v === "pct"; save(); renderMix(); } });
    $("#en-cmp-group").addEventListener("click", (e) => { const b = e.target.closest("[data-g]"); if (b) { st.cmpGroup = b.dataset.g; save(); renderCompare(); renderRank(); } });
    $("#en-cmp-sort").addEventListener("change", (e) => { st.cmpSort = e.target.value; save(); renderCompare(); });
    $("#en-cmp-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.cmpKind = b.dataset.v; save(); renderCompare(); } });
    $("#en-rank-ind").addEventListener("change", (e) => { st.rankInd = e.target.value; save(); renderRank(); });
    $("#en-trend-ind").addEventListener("change", (e) => { st.trendInd = e.target.value; save(); renderTrend(); });
    $$("#en-trend-ents select").forEach((s, k) => s.addEventListener("change", () => { st.trend[k] = s.value; save(); renderTrend(); }));
    $("#en-tags").addEventListener("click", (e) => { const b = e.target.closest("[data-tag]"); if (b) { st.tag = b.dataset.tag; save(); renderTech(); renderScatter(); renderScore(); renderCards(); } });
    $("#en-metric").addEventListener("change", (e) => { st.metric = e.target.value; save(); renderTech(); });
    $("#en-tech-table").addEventListener("click", () => { st.table = !st.table; save(); renderTech(); });
    $("#en-sx").addEventListener("change", (e) => { st.sx = e.target.value; save(); renderScatter(); });
    $("#en-sy").addEventListener("change", (e) => { st.sy = e.target.value; save(); renderScatter(); });
    v.addEventListener("click", (e) => {
      const o = e.target.closest("[data-open]"); if (o) return openItem(o.dataset.open);
      const n = e.target.closest("[data-news]"); if (n) return EH.searchFeed(n.dataset.news);
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
    wire(); renderAll();
  }
  init();
})();
