// Minigames and gambling tables (stage 3): the game is the game's own (web/games.py), drawing itself as
// shapes on a 640 x 360 board; this draws them, sends taps and held buttons, and ticks it along.
"use strict";

const Play = (() => {
  const BW = 640, BH = 360;
  const SUITS = "♠♥♦♣", RANKS = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const SUIT_COL = ["#1a1a1a", "#b8282a", "#b8282a", "#1a1a1a"];
  const CHIP_COL = [[10000, "#1a1a1a"], [1000, "#2a8a4a"], [100, "#3a6ac8"], [10, "#c84a3a"], [1, "#e8e2d0"]];
  const PIPS = { 1: [[.5, .5]], 2: [[.25, .25], [.75, .75]], 3: [[.25, .25], [.5, .5], [.75, .75]],
    4: [[.25, .25], [.75, .25], [.25, .75], [.75, .75]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]],
    6: [[.25, .25], [.75, .25], [.25, .5], [.75, .5], [.25, .75], [.75, .75]] };
  let P = null, on = false, last = 0, waiting = false;
  let presses = [], releases = [];
  const held = new Set();
  const pics = new Map();
  let canvas, ctx;

  function init() {
    canvas = $("#play-canvas"); ctx = canvas.getContext("2d");
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * BW, y = (e.clientY - r.top) / r.height * BH;
      send({ do: "tap", x, y, dt: tickDt() });
    });
    $("#play-quit").onclick = () => send({ do: P && P.kind === "table" ? "button" : "giveup", action: "leave" });
    requestAnimationFrame(loop);
  }

  function tickDt() { const now = performance.now(); const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now; return dt; }

  async function open() {
    if (on) return;
    on = true; last = 0; held.clear();
    $("#play").hidden = false;
    await send({ do: "state" });
  }

  function close() {
    on = false; P = null;
    $("#play").hidden = true;
    if (typeof Tabs !== "undefined") Tabs.refresh();
  }

  async function send(args) {
    if (!on) return;
    waiting = true;
    try {
      const r = await call("play", { press: presses.splice(0), release: releases.splice(0), ...args });
      if (r.view) showView(r.view, false);
      if (!r.play) { close(); return; }
      P = r.play;
      await needPics();
      paint(); chrome();
    } finally { waiting = false; }
  }

  function loop() {                             // the game's clock: about thirty ticks a second while it runs
    if (on && P && !waiting) {
      const live = P.kind === "game" || P.live;
      if (live) send({ do: "tick", dt: tickDt() }); else last = 0;
    }
    setTimeout(() => requestAnimationFrame(loop), P && P.kind === "game" ? 30 : 120);
  }

  async function needPics() {
    const keys = new Set();
    for (const d of P.draw) {
      if (d[0] === "sprite" && d[1] && !pics.has(d[1])) keys.add(d[1]);
      if (d[0] === "seat" && d[4] && !pics.has(d[4])) keys.add(d[4]);
    }
    if (!keys.size) return;
    for (const k of keys) pics.set(k, null);
    const got = await call("play_sprites", { keys: [...keys] });
    await Promise.all(Object.entries(got).map(([k, b64]) => new Promise((ok) => {
      if (!b64) { ok(); return; }
      const i = new Image(); i.onload = () => { pics.set(k, i); ok(); }; i.onerror = ok; i.src = "data:image/png;base64," + b64;
    })));
  }

  // ---- the parts round the board
  function chrome() {
    $("#play-title").textContent = P.title;
    $("#play-help").textContent = P.kind === "table" ? `${P.help}\n${P.purse}` : P.help;
    $("#play-help").style.whiteSpace = "pre-line";
    $("#play-bar").hidden = P.kind !== "game";
    if (P.kind === "game") $("#play-bar i").style.width = Math.round(100 * Math.max(0, P.bar)) + "%";
    $("#play-flash").textContent = P.kind === "table" ? P.flash : "";
    const pads = $("#play-pads");
    const want = P.kind === "game" ? P.pads.map((x) => x.join("|")).join(",") : "";
    if (pads.dataset.want !== want) {
      pads.dataset.want = want; pads.innerHTML = "";
      if (P.kind === "game") for (const [label, action] of P.pads) {
        const b = document.createElement("button"); b.textContent = label;
        const down = (e) => { e.preventDefault(); if (held.has(action)) return; held.add(action); presses.push(action); b.classList.add("held"); };
        const up = () => { if (!held.has(action)) return; held.delete(action); releases.push(action); b.classList.remove("held"); };
        b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
        b.addEventListener("pointerleave", up);
        pads.append(b);
      }
    }
    const bt = $("#play-buttons"); bt.innerHTML = "";
    if (P.kind === "table") for (const [label, action, ok] of P.buttons) {
      if (action === "leave") continue;
      const b = document.createElement("button"); b.className = "cmd"; b.textContent = label; b.disabled = !ok;
      b.onclick = () => send({ do: "button", action, dt: tickDt() }); bt.append(b);
    }
    $("#play-quit").textContent = P.kind === "table" ? "Leave the table" : (P.quit || "Roll the dice instead");
  }

  // ---- the board
  function paint() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(3, devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    ctx.setTransform(W / BW, 0, 0, H / BH, 0, 0);
    minFont = 11 / Math.max(0.1, r.width / BW);
    ctx.fillStyle = "#221812"; ctx.fillRect(0, 0, BW, BH);
    ctx.lineCap = "round";
    for (const d of P.draw) prim(d);
    if (P.done && P.result) {
      ctx.fillStyle = "rgba(20,10,6,0.55)"; ctx.fillRect(0, 0, BW, BH);
      ctx.fillStyle = "#f6ecd6"; ctx.fillRect(BW / 2 - 200, BH / 2 - 60, 400, 120);
      ctx.strokeStyle = "#8a5a2a"; ctx.lineWidth = 4; ctx.strokeRect(BW / 2 - 200, BH / 2 - 60, 400, 120);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = P.result.ok ? "#2f6a2a" : "#a02a20"; ctx.font = "bold 34px KB";
      ctx.fillText(P.result.word, BW / 2, BH / 2 - 20);
      ctx.fillStyle = "#2b1f14"; ctx.font = "16px K";
      ctx.fillText(P.result.line, BW / 2, BH / 2 + 26, 380);
    }
  }

  function chipCol(v) { for (const [n, c] of CHIP_COL) if (v >= n) return c; return "#e8e2d0"; }
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  let minFont = 9;                                 // no words smaller than about 11 screen pixels
  function prim(d) {
    const k = d[0];
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    if (k === "rect") { ctx.fillStyle = d[5]; ctx.fillRect(d[1], d[2], d[3], d[4]); }
    else if (k === "frame") { ctx.strokeStyle = d[5]; ctx.lineWidth = 1.5; ctx.strokeRect(d[1], d[2], d[3], d[4]); }
    else if (k === "circle") { ctx.fillStyle = d[4]; ctx.beginPath(); ctx.arc(d[1], d[2], d[3], 0, Math.PI * 2); ctx.fill(); }
    else if (k === "line") { ctx.strokeStyle = d[5]; ctx.lineWidth = d[6]; ctx.beginPath(); ctx.moveTo(d[1], d[2]); ctx.lineTo(d[3], d[4]); ctx.stroke(); }
    else if (k === "text") {
      const [, x, y, text, size, col, align] = d;
      ctx.font = `${Math.round(Math.max(size, minFont))}px K`; ctx.fillStyle = col;
      if (align === "center") { ctx.textAlign = "center"; ctx.fillText(text, x, y - size * 0.15); } else ctx.fillText(text, x, y);
    } else if (k === "sprite") {
      const im = pics.get(d[1]);
      if (im) { ctx.imageSmoothingEnabled = false; ctx.drawImage(im, d[2], d[3], d[4], d[5]); }
      else { ctx.fillStyle = "#4a5260"; rrect(d[2], d[3], d[4], d[5], 8); ctx.fill(); }
    } else if (k === "felt") {
      ctx.fillStyle = d[5]; ctx.strokeStyle = "#5a3a20"; ctx.lineWidth = 6; rrect(d[1], d[2], d[3], d[4], 40); ctx.fill(); ctx.stroke();
    } else if (k === "card") {
      const [, x, y, rank, suit, up] = d;
      ctx.lineWidth = 1; ctx.strokeStyle = "#202020";
      if (!up) {
        ctx.fillStyle = "#7a2a2a"; rrect(x, y, 34, 48, 4); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "#d8b060"; rrect(x + 3, y + 3, 28, 42, 3); ctx.stroke(); return;
      }
      ctx.fillStyle = "#f4efe2"; rrect(x, y, 34, 48, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = SUIT_COL[suit]; ctx.font = "bold 12px KB"; ctx.textBaseline = "top"; ctx.fillText(RANKS[rank] || String(rank), x + 3, y + 3);
      ctx.font = "22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(SUITS[suit], x + 17, y + 29);
    } else if (k === "chip") {
      ctx.fillStyle = chipCol(Math.max(1, d[3])); ctx.strokeStyle = "#f0f0f0"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.ellipse(d[1], d[2], 8, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    } else if (k === "die") {
      const [, x, y, size, face] = d;
      ctx.fillStyle = face !== 7 ? "#f0ead8" : "#5a4a3a"; ctx.strokeStyle = "#303030"; ctx.lineWidth = 1.2;
      rrect(x, y, size, size, size * 0.18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#202020";
      for (const [px, py] of PIPS[face] || []) { ctx.beginPath(); ctx.arc(x + px * size, y + py * size, size * 0.08, 0, Math.PI * 2); ctx.fill(); }
    } else if (k === "wheel") {
      const [, cx, cy, r, ang, ball] = d;
      const nums = (P.wheel && P.wheel.nums) || [], reds = new Set((P.wheel && P.wheel.reds) || []), n = nums.length || 1;
      nums.forEach((num, i) => {
        const a0 = ang + i * 2 * Math.PI / n;
        ctx.fillStyle = num === 0 ? "#2c7a4a" : reds.has(num) ? "#9b2b2b" : "#1d1d1d"; ctx.strokeStyle = "#c8a860"; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a0 + 2 * Math.PI / n); ctx.closePath(); ctx.fill(); ctx.stroke();
      });
      ctx.fillStyle = "#5a3a20"; ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f4f4f4"; ctx.beginPath(); ctx.arc(cx + Math.cos(ball) * r * 0.82, cy + Math.sin(ball) * r * 0.82, 4, 0, Math.PI * 2); ctx.fill();
    } else if (k === "seat") {
      const [, x, y, name, key, note] = d;
      const im = key ? pics.get(key) : null;
      if (im) { ctx.imageSmoothingEnabled = false; ctx.drawImage(im, x, y, 40, 40); }
      else { ctx.fillStyle = "#4a5260"; ctx.beginPath(); ctx.arc(x + 20, y + 20, 20, 0, Math.PI * 2); ctx.fill(); }
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = `${Math.round(Math.max(11, minFont))}px K`;
      ctx.fillStyle = "#e8e2d0"; ctx.fillText(name, x + 20, y + 43);
      ctx.fillStyle = "#b8b4a8"; ctx.fillText(note, x + 20, y + 56);
    }
  }

  init();
  return { open, get on() { return on; } };
})();

// The screen cuts to black for a while (game/brothel.py: time passes, a floorboard squeaks), then comes back.
const Blackout = (() => {
  let el = null;
  function show(b) {
    if (!el) {
      el = document.createElement("div");
      el.style.cssText = "position:fixed;inset:0;background:#000;z-index:9999;opacity:0;pointer-events:auto;" +
        "transition:opacity 0.8s ease;display:flex;align-items:flex-end;justify-content:center;";
      const t = document.createElement("div");
      t.style.cssText = "color:#bbb;font-style:italic;font-size:1.1rem;margin-bottom:18vh;opacity:0;" +
        "transition:opacity 1.2s ease;";
      el.append(t);
      document.body.append(el);
    }
    const t = el.firstChild;
    t.textContent = b.text || "";
    el.style.display = "flex";
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = "1"; }));
    const ms = Math.max(1.5, Number(b.seconds) || 4) * 1000;
    setTimeout(() => { t.style.opacity = "1"; }, ms * 0.55);
    setTimeout(() => { el.style.opacity = "0"; t.style.opacity = "0"; }, ms);
    setTimeout(() => { el.style.display = "none"; }, ms + 900);
  }
  return { show };
})();
