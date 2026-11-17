// The browser version's screens (stage 1; the other tabs are tabs.js, the world map worldmap.js): the main menu, then the handheld layout of the phone app, with
// the walking map above and the Walk tab's log, D-pad and six commands below. Everything the game does goes
// through RPC.call to web/bridge.py.
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let V = null;                     // the latest view from the bridge
let logSeen = -1;
let busy = false;
let menuPage = 0, menuGroup = "", menuPick = 0;

function showError(e) {
  console.error(e);
  $("#error pre").textContent = (e && (e.message + (e.trace ? "\n\n" + e.trace : ""))) || String(e);
  $("#error").hidden = false;
}
$("#error-close").onclick = () => { $("#error").hidden = true; };

async function call(name, args) {
  try { return await RPC.call(name, args); } catch (e) { showError(e); throw e; }
}

// ================================================================== the main menu
const Title = (() => {
  let art = null, dragon = [], t0 = performance.now();
  async function load() {
    const im = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    art = await im("title/background.png");
    for (let i = 0; i < 4; i++) dragon.push(await im(`title/dragon${i}.png`));
    requestAnimationFrame(paint);
  }
  function paint(now) {
    if (!$("#title").classList.contains("on")) { requestAnimationFrame(paint); return; }
    const c = $("#title-art"), g = c.getContext("2d");
    const W = c.clientWidth, H = c.clientHeight, dpr = Math.min(3, devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    if (art) {                                   // the picture, filling the screen at a whole number of pixels
      const s = Math.max(1, Math.ceil(Math.max(W / art.width, H / art.height)));
      const sw = art.width * s, sh = art.height * s, ox = (W - sw) / 2, oy = (H - sh) / 2;
      g.drawImage(art, ox, oy, sw, sh);
      const t = (now - t0) / 1000, span = art.width + 90;
      const fr = dragon[Math.floor(t * 7) % 4];
      if (fr) g.drawImage(fr, ox + ((t * 14) % span - 70) * s, oy + (24 + Math.sin(t * 0.9) * 6) * s, fr.width * s, fr.height * s);
    }
    requestAnimationFrame(paint);
  }
  return { load };
})();

async function boot() {
  Title.load();
  RPC.onProgress((text, frac) => {
    const el = $("#title-loading");
    el.hidden = frac >= 1;
    el.textContent = text + (frac < 1 ? "…" : "");
  });
  const b = await call("boot");             // (this also wakes the game, while the menu's up)
  $("#title-world").textContent = "World: " + b.world;
  $("[data-go=continue]").hidden = !b.can_continue;
}

$$("#title-menu [data-go]").forEach((btn) => btn.onclick = () => start(btn.dataset.go));

async function start(how) {
  if (busy) return;
  busy = true;
  const el = $("#title-loading");
  el.hidden = false;
  el.textContent = "Opening the world…";
  try {
    const v = await call("start", { how });
    $("#title").classList.remove("on");
    $("#game").classList.add("on");
    logSeen = -1;
    $("#log").innerHTML = "";
    showView(v, false);
    if (typeof Tabs !== "undefined") Tabs.show("walk");
    if (v.welcome) Sheets.welcome(v.welcome);                          // (creator.js)
    fitPad();
    call("sound").then((s) => Sound.setVolumes(s.volumes)).catch(() => {});   // (sound.js; the music follows)
  } finally {
    busy = false;
    el.hidden = true;
  }
}

// ================================================================== the game
MapView.init($("#map"));

function showView(v, moved) {
  V = v;
  $("#hud").textContent = v.hud.join("  ·  ");
  $("#hint").textContent = v.menu ? "" : v.placing ? `Placing ${v.placing.name}: D-pad moves it · Action turns it · Interact puts it here · Back stops` + (v.placing.why ? ` · ${v.placing.why}` : "") : v.hint;
  for (const e of v.log) {
    if (e.n <= logSeen) continue;
    logSeen = e.n;
    const p = document.createElement("p");
    p.className = e.kind;
    p.textContent = e.text;
    $("#log").appendChild(p);
  }
  while ($("#log").children.length > 30) $("#log").firstChild.remove();
  MapView.setView(v, moved);
  showMenu(v.menu);
  if (v.fighting && typeof Fight !== "undefined" && !Fight.on) Fight.enter();      // (fight.js)
  if (v.panel && typeof Panel !== "undefined" && !Panel.open) Panel.fetch();      // (panel.js)
  if (v.playing && typeof Play !== "undefined" && !Play.on) Play.open();           // (play.js)
}

async function act(name, args, moved) {
  if (busy) return null;
  busy = true;
  try {
    const v = await call(name, args || {});
    if (v && v.hud) showView(v, moved !== undefined ? moved : !!v.moved);
    return v;
  } finally { busy = false; }
}

// ---- the tabs: tabs.js

// ---- the D-pad: hold to keep walking
let held = null, walking = false;
async function walk() {
  if (walking) return;
  walking = true;
  while (held && !(V && V.menu)) {
    const t = performance.now();
    const v = await act("step", { dir: held });
    if (!v) await new Promise((r) => setTimeout(r, 60));
    const wait = 135 - (performance.now() - t);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  walking = false;
}
function hold(dir, btn) {
  held = dir;
  $$("#dpad button").forEach((b) => b.classList.toggle("held", b === btn));
  walk();
}
function letGo() { held = null; $$("#dpad button").forEach((b) => b.classList.remove("held")); }
$$("#dpad button").forEach((b) => {
  b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) { /* */ } hold(b.dataset.dir, b); });
  b.addEventListener("pointerup", letGo);
  b.addEventListener("pointercancel", letGo);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
});
const KEYS = { ArrowUp: "N", ArrowDown: "S", ArrowLeft: "W", ArrowRight: "E", w: "N", s: "S", a: "W", d: "E" };
// The keyboard (a computer), as the app's: arrows or WASD walk; E, Space or Enter interact; C check, F action,
// R rest, M the map, Esc back, + and − zoom. With a menu up: the arrows pick, Enter takes it, 1-6 pick and take.
const LETTERS = { e: "interact", " ": "interact", enter: "interact", c: "check", f: "action", r: "rest", m: "map" };
function overlay() {
  for (const id of ["#panel", "#sheetbox", "#play", "#welcome", "#fight-end", "#game-over"]) if (!$(id).hidden) return id;
  return !$("#worldmap").hidden ? "#worldmap" : "";
}
document.addEventListener("keydown", (e) => {
  if (!$("#game").classList.contains("on") || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const top = overlay();
  if (top) {                                               // a window is up: Esc closes the ones that close
    if (e.key === "Escape" && !e.repeat) {
      if (top === "#worldmap") WorldMap.close();
      else if (top === "#panel") $("#panel-x").click();
      else if (top === "#sheetbox") $("#sheetbox-close").click();
    }
    return;
  }
  if (V && V.fighting) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (V && V.menu && !e.repeat) {                          // a menu in the Walk tab
    const n = Math.min(PER, visible(V.menu).length - menuPage * PER);
    const moves = { arrowup: -2, w: -2, arrowdown: 2, s: 2, arrowleft: -1, a: -1, arrowright: 1, d: 1 };
    if (key in moves) { menuPick = Math.max(0, Math.min(n - 1, menuPick + moves[key])); showMenu(V.menu); e.preventDefault(); return; }
    if (/^[1-6]$/.test(key) && Number(key) <= n) { menuPick = Number(key) - 1; showMenu(V.menu); go(); return; }
    if (key === "enter" || key === " " || key === "e") { go(); e.preventDefault(); return; }
    if (key === "escape") { act("close", {}); return; }
    if (key === "pagedown" || key === "pageup") { $$("#choice-pager button")[key === "pageup" ? 0 : 1].click(); return; }
  }
  if (e.repeat) return;
  if (KEYS[e.key]) { hold(KEYS[e.key], null); e.preventDefault(); }
  else if (LETTERS[key]) { command(LETTERS[key]); e.preventDefault(); }
  else if (key === "escape") command("back");
  else if (key === "+" || key === "=") MapView.zoom(1);
  else if (key === "-") MapView.zoom(-1);
});
document.addEventListener("keyup", (e) => { if (KEYS[e.key] && held === KEYS[e.key]) letGo(); });

// ---- the six commands
$$("[data-cmd]").forEach((b) => b.onclick = () => command(b.dataset.cmd));
async function command(key) {
  if (key === "map") return WorldMap.open();                       // (worldmap.js)
  if (key === "back" && V && V.menu) return act("close", {});
  return act("command", { key });
}

// ---- a menu in the Walk tab: six to a page, two across
const PER = 6;
function visible(m) { return m.choices.map((c, i) => ({ ...c, i })).filter((c) => !menuGroup || c.group === menuGroup); }
function showMenu(m) {
  const open = !!m;
  $("#walk-main").hidden = open;
  $("#choices").hidden = !open;
  if (!open) { menuPage = 0; menuGroup = ""; menuPick = 0; return; }
  if (m !== showMenu.last) { menuPage = 0; menuGroup = ""; menuPick = 0; showMenu.last = m; }
  $("#choice-title").textContent = m.title;
  $("#choice-context").textContent = m.context || "";
  const groups = $("#choice-groups");
  groups.innerHTML = "";
  if (m.groups.length > 1) {
    for (const gname of ["", ...m.groups]) {
      const b = document.createElement("button");
      b.textContent = gname || "All";
      b.classList.toggle("on", gname === menuGroup);
      b.onclick = () => { menuGroup = gname; menuPage = 0; menuPick = 0; showMenu(m); };
      groups.appendChild(b);
    }
  }
  const vis = visible(m);
  const pages = Math.max(1, Math.ceil(vis.length / PER));
  menuPage = Math.min(menuPage, pages - 1);
  const shown = vis.slice(menuPage * PER, menuPage * PER + PER);
  const grid = $("#choice-grid");
  grid.innerHTML = "";
  shown.forEach((c, k) => {
    const b = document.createElement("button");
    b.disabled = !c.enabled;
    b.innerHTML = "";
    b.append(c.label);
    if (c.note) { b.append(document.createElement("br")); const sm = document.createElement("small"); sm.textContent = c.note; b.append(sm); }
    b.classList.toggle("on", k === menuPick);
    b.onclick = () => { if (k === menuPick) go(); else { menuPick = k; showMenu(m); } };   // a second tap goes
    grid.appendChild(b);
  });
  $("#choice-pager").hidden = pages <= 1;
  $("#choice-page").textContent = `${menuPage + 1} / ${pages}`;
  const cur = shown[menuPick];
  $("#choice-desc").textContent = cur ? (cur.desc || cur.label) : "";
  $("#choice-go").textContent = cur && cur.enabled ? (m.go || cur.label) : "—";
  $("#choice-go").disabled = !(cur && cur.enabled);
}
$$("#choice-pager button").forEach((b) => b.onclick = () => {
  const m = V.menu; if (!m) return;
  const pages = Math.max(1, Math.ceil(visible(m).length / PER));
  menuPage = (menuPage + parseInt(b.dataset.page, 10) + pages) % pages; menuPick = 0; showMenu(m);
});
$("#choice-back").onclick = () => act("close", {});
$("#choice-go").onclick = () => go();
function go() {
  const m = V && V.menu; if (!m) return;
  const cur = visible(m).slice(menuPage * PER, menuPage * PER + PER)[menuPick];
  if (cur && cur.enabled) act("pick", { index: cur.i });
}

// ---- zoom
$$("#zoom button").forEach((b) => b.onclick = () => MapView.zoom(parseInt(b.dataset.zoom, 10)));

// ---- settings
$("#save-game").onclick = async () => { const r = await call("save"); $("#save-note").textContent = r.saved ? "Saved." : "Couldn't save."; };
$("#to-menu").onclick = async () => { await call("save"); toMenu(); };
async function toMenu() {
  const b = await call("boot");               // (the music fades out with it: web/sound.py)
  $("[data-go=continue]").hidden = !b.can_continue;
  $("#game").classList.remove("on");
  $("#worldmap").hidden = true;
  $("#title").classList.add("on");
}

// ---- the world goes on: people wander, the hours pass
setInterval(async () => {
  if (busy || !$("#game").classList.contains("on") || held || (V && (V.menu || V.fighting || V.panel || V.playing))) return;
  busy = true;
  try {
    const r = await RPC.call("tick", {});
    if (r && r.hud) showView(r, false);
    else if (r && r.changed) MapView.refresh(true);
  } catch (e) { /* the next tick tries again */ } finally { busy = false; }
}, 1500);

// carried along a road, across country or aboard ship: a stretch every fifth of a second (web/journey.py),
// paused while anything else is going on, or the party is walking off
setInterval(async () => {
  if (busy || held || !$("#game").classList.contains("on") || !V || !V.travelling) return;
  if (V.menu || V.fighting || V.panel || V.placing || V.playing || !$("#worldmap").hidden || (typeof Sheets !== "undefined" && Sheets.open)) return;
  busy = true;
  try {
    const v = await RPC.call("journey", {});
    if (v && v.hud) showView(v, false);
  } catch (e) { /* the next stretch tries again */ } finally { busy = false; }
}, 220);

// the D-pad as big as its half allows
function fitPad() {
  const half = $("#pad-half");
  const side = Math.max(34, Math.min(84, Math.floor(Math.min(half.clientWidth, half.clientHeight) / 3)));
  document.documentElement.style.setProperty("--pad", side + "px");
}
new ResizeObserver(fitPad).observe($("#pad-half"));
document.addEventListener("visibilitychange", () => { if (document.hidden && $("#game").classList.contains("on")) RPC.call("save", {}); });

boot().catch(showError);
