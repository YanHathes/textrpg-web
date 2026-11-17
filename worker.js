// The game itself, inside the browser: Python (Pyodide) in a Web Worker, so the page never freezes while it
// thinks. The game's code (game.zip) and the ready-made world (world.zip) come with the site and are unpacked
// into memory (/app, /game); the playthrough (the party, the clock, the saves: small files) lives in the
// browser's own lasting storage (IndexedDB), under /data.
"use strict";

const PYODIDE = (self.location.search.match(/pyodide=([^&]+)/) || [])[1] ||
                "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";
let py = null;
let ready = null;
let dirty = false;

function say(text, frac) { postMessage({ progress: text, frac }); }

function syncfs(populate) {
  return new Promise((resolve) => py.FS.syncfs(populate, (err) => resolve(err)));
}

async function boot() {
  say("Waking the game", 0.05);
  importScripts(PYODIDE + "pyodide.js");
  py = await loadPyodide({ indexURL: PYODIDE });
  say("Fetching the game's tools", 0.3);
  await py.loadPackage(["sqlite3"]);
  // the player's saves: kept in this browser between visits
  py.FS.mkdirTree("/data");
  py.FS.mount(py.FS.filesystems.IDBFS, {}, "/data");
  await syncfs(true);
  say("Unpacking the game", 0.45);
  const code = await (await fetch("game.zip?v=1d6785f7b6")).arrayBuffer();
  py.unpackArchive(code, "zip", { extractDir: "/app" });
  // the world itself: in memory, from world.zip, every visit (the browser keeps the download), so its big
  // databases are never written back to storage; the playthrough comes from /data (web/bridge.py)
  say("Unpacking the world", 0.6);
  const world = await (await fetch("world.zip?v=92684dfd15")).arrayBuffer();
  py.FS.mkdirTree("/game/worlds");
  py.unpackArchive(world, "zip", { extractDir: "/game/worlds" });
  say("Starting", 0.9);
  py.runPython(`
import sys
sys.path.insert(0, "/app")
import web.bridge as _bridge
`);
  say("Ready", 1);
}

setInterval(async () => {                 // what the game kept reaches the browser's storage
  if (dirty && py) { dirty = false; await syncfs(false); }
}, 1500);

onmessage = async (ev) => {
  const { id, name, args } = ev.data;
  try {
    if (!ready) ready = boot();
    await ready;
    const call = py.globals.get("_bridge").call;
    const out = JSON.parse(call(name, JSON.stringify(args || {}), "/game", "/data"));
    if (out && out.kept) dirty = true;      // (only the small playthrough files: web/bridge.py)
    if (name === "save" && dirty) { dirty = false; await syncfs(false); }
    postMessage({ id, result: out });
  } catch (e) {
    postMessage({ id, error: String(e && e.message || e) });
  }
};
