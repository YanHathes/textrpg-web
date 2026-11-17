// How the page talks to the game (web/bridge.py): call(name, args) -> a Promise of plain JSON.
//
// On the real site the game runs inside the browser, in a Web Worker with Pyodide (worker.js). When the page
// is served by web/devserver.py (to try it on a computer, and for the tests), the same calls go to that server,
// which answers them from normal Python. Which one is decided once, at start.
"use strict";

const RPC = (() => {
  let mode = null;            // "worker" | "server"
  let worker = null;
  let nextId = 1;
  const waiting = new Map();
  const progress = [];        // listeners for loading messages

  function onProgress(fn) { progress.push(fn); }
  function tell(text, frac) { for (const fn of progress) fn(text, frac); }

  async function start() {
    if (mode) return;
    try {
      const r = await fetch("rpc-mode.json", { cache: "no-store" });
      if (r.ok && (await r.json()).mode === "server") { mode = "server"; return; }
    } catch (e) { /* not the dev server */ }
    mode = "worker";
    worker = new Worker("worker.js?v=81df87cae1&" + location.search.slice(1));   // (?pyodide=... reaches the worker)
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.progress) { tell(m.progress, m.frac); return; }
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.result);
    };
    worker.onerror = (e) => tell("The game couldn't start: " + (e.message || e), 1);
  }

  function heard(out) {                     // the music and the effects that come with an answer (sound.js)
    if (out && (out.music || out.sfx) && typeof Sound !== "undefined") Sound.hear(out);
    if (out && out.executed && typeof GameOver !== "undefined") GameOver.show(out.executed);   // (game/jail.py)
    if (out && out.blackout && typeof Blackout !== "undefined") Blackout.show(out.blackout);   // (game/brothel.py)
    if (out && out.stale && typeof MapView !== "undefined") MapView.stale(out.stale);        // (landchanges.py)
    return out;
  }

  async function call(name, args) {
    await start();
    if (mode === "server") {
      const r = await fetch("rpc", { method: "POST", headers: { "Content-Type": "application/json" },
                                     body: JSON.stringify({ name, args: args || {} }) });
      const out = await r.json();
      if (out && out.error) throw Object.assign(new Error(out.error), { trace: out.trace });
      return heard(out);
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve: (out) => (out && out.error ? reject(Object.assign(new Error(out.error),
                                                                                   { trace: out.trace })) : resolve(heard(out))),
                        reject });
      worker.postMessage({ id, name, args: args || {} });
    });
  }

  return { call, start, onProgress, get mode() { return mode; } };
})();
