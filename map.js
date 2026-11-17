// The walking map, drawn on a canvas (the browser version of ui/explore_view.py). Python decides what's
// where (web/scene.py) and makes the small pictures; this draws them. Blocks of the map (16 x 16 squares) are
// drawn once into their own canvases, in colour and in grey (what's been seen but isn't in sight now); each
// frame then lays on the doors, the people, the roofs, the party, the dark of the hour and the unseen.
"use strict";

const MapView = (() => {
  const T = 32, CH = 16;
  const ZOOMS = [16, 22, 32, 44, 60];          // screen pixels to a square
  let zi = 2;                                  // into ZOOMS; below 0, the far steps (see levels)
  let sight = 0;                               // how far the party sees (squares), from the frame
  let canvas, ctx, dpr = 1;
  let view = null;                             // from bridge.api_view: area, level, x, y, w, h
  let frame = null;                            // from bridge.api_frame
  let frameBox = null;
  const tiles = new Map();                     // tile key -> Image
  const sprites = new Map();                   // "key@turn~step" -> Image
  const chunks = new Map();                    // "area|level|cx|cy|look" -> {color, grey} (or "pending")
  const roofs = new Map();                     // "area|bid|look" -> {color, grey, x, y, w, h, ridge}
  const overlays = { fog: null, dark: null, glow: null };
  let cam = { x: 0, y: 0 };                    // the square the view's centred on (moves smoothly)
  let slide = null;                            // {from, to, t0}
  let stepFrame = 0;
  let look = "";
  let dirty = true;
  let wanting = null;                          // a frame being fetched

  // ---------------------------------------------------------------- pictures
  function img(b64) {
    const im = new Image();
    im.src = "data:image/png;base64," + b64;
    return im.decode().then(() => im, () => im);
  }

  async function needTiles(keys) {
    const missing = [...new Set(keys)].filter((k) => !tiles.has(k));
    if (!missing.length) return;
    for (const k of missing) tiles.set(k, null);
    const got = await RPC.call("tiles", { keys: missing });
    await Promise.all(Object.entries(got).map(async ([k, b64]) => { tiles.set(k, b64 ? await img(b64) : null); }));
  }

  async function needSprites(list) {
    const missing = list.filter(([k, t, s]) => !sprites.has(`${k}@${t}~${s}`));
    if (!missing.length) return;
    for (const [k, t, s] of missing) sprites.set(`${k}@${t}~${s}`, null);
    const got = await RPC.call("sprites", { keys: missing });
    await Promise.all(Object.entries(got).map(async ([k, b64]) => { if (b64) sprites.set(k, await img(b64)); }));
    dirty = true;
  }

  function grey(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const g = c.getContext("2d");
    if ("filter" in g) {
      g.filter = "grayscale(1) brightness(0.5)";
      g.drawImage(src, 0, 0);
    } else {                                    // older Safari: by hand
      g.drawImage(src, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const v = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) * 0.5;
        p[i] = p[i + 1] = p[i + 2] = v;
      }
      g.putImageData(d, 0, 0);
    }
    return c;
  }

  async function buildChunk(key, level, cx, cy) {
    const ch = await RPC.call("chunk", { level, cx, cy });
    await needTiles([...ch.ops.map((o) => o[0]), ...ch.over.map((o) => o[0])]);
    const c = document.createElement("canvas");
    c.width = c.height = ch.size;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#000"; g.fillRect(0, 0, ch.size, ch.size);
    for (const [k, x, y] of ch.ops) { const t = tiles.get(k); if (t) g.drawImage(t, x, y); }
    for (const [x, y, w, h, a] of ch.shade) { g.fillStyle = `rgba(10,12,14,${a / 255})`; g.fillRect(x, y, w, h); }
    for (const [k, x, y] of ch.over) { const t = tiles.get(k); if (t) g.drawImage(t, x, y); }
    chunks.set(key, { color: c, grey: grey(c) });
    dirty = true;
  }

  function chunk(level, cx, cy) {
    const key = `${view.area}|${level}|${cx}|${cy}|${look}`;
    const got = chunks.get(key);
    if (got === undefined) {
      chunks.set(key, "pending");
      buildChunk(key, level, cx, cy).catch(() => chunks.delete(key));
      if (chunks.size > 90) {                    // forget the far-off blocks
        for (const k of chunks.keys()) { if (chunks.size <= 70) break; if (k !== key) chunks.delete(k); }
      }
      return null;
    }
    return got === "pending" ? null : got;
  }

  async function roof(bid) {
    const key = `${view.area}|${bid}|${look}`;
    if (roofs.has(key)) return roofs.get(key);
    roofs.set(key, null);
    const r = await RPC.call("roof", { bid });
    if (!r || !r.png) return null;
    const im = await img(r.png);
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    g.strokeStyle = "rgba(255,240,210,0.27)"; g.lineWidth = 2;        // the ridge
    g.beginPath();
    if (r.ridge === "h") { g.moveTo(0, c.height / 2); g.lineTo(c.width, c.height / 2); }
    else { g.moveTo(c.width / 2, 0); g.lineTo(c.width / 2, c.height); }
    g.stroke();
    const got = { color: c, grey: grey(c), x: r.x, y: r.y, w: r.w, h: r.h };
    roofs.set(key, got);
    dirty = true;
    return got;
  }

  // ---------------------------------------------------------------- the view
  // The zoom steps: ZOOMS, bigger on a bigger screen (a computer's) so as much shows; and further out, steps
  // down to where the whole of what the party can see fits, and a little past it, to look down the road.
  function levels() {
    const short = canvas ? Math.min(canvas.clientWidth, canvas.clientHeight) : 0;
    const near = ZOOMS.map((z) => Math.round(z * Math.max(1, Math.min(2.5, short / 480))));
    const far = [];
    if (sight > 0 && short > 0) {
      const want = Math.max(3, Math.floor(short / (2 * sight + 5)));
      let z = near[0];
      while (Math.round(z * 0.75) > want) { z = Math.round(z * 0.75); far.unshift(z); }
      if (want < near[0]) far.unshift(want);
    }
    return { list: [...far, ...near], base: far.length };
  }
  function cs() {
    const L = levels();
    return L.list[Math.max(0, Math.min(L.list.length - 1, L.base + zi))];
  }

  function box() {                                // the squares on screen, and a little round
    const w = canvas.clientWidth, h = canvas.clientHeight, s = cs();
    const x0 = Math.floor(cam.x + 0.5 - w / 2 / s) - 2, y0 = Math.floor(cam.y + 0.5 - h / 2 / s) - 2;
    return [x0, y0, x0 + Math.ceil(w / s) + 5, y0 + Math.ceil(h / s) + 5];
  }

  async function refresh(force) {
    if (!view || !view.area) return;
    const b = box();
    if (!force && frameBox && b[0] >= frameBox[0] && b[1] >= frameBox[1] && b[2] <= frameBox[2] && b[3] <= frameBox[3]) return;
    if (wanting) { wanting.again = true; return; }
    const pad = 6;
    const want = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
    wanting = { again: false };
    try {
      const f = await RPC.call("frame", { x0: want[0], y0: want[1], x1: want[2], y1: want[3] });
      if (f.look !== look) { look = f.look; chunks.clear(); roofs.clear(); }
      frame = f; frameBox = want;
      if (f.sight && f.sight !== sight) { sight = f.sight; if (zi < 0) { dirty = true; refresh(false); } }
      const pk = f.party.key || "party";
      const list = [[pk, f.party.turn, 0], [pk, f.party.turn, 1], [pk, f.party.turn, 2]];
      for (const p of f.people) list.push([p.key, p.turn, 0]);
      for (const p of f.followers) list.push([p.key, p.turn, 0]);
      if (f.party.vessel) list.push([`vessel:${f.party.vessel}`, f.party.turn, 0]);
      await Promise.all([
        needSprites(list), needTiles([...f.doors.map((d) => d.key), ...(f.crowns || []).map((c) => c[0]),
                                     ...(f.traps || []).map((t) => t.key),
                                     ...(f.cracks || []).map((t) => t[2]), ...(f.fires || []).map((t) => t[2])]),
        img(f.fog.png).then((im) => { overlays.fog = { im, ...f.fog }; }),
        f.dark ? Promise.all([img(f.dark.png), img(f.dark.glow)]).then(([d, g]) => {
          overlays.dark = { im: d, ...f.dark }; overlays.glow = g; }) : (overlays.dark = null),
        ...f.roofs.filter((r) => !r.here).map((r) => roof(r.bid)),
      ]);
      dirty = true;
    } finally {
      const again = wanting && wanting.again;
      wanting = null;
      if (again) refresh(true);
    }
  }

  function setView(v, moved) {
    const newArea = !view || v.area !== view.area || v.level !== view.level;
    if (newArea || !moved) { cam = { x: v.x, y: v.y }; slide = null; }
    else if (moved) { slide = { from: { ...cam }, to: { x: v.x, y: v.y }, t0: performance.now() }; stepFrame = (stepFrame % 2) + 1; }
    view = v;
    refresh(true);
    dirty = true;
  }

  // ---------------------------------------------------------------- drawing
  function draw(now) {
    requestAnimationFrame(draw);
    if (slide) {
      const t = Math.min(1, (now - slide.t0) / 130);
      cam.x = slide.from.x + (slide.to.x - slide.from.x) * t;
      cam.y = slide.from.y + (slide.to.y - slide.from.y) * t;
      if (t >= 1) { slide = null; refresh(false); }
      dirty = true;
    }
    if (!dirty || !canvas) return;
    dirty = false;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    if (!view || !frame) return;
    const s = cs();
    const ox = W / 2 - (cam.x + 0.5) * s, oy = H / 2 - (cam.y + 0.5) * s;
    const [x0, y0, x1, y1] = box();
    const level = frame.level;
    const cl = [];
    for (let cy = Math.floor(Math.max(0, y0) / CH); cy <= Math.floor((y1 - 1) / CH); cy++)
      for (let cx = Math.floor(Math.max(0, x0) / CH); cx <= Math.floor((x1 - 1) / CH); cx++) cl.push([cx, cy, chunk(level, cx, cy)]);
    // 1. what's known, in grey; 2. what's in sight, in colour
    for (const [cx, cy, c] of cl) if (c) ctx.drawImage(c.grey, ox + cx * CH * s, oy + cy * CH * s, CH * s, CH * s);
    ctx.save();
    ctx.beginPath();
    for (const [rx, ry, rw] of frame.runs) ctx.rect(ox + rx * s, oy + ry * s, rw * s, s);
    ctx.clip();
    for (const [cx, cy, c] of cl) if (c) ctx.drawImage(c.color, ox + cx * CH * s, oy + cy * CH * s, CH * s, CH * s);
    ctx.restore();
    // doors
    for (const d of frame.doors) {
      const t = tiles.get(d.key);
      if (!t) continue;
      ctx.globalAlpha = d.lit ? 1 : 0.45;
      ctx.drawImage(t, ox + d.x * s, oy + d.y * s, s, s);
      if (d.locked && d.lit) padlock(ox + d.x * s, oy + d.y * s, s);
    }
    for (const tr of frame.traps || []) {            // traps the party knows of (game/traps.py)
      const t = tiles.get(tr.key);
      if (!t) continue;
      ctx.globalAlpha = tr.lit ? 1 : 0.5;
      ctx.drawImage(t, ox + tr.x * s, oy + tr.y * s, s, s);
    }
    for (const [x, y, k, lit] of frame.cracks || []) {   // battered walls and things (game/destruction.py)
      const t = tiles.get(k);
      if (!t) continue;
      ctx.globalAlpha = lit ? 1 : 0.5;
      ctx.drawImage(t, ox + x * s, oy + y * s, s, s);
    }
    for (const [x, y, k, lit] of frame.fires || []) {    // flames (game/fire.py): taller than a square
      const t = tiles.get(k);
      if (!t) continue;
      ctx.globalAlpha = lit ? 1 : 0.6;
      const h = s * t.height / t.width;
      ctx.drawImage(t, ox + x * s, oy + (y + 1) * s - h, s, h);
    }
    ctx.globalAlpha = 1;
    // people under roofs, the roofs, the people out of doors
    for (const p of frame.people) if (p.indoors) person(p, ox, oy, s);
    for (const r of frame.roofs) {
      if (r.here) continue;
      const got = roofs.get(`${view.area}|${r.bid}|${look}`);
      if (got) ctx.drawImage(r.lit ? got.color : got.grey, ox + got.x * s, oy + got.y * s, got.w * s, got.h * s);
    }
    for (const p of frame.people) if (!p.indoors) person(p, ox, oy, s);
    for (const f of frame.followers) person(f, ox, oy, s);
    // the party
    const px = ox + cam.x * s, py = oy + cam.y * s;
    ctx.fillStyle = "rgba(255,225,140,0.24)";
    ctx.beginPath(); ctx.ellipse(px + s * 0.5, py + s * 0.8, s * 0.65, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
    const step = slide ? stepFrame : 0;
    const key = frame.party.vessel ? `vessel:${frame.party.vessel}` : (frame.party.key || "party");
    figure(sprites.get(`${key}@${frame.party.turn}~${step}`) || sprites.get(`${key}@${frame.party.turn}~0`), px, py, s, false);
    // tree crowns over whoever stands behind them, half seen through (web/scene.py _crowns)
    if (frame.crowns && frame.crowns.length) {
      ctx.globalAlpha = 0.55;
      for (const [k, left, top, w, rise] of frame.crowns) {
        const t = tiles.get(k);
        if (t) ctx.drawImage(t, 0, 0, w, rise, ox + left / T * s, oy + top / T * s, w / T * s, rise / T * s);
      }
      ctx.globalAlpha = 1;
    }
    // a building being marked out (web/estate.py): the claim's edge, the building's squares, its door
    const g = view.placing;
    if (g) {
      ctx.strokeStyle = "rgba(240,200,80,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(ox + g.claim[0] * s, oy + g.claim[1] * s, g.claim[2] * s, g.claim[3] * s); ctx.setLineDash([]);
      ctx.fillStyle = g.ok ? "rgba(90,200,90,0.38)" : "rgba(220,70,50,0.38)";
      ctx.fillRect(ox + g.rect[0] * s, oy + g.rect[1] * s, g.rect[2] * s, g.rect[3] * s);
      ctx.strokeStyle = g.ok ? "#4a9a3a" : "#b03020"; ctx.lineWidth = 2;
      ctx.strokeRect(ox + g.rect[0] * s, oy + g.rect[1] * s, g.rect[2] * s, g.rect[3] * s);
      if (g.door) { ctx.fillStyle = "#e8c060"; ctx.fillRect(ox + (g.door[0] + 0.25) * s, oy + (g.door[1] + 0.25) * s, s * 0.5, s * 0.5); }
    }
    // the dark of the hour (with the lights), then what's never been seen
    ctx.imageSmoothingEnabled = true;
    if (overlays.dark) {
      const d = overlays.dark;
      ctx.drawImage(d.im, ox + d.x * s, oy + d.y * s, d.w * s, d.h * s);
      if (overlays.glow) ctx.drawImage(overlays.glow, ox + d.x * s, oy + d.y * s, d.w * s, d.h * s);
    }
    if (overlays.fog) {
      const f = overlays.fog;
      ctx.drawImage(f.im, ox + f.x * s, oy + f.y * s, f.w * s, f.h * s);
    }
    ctx.imageSmoothingEnabled = false;
  }

  function person(p, ox, oy, s) {
    const im = sprites.get(`${p.key}@${p.turn}~0`);
    if (p.enemy) {
      ctx.fillStyle = "rgba(200,40,30,0.27)";
      ctx.beginPath(); ctx.ellipse(ox + (p.x + 0.5) * s, oy + (p.y + 0.8) * s, s * 0.45, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }
    figure(im, ox + p.x * s, oy + p.y * s, s, p.enemy);
    if (p.work != null) {                       // what they're making, and how far along
      ctx.fillStyle = "rgba(20,14,10,0.8)"; ctx.fillRect(ox + p.x * s + s * 0.1, oy + p.y * s - s * 0.12, s * 0.8, s * 0.1);
      ctx.fillStyle = "#e8c060"; ctx.fillRect(ox + p.x * s + s * 0.1, oy + p.y * s - s * 0.12, s * 0.8 * p.work, s * 0.1);
    }
  }

  function figure(im, x, y, s, enemy) {
    if (!im) {
      ctx.fillStyle = enemy ? "#c84a3a" : "#d8c48a";
      ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 2); ctx.fill();
      return;
    }
    let w = im.width * s / T, h = im.height * s / T;
    if (w > s * 2.3) { const k = s * 2.3 / w; w *= k; h *= k; }
    ctx.drawImage(im, x + (s - w) / 2, y + s - h, w, h);
  }

  function padlock(x, y, s) {
    const k = s * 0.22;
    ctx.fillStyle = "rgba(230,200,90,0.9)";
    ctx.fillRect(x + s - k * 1.6, y + k * 0.9, k, k * 0.8);
    ctx.strokeStyle = "rgba(230,200,90,0.9)"; ctx.lineWidth = Math.max(1, s / 32);
    ctx.beginPath(); ctx.arc(x + s - k * 1.1, y + k * 0.85, k * 0.4, Math.PI, 0); ctx.stroke();
  }

  // ---------------------------------------------------------------- zoom (buttons, pinch, wheel)
  function zoom(d) {
    zi = Math.max(-levels().base, Math.min(ZOOMS.length - 1, zi + d));
    try { localStorage.setItem("zoom", String(zi)); } catch (e) { /* private mode */ }
    refresh(true);
    dirty = true;
  }

  function init(el) {
    canvas = el;
    ctx = canvas.getContext("2d");
    dpr = Math.min(3, window.devicePixelRatio || 1);
    try { const z = parseInt(localStorage.getItem("zoom"), 10); if (z >= -12 && z < ZOOMS.length) zi = z; } catch (e) { /* */ }
    new ResizeObserver(() => { dirty = true; refresh(false); }).observe(canvas);
    const touches = new Map();
    let pinch = null;
    canvas.addEventListener("pointerdown", (e) => { touches.set(e.pointerId, e); if (touches.size === 2) pinch = gap(); });
    canvas.addEventListener("pointermove", (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, e);
      if (touches.size === 2 && pinch) {
        const g = gap();
        if (g > pinch * 1.35) { zoom(1); pinch = g; } else if (g < pinch / 1.35) { zoom(-1); pinch = g; }
      }
    });
    const up = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    function gap() { const [a, b] = [...touches.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    requestAnimationFrame(draw);
  }

  function stale(blocks) {                        // the land changed (a tree down, a wall gone, a fire)
    const want = new Set(blocks.map(([cx, cy]) => `|${cx}|${cy}|`));
    for (const k of [...chunks.keys()]) {
      const parts = k.split("|");
      if (want.has(`|${parts[parts.length - 3]}|${parts[parts.length - 2]}|`)) chunks.delete(k);
    }
    roofs.clear();
    dirty = true;
    refresh(true);
  }

  return { init, setView, refresh, zoom, stale, kick() { dirty = true; } };
})();
