// Fights (stage 3): the battle field over the map half, and the phone app's four tabs below (Action, Move,
// Bonus, End turn). The rules are the game's own (web/fight.py); this draws the field, animates what moved,
// floats the numbers, and paces the enemies' turns so they can be followed.
"use strict";

const Fight = (() => {
  const T = 32, PER = 6;
  let F = null;                              // the latest fight state
  let on = false, pics = null;
  const sprites = new Map();                 // "id@facing" -> Image (null while it comes)
  let anim = {};                             // id -> [x, y] while moving
  let floats = [];                           // {id, text, colour, age}
  let canvas, ctx, W = 0, H = 0, dpr = 1, s = 1, ox = 0, oy = 0, zoom = 1, panX = 0, panY = 0;
  let menuPage = 0, menuPick = 0, menuKey = "";
  let thinking = false, phase = 0;

  const img = (b64) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = "data:image/png;base64," + b64; });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function init() {
    canvas = $("#fight-canvas"); ctx = canvas.getContext("2d");
    new ResizeObserver(() => { size(); draw(); }).observe($("#top"));
    let down = null, moved = 0, pinch = null;
    const pts = new Map();
    canvas.addEventListener("pointerdown", (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* */ }
      pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pts.size === 1) { down = [e.offsetX, e.offsetY]; moved = 0; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom }; }
    });
    canvas.addEventListener("pointermove", (e) => {
      const was = pts.get(e.pointerId); if (!was) return;
      pts.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        zoom = Math.max(1, Math.min(4, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, pinch.d)));
        moved = 99; size(); draw();
      } else if (pts.size === 1 && zoom > 1) {
        panX += e.offsetX - was[0]; panY += e.offsetY - was[1];
        moved += Math.abs(e.offsetX - was[0]) + Math.abs(e.offsetY - was[1]); size(); draw();
      } else moved += Math.abs(e.offsetX - was[0]) + Math.abs(e.offsetY - was[1]);
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && down && moved < 10) tap(down[0], down[1]);
      if (pts.size === 0) down = null;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(1, Math.min(4, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); size(); draw(); }, { passive: false });
    $("#fight-menu-back").onclick = () => send("fight_back");
    $("#fight-menu-go").onclick = go;
    $("#fight-info-back").onclick = () => send("fight_back");
    $("#fight-info-go").onclick = () => send(F && F.info && F.info.go === "End turn" ? "fight_end" : "fight_back", { sure: true });
    $$("#fight-pager button").forEach((b) => b.onclick = () => {
      const n = (F && F.menu) ? F.menu.choices.length : 0, pages = Math.max(1, Math.ceil(n / PER));
      menuPage = (menuPage + parseInt(b.dataset.page, 10) + pages) % pages; menuPick = 0; pad();
    });
    $("#fight-end-go").onclick = () => done(false);
    $("#fight-end-skin").onclick = () => done(true);
    requestAnimationFrame(loop);
  }

  // ---- in and out
  async function enter() {
    if (on) return;
    on = true; thinking = false; pics = null; sprites.clear(); anim = {}; floats = []; zoom = 1; panX = panY = 0;
    $("#map").hidden = true; $("#hint").hidden = true; $("#zoom").hidden = true; $("#hud").hidden = true;
    canvas.hidden = false;
    $("#fightpad").hidden = false; $("#tabs").hidden = true; $("#pages").hidden = true;
    size();
    const r = await RPC.call("screen", { w: Math.round(W), h: Math.round(H) });
    void r;
    const p = await call("fight_pics", {});
    pics = { bg: await img(p.bg), tall: await img(p.tall), grey: await img(p.grey) };
    const st = await call("fight", {});
    await show(st);
  }

  function leave() {
    on = false; F = null;
    canvas.hidden = true; $("#fight-tip").hidden = true;
    $("#map").hidden = false; $("#hint").hidden = false; $("#zoom").hidden = false; $("#hud").hidden = false;
    $("#fightpad").hidden = true; $("#tabs").hidden = false; $("#pages").hidden = false;
    $("#fight-end").hidden = true;
    MapView.refresh(true);
  }

  function size() {
    const r = $("#top").getBoundingClientRect();
    dpr = Math.min(3, devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    if (!F) return;
    const fit = Math.min(W / (F.w * T), H / (F.h * T));
    s = fit * zoom;
    const mw = F.w * T * s, mh = F.h * T * s;
    panX = mw <= W ? 0 : Math.max(W - mw - (W - mw) / 2, Math.min(-(W - mw) / 2, panX));
    panY = mh <= H ? 0 : Math.max(H - mh - (H - mh) / 2, Math.min(-(H - mh) / 2, panY));
    ox = (W - mw) / 2 + panX; oy = (H - mh) / 2 + panY;
  }

  // ---- a state from the game
  async function show(r) {
    if (!r) return;
    if (r.view) showView(r.view, false);
    const f = r.fight;
    if (!f) { leave(); return; }
    const first = !F;
    const was = F;
    F = f;
    if (first) size();
    if (was && f.field !== was.field) {               // the field changed: a wall down, a tree, a fire
      const p = await call("fight_pics", {});
      pics = { bg: await img(p.bg), tall: await img(p.tall), grey: await img(p.grey) };
    }
    await needSprites();
    for (const x of f.floats || []) floats.push({ ...x, age: 0 });
    if (f.tip) { $("#fight-tip").textContent = f.tip; $("#fight-tip").hidden = false; setTimeout(() => { $("#fight-tip").hidden = true; }, 2400); }
    if (f.moves && Object.keys(f.moves).length && was) await animate(was, f.moves);
    if (menuKey !== key(f)) { menuKey = key(f); menuPage = 0; menuPick = 0; }
    pad();
    draw();
    if (f.end) { ending(f.end); return; }
    if (f.ai && !thinking) think(f.step);
  }
  const key = (f) => f.menu ? f.menu.title + "|" + f.menu.choices.length + "|" + f.current : "";

  async function needSprites() {
    const want = F.units.filter((u) => u.sprite && !sprites.has(`${u.id}@${u.facing}`)).map((u) => [u.id, u.facing]);
    if (!want.length) return;
    for (const [id, fc] of want) sprites.set(`${id}@${fc}`, null);
    const got = await call("fight_sprites", { keys: want });
    await Promise.all(Object.entries(got).map(async ([k, b]) => { if (b) sprites.set(k, await img(b)); }));
  }

  function animate(was, moves) {                // each mover along its squares, about 100 ms a square
    const start = {};
    for (const u of was.units) start[u.id] = [u.x, u.y];
    const jobs = Object.entries(moves).map(([id, cells]) => [id, [start[id] || cells[0], ...cells]]);
    const total = Math.max(...jobs.map(([, p]) => p.length - 1)) * 4;
    return new Promise((done) => {
      let fr = 0;
      const tick = () => {
        fr += 1;
        for (const [id, path] of jobs) {
          const seg = Math.min(path.length - 2, Math.floor((fr - 1) / 4)), t = Math.min(1, (((fr - 1) % 4) + 1) / 4);
          if (seg < 0 || fr >= (path.length - 1) * 4) { delete anim[id]; continue; }
          const [a, b] = [path[seg], path[seg + 1]];
          anim[id] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        draw();
        if (fr >= total) { anim = {}; done(); } else setTimeout(tick, 26);
      };
      tick();
    });
  }

  async function think(step) {                    // the computer's turns, one step at a time
    thinking = true;
    try {
      await wait(step === "attack" || step === "cast" ? 450 : step ? 160 : 450);
      while (on && F && F.ai && !F.end) {
        const r = await call("fight_ai", {});
        thinking = true;
        await show(r);
        const st = r.fight && r.fight.step;
        await wait(st === "attack" || st === "cast" ? 450 : st === "end" ? 300 : 140);
      }
    } finally { thinking = false; }
  }

  async function send(name, args) {
    if (!on || thinking) return;
    const r = await call(name, args || {});
    await show(r);
  }

  function tap(px, py) {
    if (!F || F.end) return;
    const x = Math.floor((px - ox) / (T * s)), y = Math.floor((py - oy) / (T * s));
    if (x < 0 || y < 0 || x >= F.w || y >= F.h) return;
    send("fight_cell", { x, y });
  }

  // ---- the four tabs and what's under them
  function pad() {
    const tabs = $("#fight-tabs"); tabs.innerHTML = "";
    const list = F.tabs.length ? F.tabs : [{ id: "action", label: "Action" }, { id: "move", label: "Move" }, { id: "bonus", label: "Bonus" }, { id: "end", label: "End turn" }];
    for (const t of list) {
      const b = document.createElement("button");
      b.append(t.label); if (t.sub) { const sm = document.createElement("small"); sm.textContent = t.sub; b.append(sm); }
      b.disabled = !t.enabled; b.classList.toggle("on", !!t.on);
      b.onclick = () => send("fight_tab", { key: t.id });
      tabs.append(b);
    }
    const st = $("#fight-status"); st.innerHTML = "";              // who, what they have left, the last thing said
    const head = document.createElement("b"); head.textContent = F.status || `Round ${F.round}`; st.append(head);
    for (const line of [F.hint || F.budget, (F.said || []).slice(-1)[0]]) {
      if (!line) continue;
      const d = document.createElement("div"); d.textContent = line; d.title = line; st.append(d);
    }
    const menu = F.menu, info = F.info || (F.end ? { title: F.end.title, text: "" } : null);
    $("#fight-menu").hidden = !menu; $("#fight-info").hidden = !!menu;
    if (!menu) {
      $("#fight-info-title").textContent = info ? info.title : "";
      $("#fight-info-text").textContent = info ? info.text : "";
      $("#fight-info-back").textContent = (info && info.back) || "Back"; $("#fight-info-back").hidden = !(info && info.back);
      $("#fight-info-go").textContent = (info && info.go) || ""; $("#fight-info-go").hidden = !(info && info.go);
      return;
    }
    $("#fight-menu-title").textContent = menu.title;
    const pages = Math.max(1, Math.ceil(menu.choices.length / PER));
    menuPage = Math.min(menuPage, pages - 1);
    const shown = menu.choices.map((c, i) => ({ ...c, i })).slice(menuPage * PER, menuPage * PER + PER);
    const grid = $("#fight-grid"); grid.innerHTML = "";
    shown.forEach((c, k) => {
      const b = document.createElement("button");
      b.disabled = !c.enabled; b.append(c.label);
      if (c.note) { b.append(document.createElement("br")); const sm = document.createElement("small"); sm.textContent = c.note; b.append(sm); }
      b.classList.toggle("on", k === menuPick);
      b.onclick = () => { if (k === menuPick) go(); else { menuPick = k; pad(); } };
      grid.append(b);
    });
    $("#fight-pager").hidden = pages <= 1; $("#fight-page").textContent = `${menuPage + 1} / ${pages}`;
    const cur = shown[menuPick];
    $("#fight-desc").textContent = cur ? (cur.desc || cur.label) : "";
    $("#fight-menu-go").textContent = cur && cur.enabled ? cur.label : "—"; $("#fight-menu-go").disabled = !(cur && cur.enabled);
    $("#fight-menu-back").hidden = !menu.back;
  }

  function go() {
    if (!F || !F.menu) return;
    const c = F.menu.choices.map((x, i) => ({ ...x, i })).slice(menuPage * PER, menuPage * PER + PER)[menuPick];
    if (c && c.enabled) { menuKey = ""; send("fight_pick", { index: c.i }); }
  }

  // ---- the end
  function ending(e) {
    const box = $("#fight-end-body"); box.innerHTML = "";
    $("#fight-end-title").textContent = e.title;
    for (const l of e.lines) { const p = document.createElement("p"); p.textContent = l; box.append(p); }
    if (e.gains.length) {
      const p = document.createElement("p"); p.textContent = "You gain:"; box.append(p);
      for (const g of e.gains) { const d = document.createElement("div"); d.className = "gold"; d.textContent = "•  " + g; box.append(d); }
    }
    if (e.fallen) { const p = document.createElement("p"); p.className = "fallen"; p.textContent = e.fallen; box.append(p); }
    $("#fight-end-skin").hidden = !e.skin;
    $("#fight-end-skin").textContent = `Skin the ${e.skin === 1 ? "beast" : "beasts"} (${e.skin})`;
    setTimeout(() => { $("#fight-end").hidden = false; }, 600);
  }

  async function done(skin) {
    $("#fight-end").hidden = true;
    const v = await call("fight_done", { skin });
    leave();
    showView(v, false);
    if (v.game_over) GameOver.show(v.game_over);
    else if (v.fighting) enter();             // (another fight straight after: a raid's next wave)
  }

  // ---- drawing
  function loop(t) {
    if (on && F) {
      const was = floats.length;
      floats.forEach((f) => { f.age += 1 / 60; });
      floats = floats.filter((f) => f.age < 1.1);
      phase = t / 1000;
      if (was || (F.dark && F.dark.lights.length)) draw();
    }
    requestAnimationFrame(loop);
  }

  let pending = false;
  function draw() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; paint(); }); } }

  const cell = (x, y, w = 1, h = 1) => [ox + x * T * s, oy + y * T * s, w * T * s, h * T * s];
  const pos = (u) => anim[u.id] || [u.x, u.y];

  function paint() {
    if (!on || !F || !pics) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0b0f0b"; ctx.fillRect(0, 0, W, H);
    const mw = F.w * T * s, mh = F.h * T * s, cs = T * s;
    if (pics.bg) ctx.drawImage(pics.bg, ox, oy, mw, mh);
    const dark = F.dark;
    if (dark && pics.grey) {
      for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
        const ch = dark.rows[y][x];
        if (ch === "g" || ch === "G") ctx.drawImage(pics.grey, x * T, y * T, T, T, ...cell(x, y));
      }
    }
    ctx.fillStyle = "rgba(120,200,110,0.22)";
    for (const [x, y] of F.reach || []) ctx.fillRect(...cell(x, y).map((v, i) => i < 2 ? v + 1 : v - 2));
    if (F.things && F.things.length) {                 // walls, trees and things that can be broken
      ctx.strokeStyle = "rgba(240,150,60,0.85)"; ctx.lineWidth = 2;
      for (const [x, y] of F.things) { const r = cell(x, y); ctx.strokeRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4); }
    }
    if (F.area) {
      ctx.fillStyle = F.area.ok ? "rgba(240,190,60,0.32)" : "rgba(220,70,50,0.32)";
      for (const [x, y] of F.area.cells) ctx.fillRect(...cell(x, y));
    }
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= F.w; x++) { ctx.moveTo(ox + x * cs, oy); ctx.lineTo(ox + x * cs, oy + mh); }
    for (let y = 0; y <= F.h; y++) { ctx.moveTo(ox, oy + y * cs); ctx.lineTo(ox + mw, oy + y * cs); }
    ctx.stroke();
    if (dark) {
      if (pics.tall) ctx.drawImage(pics.tall, ox, oy, mw, mh);
      for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
        const ch = dark.rows[y][x];
        if (ch === "0") { ctx.fillStyle = "rgba(2,3,8,0.89)"; ctx.fillRect(...cell(x, y)); }
        else if (ch === "1" || ch === "g") { ctx.fillStyle = ch === "g" ? "rgba(4,6,14,0.24)" : "rgba(4,6,14,0.36)"; ctx.fillRect(...cell(x, y)); }
      }
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      dark.lights.forEach((src, i) => {
        let cx = src.x, cy = src.y;
        const owner = src.owner && F.units.find((u) => u.id === src.owner);
        if (owner) { const [px, py] = pos(owner); cx = px + owner.size / 2; cy = py + owner.size / 2; }
        const wob = Math.sin(phase * 9 + i * 1.7) * 0.5 + Math.sin(phase * 17 + i) * 0.3;
        const r = (src.bright + 0.5) * cs * (0.95 + 0.05 * wob), X = ox + cx * cs, Y = oy + cy * cs;
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, r);
        g.addColorStop(0, hexA(src.colour, (54 + 14 * wob) / 255)); g.addColorStop(1, hexA(src.colour, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }
    const units = [...F.units].sort((a, b) => (pos(a)[1] + a.size) - (pos(b)[1] + b.size) || (a.alive - b.alive));
    for (const u of units) {
      if (u.hidden) continue;
      const [x, y] = pos(u), [rx, ry, rw, rh] = cell(x, y, u.size, u.size);
      if (u.current && u.alive) {
        ctx.strokeStyle = u.team === "enemy" ? "#d04838" : "#e8b048"; ctx.lineWidth = Math.max(2, s * 2);
        ctx.beginPath(); ctx.ellipse(rx + rw / 2, ry + rh * 0.86, rw * 0.42, rh * 0.16, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if ((F.targets || []).includes(u.id)) {
        ctx.strokeStyle = "#e04030"; ctx.lineWidth = Math.max(2, s * 2); ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4); ctx.setLineDash([]);
      }
      const im = sprites.get(`${u.id}@${u.facing}`);
      ctx.globalAlpha = u.alive ? 1 : 0.35;
      if (im) {
        const iw = im.width * s, ih = im.height * s;
        ctx.drawImage(im, rx + (rw - iw) / 2, ry + rh - ih, iw, ih);
      } else {
        ctx.fillStyle = u.team === "enemy" ? "#a03028" : "#3a6a9a";
        ctx.beginPath(); ctx.arc(rx + rw / 2, ry + rh / 2, rw * 0.35, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (u.alive) {                                   // the health bar
        const bw = rw * 0.7, bh = Math.max(3, cs * 0.07), bx = rx + (rw - bw) / 2, by = ry + 1;
        ctx.fillStyle = "rgba(0,0,0,0.67)"; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        const frac = Math.max(0, u.hp / Math.max(1, u.max));
        ctx.fillStyle = u.team === "enemy" ? (frac < 0.35 ? "#7a2018" : "#c03828") : (frac < 0.35 ? "#d89a28" : "#58b048");
        ctx.fillRect(bx, by, bw * frac, bh);
      }
    }
    if (!dark && pics.tall) { ctx.globalAlpha = 0.86; ctx.drawImage(pics.tall, ox, oy, mw, mh); ctx.globalAlpha = 1; }
    ctx.font = `bold ${Math.max(12, Math.round(cs * 0.36))}px KB`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const fl of floats) {
      const u = F.units.find((x) => x.id === fl.id); if (!u) continue;
      const [x, y] = pos(u);
      const X = ox + (x + u.size / 2) * cs, Y = oy + (y + 0.1 - fl.age * 0.9) * cs, a = Math.max(0, Math.min(1, 1.1 - fl.age));
      ctx.globalAlpha = a; ctx.fillStyle = "#000"; ctx.fillText(fl.text, X + 2, Y + 2);
      ctx.fillStyle = fl.colour; ctx.fillText(fl.text, X, Y); ctx.globalAlpha = 1;
    }
  }

  function hexA(hex, a) {
    const h = (hex || "#ffb050").replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  init();
  // (where a square is on the screen: for tests, and anything else that wants to point at one)
  const where = (x, y) => [ox + (x + 0.5) * T * s, oy + (y + 0.5) * T * s];
  return { enter, leave, where, get on() { return on; }, get state() { return F; } };
})();

// The party falling for good (a world that doesn't wake you up in town): load a save, or a new party.
const GameOver = (() => {
  async function show(g) {
    $("#game-over-text").textContent = g.text;
    const list = $("#game-over-saves"); list.innerHTML = "";
    if (g.can_load) {
      const S = await call("saves", {});
      for (const sv of S.saves) {
        const b = document.createElement("button"); b.className = "rowbtn";
        b.append(Object.assign(document.createElement("span"), { textContent: sv.auto ? "Autosave" : sv.name }),
                 Object.assign(document.createElement("small"), { textContent: [sv.clock, sv.where].filter(Boolean).join("  ·  ") }));
        b.onclick = async () => { $("#game-over").hidden = true; const v = await call("game_over", { choice: "load", slot: sv.slot }); showView(v, false); MapView.refresh(true); };
        list.append(b);
      }
    }
    $("#game-over").hidden = false;
  }
  $("#game-over-new").onclick = async () => {
    $("#game-over").hidden = true;
    await call("game_over", { choice: "new" });
    toMenu();
  };
  return { show };
})();
