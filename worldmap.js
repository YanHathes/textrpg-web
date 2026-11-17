// The world map (stage 2): the big map's pictures (game/bigmap.py, kept in the world) with what the party
// knows drawn over them: the fog, the continents, the regions and towns it has heard of, the places it has
// found, where it is, and the pinned quest. Drag to look around, pinch or + / − to zoom, tap a town to see the
// way there. Everything is placed in miles; the view is a centre (miles) and a scale (screen pixels a mile).
"use strict";

const WorldMap = (() => {
  const SIZE = { Hamlet: 3, Village: 4, Town: 5, City: 7, Capital: 9 };
  let B = null;                              // what bigmap() gave
  const pics = new Map();                    // picture name -> Image (null while it comes)
  let fog = null;
  let cx = 0, cy = 0, s = 1;                 // the view
  let canvas = null, ctx = null, W = 0, H = 0, dpr = 1;
  let goal = "";
  let pending = false;
  let picking = null, mark = null, trekTo = null;            // picking a spot (for a claim in the wilds): what gets it

  const img = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = "data:image/png;base64," + b64; });

  function init() {
    canvas = $("#wm-canvas");
    ctx = canvas.getContext("2d");
    new ResizeObserver(() => { size(); draw(); }).observe($("#wm-view"));
    wireGestures();
    $("#wm-close").onclick = close;
    $("#wm-party").onclick = () => { if (B && B.party) { cx = B.party[0]; cy = B.party[1]; s = Math.max(s, W / 250); clamp(); draw(); } };
    $("#wm-world").onclick = fitWorld;
    $$("#wm-zoom button").forEach((b) => b.onclick = () => zoomAt(W / 2, H / 2, parseFloat(b.dataset.wz)));
    $("#wm-go").onclick = async () => {
      if (picking) { close(); return; }
      if (trekTo) {                                   // across open country, hex by hex
        const r = await call("trek", { x: trekTo[0], y: trekTo[1] });
        trekTo = null; mark = null; close(); if (r && r.hud) showView(r, true); Tabs.show("walk");
        return;
      }
      if (!goal) return;
      const r = await call("route", { goal });
      close();
      if (r && r.view) showView(r.view, true);
      Tabs.show("walk");
    };
  }

  function size() {
    const r = $("#wm-view").getBoundingClientRect();
    dpr = Math.min(3, devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
  }

  function fitWorld() {
    if (!B) return;
    s = Math.min(W / B.width, H / B.height);
    cx = B.width / 2; cy = B.height / 2;
    draw();
  }

  function clamp() {
    if (!B) return;
    s = Math.max(Math.min(W / B.width, H / B.height) * 0.8, Math.min(60, s));
    cx = Math.max(0, Math.min(B.width, cx)); cy = Math.max(0, Math.min(B.height, cy));
  }

  const sx = (x) => (x - cx) * s + W / 2;
  const sy = (y) => (y - cy) * s + H / 2;
  const mx = (px) => (px - W / 2) / s + cx;
  const my = (py) => (py - H / 2) / s + cy;

  async function open(opts) {
    picking = (opts && opts.pick) || null; mark = null;
    if (picking) $("#panel").hidden = true;            // (the panel waits underneath)
    $("#worldmap").hidden = false;
    size();
    $("#wm-text").textContent = "Opening the map…";
    $("#wm-go").hidden = true;
    $("#wm-go").textContent = picking ? "Choose this spot" : "Go there";
    goal = "";
    B = await call("bigmap", {});
    fog = B.fog ? await img(B.fog.png) : null;
    if (B.party) { cx = B.party[0]; cy = B.party[1]; s = W / 250; } else { s = Math.min(W / B.width, H / B.height); cx = B.width / 2; cy = B.height / 2; }
    clamp();
    $("#wm-text").textContent = picking ? "Tap the land you want, then Choose this spot." :
      B.pin ? `Pinned: ${B.pin.title}. ${B.pin.text}` : "Tap a town to see the way there.";
    await want("world");
    draw();
  }

  function close() {
    $("#worldmap").hidden = true;
    if (picking) { const cb = picking; picking = null; $("#panel").hidden = false; if (mark) cb(mark[0], mark[1]); }
  }

  async function want(name) {
    if (pics.has(name) && pics.get(name) !== null && pics.get(name).done) return;
    if (pics.get(name) === null) return;          // (on its way)
    pics.set(name, null);
    const r = await RPC.call("bigmap_pic", { name });
    const im = r.png ? await img(r.png) : null;
    if (im) im.done = r.done;
    pics.set(name, im);
    const el = $("#wm-drawing");
    if (!r.done) {                                  // never drawn yet (a world made here): more, as it's looked at
      el.hidden = false; el.textContent = `Drawing the map: ${Math.round(r.fraction * 100)}%`;
      pics.delete(name);
      if (!$("#worldmap").hidden) setTimeout(() => want(name).then(draw), 50);
    } else if (name === "world") el.hidden = true;
    draw();
  }

  // ---- drawing
  function tier() {
    const span = W / s;                             // miles across the screen
    return span > 1500 ? "world" : span > 320 ? "continent" : "region";
  }

  function draw() {
    if (!ctx || $("#worldmap").hidden || !B || pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0f0b"; ctx.fillRect(0, 0, W, H);
    const world = pics.get("world");
    const wb = B.pics.world.bounds;
    ctx.imageSmoothingEnabled = s * dpr < B.pics.world.w / (wb[2] - wb[0]);
    if (world) ctx.drawImage(world, sx(wb[0]), sy(wb[1]), (wb[2] - wb[0]) * s, (wb[3] - wb[1]) * s);
    // the continents' own sharper pictures, once zoomed in past the world's
    const worldPpm = B.pics.world.w / (wb[2] - wb[0]);
    if (s * dpr > worldPpm * 1.25) {
      const x0 = mx(0), y0 = my(0), x1 = mx(W), y1 = my(H);
      for (const [name, p] of Object.entries(B.pics)) {
        if (name === "world") continue;
        const b = p.bounds;
        if (!(b[0] < x1 && x0 < b[2] && b[1] < y1 && y0 < b[3])) continue;
        const im = pics.get(name);
        if (im === undefined) { want(name); continue; }
        if (im) ctx.drawImage(im, sx(b[0]), sy(b[1]), (b[2] - b[0]) * s, (b[3] - b[1]) * s);
      }
    }
    if (fog) { ctx.imageSmoothingEnabled = false; ctx.drawImage(fog, sx(0), sy(0), B.fog.w * s, B.fog.h * s); }
    const t = tier();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const taken = [];                               // labels never drawn over one another
    const label = (text, x, y, font, color, must) => {
      ctx.font = font;
      const w = ctx.measureText(text).width + 4, h = 14, r = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (!must && taken.some((o) => r[0] < o[2] && o[0] < r[2] && r[1] < o[3] && o[1] < r[3])) return;
      taken.push(r);
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,8,6,.85)";
      ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
    };
    if (t === "world" || W / s > 900) for (const c of B.continents) label(c.name.toUpperCase(), sx(c.x), sy(c.y), "16px KB", "#e8dca8");
    const order = shownTowns().sort((a, b) => (b.visited - a.visited) || ((SIZE[b.kind] || 4) - (SIZE[a.kind] || 4)));
    for (const tw of order) {
      const x = sx(tw.x), y = sy(tw.y), r = SIZE[tw.kind] || 4;
      ctx.fillStyle = tw.visited ? "#f0e6c8" : "#b8ae90"; ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (tw.kind === "City" || tw.kind === "Capital") ctx.rect(x - r, y - r, 2 * r, 2 * r); else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (t !== "world" || tw.kind === "City" || tw.kind === "Capital") label(tw.name, x, y + r + 9, "bold 12px KB", "#f4f0e0");
    }
    if (t !== "world") for (const r of B.regions) label(r.name, sx(r.x), sy(r.y) - 18, "italic 13px K", "#f0e8c8");
    // the places it has found
    if (t === "region") {
      for (const m of B.marks) {
        const x = sx(m.x), y = sy(m.y), r = 5;
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        ctx.fillStyle = m.kind === "landmark" ? "#c08040" : "#a04040"; ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (W / s < 120) label(m.name, x, y + 13, "11px K", "#e8d8b0");
      }
    }
    if (B.party) {
      const x = sx(B.party[0]), y = sy(B.party[1]);
      ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#e8b048"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
    }
    if (B.pin && B.pin.pos) pinAt(sx(B.pin.pos[0]), sy(B.pin.pos[1]));
    if (mark) { ctx.strokeStyle = "#ff4040"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(mark[0]) - 8, sy(mark[1]));
      ctx.lineTo(sx(mark[0]) + 8, sy(mark[1])); ctx.moveTo(sx(mark[0]), sy(mark[1]) - 8); ctx.lineTo(sx(mark[0]), sy(mark[1]) + 8); ctx.stroke(); }
    scaleBar();
  }

  function shownTowns() {
    const t = tier();
    const show = t === "world" ? ["City", "Capital"] : t === "continent" ? ["Town", "City", "Capital"] : null;
    return B.towns.filter((tw) => !show || show.includes(tw.kind) || tw.visited || s > 3);
  }

  function pinAt(x, y) {
    const m = 22;
    ctx.fillStyle = "#e8c450"; ctx.strokeStyle = "#14100a"; ctx.lineWidth = 2;
    if (x >= m && x <= W - m && y >= m && y <= H - m) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7, y - 13); ctx.lineTo(x + 7, y - 13); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - 14, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      return;
    }
    const dx = x - W / 2, dy = y - H / 2;            // off the screen: an arrow at the edge, pointing to it
    const k = Math.min(dx ? (W / 2 - m) / Math.abs(dx) : 1e9, dy ? (H / 2 - m) / Math.abs(dy) : 1e9);
    const ax = W / 2 + dx * k, ay = H / 2 + dy * k, ln = Math.hypot(dx, dy) || 1, ux = dx / ln, uy = dy / ln;
    ctx.beginPath(); ctx.moveTo(ax + ux * 16, ay + uy * 16); ctx.lineTo(ax - uy * 10, ay + ux * 10); ctx.lineTo(ax + uy * 10, ay - ux * 10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  function scaleBar() {
    const miles = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, 120 / s)))));
    const px = miles * s, y = H - 14;
    ctx.strokeStyle = "#f4f0e0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(12 + px, y); ctx.stroke();
    ctx.textAlign = "left"; ctx.font = "12px K"; ctx.fillStyle = "#f4f0e0"; ctx.fillText(`${miles} miles`, 14, y - 10);
  }

  // ---- looking around
  function zoomAt(px, py, f) {
    const x = mx(px), y = my(py);
    s *= f; clamp();
    cx = x - (px - W / 2) / s; cy = y - (py - H / 2) / s; clamp();
    draw();
  }

  function wireGestures() {
    const pts = new Map();
    let pinch = null, downAt = null, moved = 0;
    canvas.addEventListener("pointerdown", (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* */ }
      pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pts.size === 1) { downAt = [e.offsetX, e.offsetY, performance.now()]; moved = 0; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s }; }
    });
    canvas.addEventListener("pointermove", (e) => {
      const was = pts.get(e.pointerId);
      if (!was) return;
      const now = [e.offsetX, e.offsetY];
      pts.set(e.pointerId, now);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch.s * d / Math.max(1, pinch.d)) / s);
        moved = 99;
      } else if (pts.size === 1) {
        cx -= (now[0] - was[0]) / s; cy -= (now[1] - was[1]) / s;
        moved += Math.abs(now[0] - was[0]) + Math.abs(now[1] - was[1]);
        clamp(); draw();
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && downAt && moved < 10 && performance.now() - downAt[2] < 600) tap(downAt[0], downAt[1]);
      if (pts.size === 0) downAt = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  }

  async function tap(px, py) {
    if (!B) return;
    if (picking) {
      mark = [mx(px), my(py)];
      const r = await call("bigmap_at", { x: mark[0], y: mark[1] });
      $("#wm-text").textContent = r.text; $("#wm-go").hidden = false; draw();
      return;
    }
    const near = (list, r) => {
      let best = null, bd = r;
      for (const p of list) { const d = Math.hypot(sx(p.x) - px, sy(p.y) - py); if (d < bd) { best = p; bd = d; } }
      return best;
    };
    goal = ""; trekTo = null; if (!picking) mark = null;
    $("#wm-go").hidden = true; $("#wm-go").textContent = "Go there";
    const tw = near(shownTowns(), 18);
    if (tw) {
      const r = await call("bigmap_town", { id: tw.id });
      $("#wm-text").textContent = r.text;
      goal = r.go || "";
      $("#wm-go").hidden = !goal;
      return;
    }
    const m = tier() === "region" ? near(B.marks, 14) : null;
    if (m) { $("#wm-text").textContent = `${m.name}\n${m.what}`; return; }
    const r = await call("bigmap_at", { x: mx(px), y: my(py) });
    $("#wm-text").textContent = r.text;
    if (r.trek) { trekTo = [mx(px), my(py)]; $("#wm-go").textContent = "Trek there"; $("#wm-go").hidden = false; mark = trekTo; draw(); }
  }

  return { init, open, close };
})();
WorldMap.init();
