// Sound and music (stage 4): plays what the game decides (web/sound.py, game/soundscape.py), as the app's
// ui/audio.py does: music by mood, cross-faded over 2.5 s when it changes; ambience loops under it (rain, wind,
// a crowd, a tavern...); one-off effects. Web Audio, with a volume for each and a master (Settings).
//
// Phones only let a page make sound after a tap, so nothing plays before the first one. The files are fetched
// when first needed (sounds/index.json lists them) and kept. MP3s start and end with a little silence, which
// would be a gap every time a loop goes round, so each loop is played between its true start and end.
"use strict";

const Sound = (() => {
  const FADE = 2.5;                  // seconds (game/soundscape.py FADE_SECONDS)
  const MP3_DELAY = 1105;            // samples of silence the MP3 encoder puts first (LAME: 576 + 529)
  let ctx = null;
  let index = null;
  let indexWait = null;
  let master = null;
  const bus = {};                    // music, ambience, effects: GainNodes into master
  const buffers = new Map();         // file -> Promise<AudioBuffer|null>
  let vols = { sound_on: true, volume_master: 80, volume_music: 70, volume_effects: 70, volume_ambience: 70 };
  let wanted = null;                 // the last {mood, salt, loops} the game sent
  const music = [null, null];        // {file, src, gain}
  let cur = 0;
  const loops = new Map();           // name -> {src, gain, level}
  let fxPlaying = 0;

  // ---------------------------------------------------------------- starting (after the first tap)
  function unlock() {
    if (ctx) { if (ctx.state === "suspended" && !document.hidden) ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";   // (iPhone: plays with the
    } catch (_) { /* */ }                                                     //  silent switch on, like a game)
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    for (const k of ["music", "ambience", "effects"]) { bus[k] = ctx.createGain(); bus[k].connect(master); }
    applyVolumes();
    if (ctx.state === "suspended") ctx.resume();
    if (wanted) hear({ music: wanted });
  }
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlock, { capture: true });
  document.addEventListener("visibilitychange", () => {      // quiet while the page is out of sight
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  function loadIndex() {
    if (!indexWait) {
      indexWait = fetch("sounds/index.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((x) => { index = x; return x; });
    }
    return indexWait;
  }

  function buffer(file) {
    if (!buffers.has(file)) {
      buffers.set(file, fetch(`sounds/${file}.${index.ext}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad)))
        .catch(() => null));
    }
    return buffers.get(file);
  }

  // ---------------------------------------------------------------- volumes
  function level(kind) {
    if (!vols.sound_on) return 0;
    return (Number(vols["volume_" + kind]) || 0) / 100;
  }
  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(vols.sound_on ? (Number(vols.volume_master) || 0) / 100 : 0, t, 0.05);
    for (const k of ["music", "ambience", "effects"]) bus[k].gain.setTargetAtTime(level(k), t, 0.05);
  }
  function setVolumes(v) { Object.assign(vols, v || {}); applyVolumes(); }

  // ---------------------------------------------------------------- which file
  function crc32(str) {                       // (as Python's zlib.crc32, so the same track as the app)
    let c, crc = 0xFFFFFFFF;
    const bytes = new TextEncoder().encode(str);
    for (const b of bytes) {
      c = (crc ^ b) & 0xFF;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function trackFor(mood, salt) {             // game/soundscape.py track_for
    const seen = new Set();
    let m = mood;
    while (m && !seen.has(m)) {
      seen.add(m);
      const got = (index.music || {})[m];
      if (got && got.length) return `music/${m}/${got[crc32(`${m}|${salt}`) % got.length]}`;
      m = (index.fallback || {})[m] || "";
    }
    return "";
  }

  function looped(src, buf, file) {           // play between the file's true start and end
    src.buffer = buf;
    src.loop = true;
    const real = (index.secs || {})[file];
    if (real && buf.duration - real > 0.01) {
      src.loopStart = Math.min(buf.duration - real, MP3_DELAY / buf.sampleRate);
      src.loopEnd = Math.min(buf.duration, src.loopStart + real);
      return src.loopStart;
    }
    return 0;
  }

  function fade(gain, to) {
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(to, t + FADE * Math.abs(to - gain.gain.value) + 0.01);
  }

  function stopLater(node, gain) {
    setTimeout(() => { try { node.stop(); } catch (_) { /* */ } gain.disconnect(); }, (FADE + 0.3) * 1000);
  }

  // ---------------------------------------------------------------- music and loops
  async function setMusic(file) {
    const now = music[cur];
    if ((now ? now.file : "") === file) { if (now) fade(now.gain, 1); return; }
    if (now) { fade(now.gain, 0); stopLater(now.src, now.gain); music[cur] = null; }
    cur = 1 - cur;
    if (!file) return;
    const slot = cur;
    const entry = { file, src: null, gain: ctx.createGain() };
    entry.gain.gain.value = 0;
    entry.gain.connect(bus.music);
    music[slot] = entry;
    const buf = await buffer(file);
    if (!buf || music[slot] !== entry) return;      // (changed again while it loaded)
    entry.src = ctx.createBufferSource();
    const from = looped(entry.src, buf, file);
    entry.src.connect(entry.gain);
    entry.src.start(0, from);
    fade(entry.gain, 1);
  }

  async function setLoops(want) {
    for (const [name, l] of loops) {
      if (!(name in want)) { fade(l.gain, 0); if (l.src) stopLater(l.src, l.gain); loops.delete(name); }
    }
    for (const [name, lv] of Object.entries(want)) {
      const l = loops.get(name);
      if (l) { if (l.level !== lv) { l.level = lv; fade(l.gain, lv); } continue; }
      const file = "ambience/" + name;
      if (!(file in (index.secs || {}))) continue;
      const entry = { src: null, gain: ctx.createGain(), level: lv };
      entry.gain.gain.value = 0;
      entry.gain.connect(bus.ambience);
      loops.set(name, entry);
      const buf = await buffer(file);
      if (!buf || loops.get(name) !== entry) continue;
      entry.src = ctx.createBufferSource();
      const from = looped(entry.src, buf, file);
      entry.src.connect(entry.gain);
      entry.src.start(0, from);
      fade(entry.gain, entry.level);
    }
  }

  async function effect(name, volume) {
    if (!ctx || !vols.sound_on || level("effects") <= 0 || fxPlaying >= 6) return;
    const file = "effects/" + name;
    if (!(file in (index.secs || {}))) return;
    const buf = await buffer(file);
    if (!buf) return;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.buffer = buf;
    src.connect(g); g.connect(bus.effects);
    fxPlaying++;
    src.onended = () => { fxPlaying--; g.disconnect(); };
    src.start();
  }

  // ---------------------------------------------------------------- what the game sends (rpc.js)
  async function hear(out) {
    if (out.music) wanted = out.music;
    if (!ctx) return;                                   // (before the first tap: kept for then)
    if (!(await loadIndex())) return;
    if (out.music) {
      const m = out.music;
      setMusic(m.mood ? trackFor(m.mood, m.salt || "") : "");
      setLoops(m.loops || {});
    }
    for (const [name, vol] of out.sfx || []) effect(name, vol);
  }

  return { hear, setVolumes, unlock, get volumes() { return { ...vols }; },
           get playing() { return { music: music.map((m) => m && m.file), loops: [...loops.keys()], ctx: ctx && ctx.state }; } };
})();
