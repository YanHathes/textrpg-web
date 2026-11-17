// The other tabs (stage 2): Bag, Party, Quests, Map and Settings, in the handheld look. Each is filled from its
// call to web/tabs.py when it's opened; anything done there gives back the view too, so the status line and
// the log keep up.
"use strict";

const Tabs = (() => {
  let current = "walk";
  let bagWho = "", bagPick = null;           // bagPick: {list: "carried" | "pack", id}
  let partyWho = "";
  let spellsOpen = false;
  let questTab = "active", questOpen = "", J = null;
  let abandonArmed = "";
  const faces = new Map();                    // sprite key -> data URL

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (text, cls, fn) => { const b = el("button", cls, text); b.onclick = fn; return b; };
  const rowBtn = (left, right, fn, on, disabled) => {
    const b = el("button", "rowbtn" + (on ? " on" : ""));
    b.append(el("span", "", left));
    if (right) b.append(el("small", "", right));
    b.disabled = !!disabled;
    b.onclick = fn;
    return b;
  };

  async function run(name, args) {
    if (busy) await new Promise((r) => setTimeout(r, 120));
    busy = true;
    try {
      const r = await call(name, args || {});
      if (r && r.view) showView(r.view, false);
      return r;
    } finally { busy = false; }
  }

  function show(tab) {
    current = tab;
    $$("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === tab));
    $$(".page").forEach((p) => p.classList.toggle("on", p.id === "page-" + tab));
    refresh();
  }

  function refresh() {
    if (!$("#game").classList.contains("on")) return;
    ({ bag: bag, party: party, quests: quests, map: place, settings: settings }[current] || (() => {}))();
  }

  // ================================================================ Bag
  async function bag(r) {
    const B = r || await call("bag", { member: bagWho });
    bagWho = B.who;
    $("#bag-money").textContent = B.money;
    const who = $("#bag-who"); who.innerHTML = "";
    for (const m of B.members) who.append(btn(m.name, m.id === B.who ? "on" : "", () => { bagWho = m.id; bagPick = null; bag(); }));
    $("#bag-name").textContent = B.name || "";
    const fill = (box, rows, list, empty) => {
      box.innerHTML = "";
      if (!rows.length) box.append(el("div", "empty", empty));
      for (const it of rows) {
        const tags = [];
        if (it.worn && it.worn.length) tags.push("worn: " + it.worn.join(", ").toLowerCase());
        if (it.attune) tags.push(it.attune);
        const on = bagPick && bagPick.list === list && bagPick.id === it.id;
        box.append(rowBtn(`${it.name}${it.n > 1 ? "  ×" + it.n : ""}`, tags.join("; "), () => {
          bagPick = on ? null : { list, id: it.id }; bag(B);
        }, on));
      }
    };
    fill($("#bag-carried"), B.carried, "carried", `${B.name || "They"} carries nothing.`);
    fill($("#bag-pack"), B.pack, "pack", "Nothing in the pack yet.");
    const doC = $("#bag-carried-do"), doP = $("#bag-pack-do");
    doC.innerHTML = ""; doP.innerHTML = "";
    const act = (what, extra) => async () => {
      const out = await run("bag_do", { member: B.who, what, item: bagPick ? bagPick.id : "", ...(extra || {}) });
      $("#bag-message").textContent = out.message || "";
      if (out.bag && !out.bag.carried.concat(out.bag.pack).some((x) => bagPick && x.id === bagPick.id)) bagPick = null;
      if (out.bag) bag(out.bag);
    };
    const picked = bagPick && (bagPick.list === "carried" ? B.carried : B.pack).find((x) => x.id === bagPick.id);
    if (picked && bagPick.list === "carried") {
      if (picked.desc) doC.append(el("div", "desc", picked.desc));
      if (picked.can_wear) doC.append(picked.worn.length ? btn("Take off", "cmd", act("unequip")) : btn("Equip", "cmd accent", act("equip")));
      if (picked.attune) doC.append(btn(picked.attune === "attuned" ? "Unattune" : "Attune", "cmd", act("attune")));
      if (!picked.can_wear) doC.append(btn("Use", "cmd accent", act("use")));
      if (!picked.worn.length) doC.append(btn("To pack", "cmd", act("to_pack")));
      for (const m of B.members) if (m.id !== B.who && !m.dead) doC.append(btn(`Give to ${m.name}`, "cmd", act("give", { to: m.id })));
    } else if (picked) {
      if (picked.desc) doP.append(el("div", "desc", picked.desc));
      doP.append(btn("Take", "cmd accent", act("take")));
      if (picked.n > 1) doP.append(btn("Take all", "cmd", act("take_all")));
      doP.append(btn("Use", "cmd", act("use_pack")));
    }
    if (B.mount) {
      const b = btn(B.mount.label, "cmd" + (B.mount.what === "mount" ? " accent" : ""), async () => {
        bagPick = null; const out = await run("bag_do", { member: B.who, what: B.mount.what });
        $("#bag-message").textContent = out.message || ""; MapView.refresh(true); bag(out.bag);
      });
      b.disabled = !B.mount.enabled; b.title = B.mount.tip;
      doP.append(b);
    }
    $("#bag-notes").textContent = [B.wearing && B.wearing.length ? "Wearing: " + B.wearing.join("   ") : "", B.attuned ? "Attuned: " + B.attuned : "", B.notes || ""].filter(Boolean).join("  ·  ");
  }

  // ================================================================ Party
  async function faceURLs(keys) {
    const want = keys.filter((k) => k && !faces.has(k));
    if (!want.length) return;
    const got = await call("sprites", { keys: want.map((k) => [k, 0, 0]) });
    for (const [k, b64] of Object.entries(got)) faces.set(k.split("@")[0], b64 ? "data:image/png;base64," + b64 : "");
  }

  async function party() {
    const P = await call("party", { member: partyWho });
    partyWho = P.who;
    await faceURLs(P.members.map((m) => m.face));
    const row = $("#party-who"); row.innerHTML = "";
    for (const m of P.members) {
      const b = el("button", (m.id === P.who ? "on" : "") + (m.dead ? " dead" : ""));
      const src = faces.get(m.face);
      if (src) { const i = new Image(); i.src = src; b.append(i); }
      b.append(el("span", "", m.name));
      if (m.level_up) b.append(el("span", "lvl", "▲"));
      b.onclick = () => { partyWho = m.id; party(); };
      row.append(b);
    }
    const S = P.sheet, box = $("#sheet");
    box.innerHTML = "";
    if (!S) { box.append(el("p", "later", "No one in the party yet."), btn("+ New character", "cmd wide accent", () => Sheets.creator())); return; }
    box.append(el("h2", "", S.name));
    const tags = el("div", "tags"); for (const t of S.tags) tags.append(el("span", "", t)); box.append(tags);
    box.append(el("div", "small", P.xp));
    if (P.dead) box.append(el("div", "callout", "Dead. A temple can raise them."));
    const acts = el("div", "partyacts");                     // (creator.js)
    if (P.level_up) acts.append(btn("Level up!", "cmd accent", () => Sheets.levelup(P.who)));
    if (P.has_choices) acts.append(btn(P.pending_choices ? `Choices (${P.pending_choices})` : "Choices", "cmd" + (P.pending_choices ? " accent" : ""), () => Sheets.choices(P.who)));
    acts.append(btn("Look", "cmd", () => Sheets.look(P.who)));
    if (P.casts) acts.append(btn(spellsOpen ? "Hide spells" : "Spells", "cmd", () => { spellsOpen = !spellsOpen; party(); }));
    if (P.can_add) acts.append(btn("+ New character", "cmd", () => Sheets.creator()));
    box.append(acts);
    if (spellsOpen && P.casts) await spells(box, P.who);
    for (const r of S.resources) {
      const b = el("div", "bar");
      const lab = el("div", "lab"); lab.append(el("span", "", r.label), el("span", "", `${r.current} / ${r.max}`));
      const tr = el("div", "track"), f = el("div", "fill " + (r.color || "info"));
      f.style.width = Math.max(0, Math.min(100, 100 * r.current / Math.max(1, r.max))) + "%";
      tr.append(f); b.append(lab, tr); box.append(b);
    }
    const bd = el("div", "badges");
    for (const x of S.badges) { const d = el("div"); d.append(el("b", "", x.value), el("small", "", x.label)); bd.append(d); }
    box.append(bd);
    for (const g of S.stat_groups) {
      const st = el("div", "stats"); st.style.gridTemplateColumns = `repeat(${g.columns || 3}, 1fr)`;
      for (const x of g.stats) { const d = el("div"); d.append(el("small", "", x.label), el("b", "", x.main), el("i", "", x.sub)); st.append(d); }
      box.append(st);
    }
    const section = (title, rows, foot, profs) => {
      const sec = el("div", "section"); sec.append(el("div", "sub", title));
      const rs = el("div", "rows");
      rows.forEach((r, i) => { const d = el("div", profs && profs[i] ? "prof" : ""); d.append(el("span", "", r[0]), el("span", "", r[1])); rs.append(d); });
      sec.append(rs);
      if (foot) sec.append(el("div", "foot", foot));
      box.append(sec);
    };
    for (const sec of S.sections) section(sec.title, sec.rows, sec.footer);
    if (P.skills && P.skills.length) section("Skills", P.skills.map((k) => [`${k.prof ? "●" : "○"}  ${k.label}`, `${k.bonus}  (${k.short})`]), "", P.skills.map((k) => k.prof));
    if (P.standing && P.standing.length) section("Standing", P.standing.map((f) => [f.name, `${f.words} (${f.score >= 0 ? "+" : ""}${f.score})`]));
  }

  async function spells(box, who, r) {
    const out = r || await call("spells", { member: who });
    const S = out.spells; if (!S) return;
    const sec = el("div", "section"); sec.id = "spellbox";
    sec.append(el("div", "sub", "Spells"));
    for (const l of S.lines) sec.append(el("div", "small", l));
    if (out.message) sec.append(el("p", "note", out.message));
    for (const g of S.prepare) {
      sec.append(el("div", "small", `${g.klass}: prepare up to ${g.limit} spells from ${g.from} (${g.picked.length} prepared)`));
      for (const sp of g.spells) {
        const b = rowBtn((sp.on ? "✓ " : "") + sp.name, "", async () => { const o = await call("spells", { member: who, do: "prepare", spell: sp.id }); redo(o); }, sp.on, !sp.on && g.picked.length >= g.limit);
        b.title = sp.desc; sec.append(b);
      }
      for (const a of g.always) sec.append(el("div", "small", `✓ ${a}  (always prepared)`));
    }
    if (S.outside.length) {
      sec.append(el("div", "sub", "Cast now (outside a fight)"));
      for (const sp of S.outside) {
        const row = el("div", "row-head");
        const sel = el("select");
        for (const t of S.targets) sel.append(Object.assign(el("option", "", t.name), { value: t.id }));
        row.append(btn(`Cast ${sp.name}`, "cmd", async () => { const o = await call("spells", { member: who, do: "cast", spell: sp.id, target: sel.value }); if (o.view) showView(o.view, false); redo(o); }),
                   el("span", "small", "on"), sel, el("span", "small", sp.cost));
        row.title = sp.desc; sec.append(row);
      }
    }
    if (S.ready.length) { sec.append(el("div", "sub", "Ready to cast")); for (const d of S.ready) sec.append(el("div", "small", d)); }
    box.append(sec);
    function redo(o) { const old = $("#spellbox"); const holder = el("div"); spells(holder, who, o).then(() => old.replaceWith(holder.firstChild)); }
  }

  // ================================================================ Quests
  const QTABS = [["active", "Quests"], ["finished", "Done"], ["lore", "Lore"], ["rumors", "Rumors"], ["notes", "Notes"]];

  async function quests(j) {
    J = j || await call("journal", {});
    if (questOpen) return questPage();
    $("#quest-page").hidden = true; $("#quest-list").hidden = false;
    const live = J.chains.filter((c) => c.status === "active");
    const counts = { active: J.active.length + live.length, finished: J.finished.length + J.chains.length - live.length,
                     lore: J.lore.length, rumors: J.rumors.length };
    const nav = $("#quest-tabs"); nav.innerHTML = "";
    for (const [k, t] of QTABS) nav.append(btn(counts[k] ? `${t} (${counts[k]})` : t, k === questTab ? "on" : "", () => { questTab = k; quests(J); }));
    const box = $("#quest-list"); box.innerHTML = "";
    const say = (t) => box.append(el("p", "small", t));
    if (questTab === "active") {
      for (const c of live) box.append(chainCard(c));
      const qs = [...J.active].sort((a, b) => (b.tracked - a.tracked) || ((a.status !== "ready") - (b.status !== "ready")));
      if (live.length && qs.length) say("Other quests");
      if (!qs.length && !live.length) say("No quests yet. Talk to people and ask for work; the first person you talk to may have a story for you.");
      for (const q of qs) box.append(questCard(q));
    } else if (questTab === "finished") {
      const done = J.chains.filter((c) => c.status !== "active");
      for (const c of done) box.append(chainCard(c));
      if (!done.length && !J.finished.length) say("Nothing finished yet.");
      for (const q of [...J.finished].reverse()) box.append(questCard(q));
    } else if (questTab === "lore") {
      if (!J.lore.length) say("Nothing read yet. Books turn up in libraries, temple archives, bookshops and the places you explore; what you read is kept here.");
      for (const e of [...J.lore].reverse()) {
        const c = el("div", "card"); const top = el("div", "top"); top.append(el("b", "", e.title || "")); c.append(top);
        c.append(el("div", "meta", `${e.kind || ""}  ·  read on day ${e.day || "?"}`), el("div", "", (e.text || "").slice(0, 600)));
        box.append(c);
      }
    } else if (questTab === "rumors") {
      if (!J.rumors.length) say("No rumors yet. Barkeeps hear everything (a round helps), notice boards carry news, and people in the street talk.");
      say(J.rumors.length ? "Tap a rumor to pin it on the map." : "");
      for (const r of [...J.rumors].reverse()) {
        const c = el("button", "card" + (r.pinned ? " tracked" : ""));
        const top = el("div", "top");
        top.append(el("b", "", { quest: "Someone in need", deposit: "Hidden riches", lair: "A lair", relic: "A lost relic" }[r.kind] || "Rumor"));
        if (r.pinned) top.append(el("span", "tag", "PINNED"));
        c.append(top, el("div", "", r.text || ""), el("div", "meta", `Day ${r.day || "?"}` + (r.from ? `, from ${r.from}` : "")));
        c.onclick = async () => { const out = await call("pin_rumor", { id: r.id }); quests(out.journal); };
        box.append(c);
      }
    } else {
      say("Your own reminders. They're kept with the game.");
      const ta = el("textarea"); ta.id = "quest-notes"; ta.value = J.notes || "";
      let timer = null;
      ta.oninput = () => { clearTimeout(timer); timer = setTimeout(() => call("notes", { text: ta.value }), 700); };
      ta.onblur = () => { clearTimeout(timer); call("notes", { text: ta.value }); };
      box.append(ta);
    }
  }

  function questCard(q) {
    const c = el("button", "card" + (q.tracked ? " tracked" : ""));
    const top = el("div", "top"); top.append(el("b", "", q.title || "Untitled quest"));
    const tag = { ready: ["HAND IN", "gold"], completed: ["DONE", ""], abandoned: ["ABANDONED", "dim"], failed: ["FAILED", "dim"] }[q.status] || (q.tracked ? ["PINNED", ""] : null);
    if (tag) top.append(el("span", "tag " + tag[1], tag[0]));
    c.append(top);
    const meta = [q.kind, q.giver && `from ${q.giver}`, q.where && `go to ${q.where}`].filter(Boolean).join("   ·   ");
    if (meta) c.append(el("div", "meta", meta));
    if (["active", "ready", undefined, null].includes(q.status)) {
      for (const o of q.objectives || []) { const r = el("div", "obj" + (o.done ? " done" : "")); r.append(el("span", "", o.done ? "■" : "□"), el("span", "", o.text)); c.append(r); }
    } else for (const h of q.history || []) c.append(el("div", "hist", h));
    if (q.reward) c.append(el("div", "reward", q.reward));
    c.onclick = () => { questOpen = q.id; abandonArmed = ""; questPage(); };
    return c;
  }

  function chainCard(ch) {
    const c = el("div", "card" + (ch.main ? " tracked" : ""));
    const top = el("div", "top"); top.append(el("b", "", ch.title + (ch.chapter > 1 ? `, chapter ${ch.chapter}` : "")));
    const tag = ch.main ? ["MAIN STORY", "gold"] : { completed: ["DONE", ""], failed: ["FAILED", "dim"] }[ch.status];
    if (tag) top.append(el("span", "tag " + tag[1], tag[0]));
    c.append(top);
    if (ch.giver) c.append(el("div", "meta", `for ${ch.giver}`));
    for (const st of ch.steps || []) c.append(el("div", "step " + st.state, `${{ done: "■", current: "▶", failed: "✗" }[st.state] || "□"}  ${st.title}`));
    if (ch.quest) c.append(questCard(ch.quest));
    for (const h of ch.history || []) c.append(el("div", "hist", h));
    return c;
  }

  async function questPage(r) {
    const out = r || await run("quest", { id: questOpen });
    if (out.journal) J = out.journal;
    const q = out.quest;
    $("#quest-list").hidden = true;
    const box = $("#quest-page"); box.hidden = false; box.innerHTML = "";
    $("#quest-tabs").innerHTML = "";
    $("#quest-tabs").append(btn("◀  Journal", "", () => { questOpen = ""; quests(J); }));
    if (!q) { questOpen = ""; return quests(J); }
    box.append(el("h2", "", q.title), el("div", "small", q.meta));
    if (q.pitch) box.append(el("div", "pitch", `“${q.pitch}”`));
    box.append(el("div", "sub", "Objectives"));
    const doIt = (what, arg) => async () => {
      const res = await run("quest_do", { id: q.id, what, arg });
      if (what === "route" || what === "explore") { questOpen = ""; show("walk"); return; }
      if (!res.quest) questOpen = "";
      questOpen ? questPage(res) : quests(res.journal);
    };
    for (const o of q.objectives) {
      const row = el("div", "objrow");
      row.append(el("div", o.done ? "small" : "", `${o.done ? "■" : "□"}  ${o.text}`));
      if (o.hint) row.append(el("div", "small", o.hint));
      if (o.way) row.append(el("div", "small", "Way: " + o.way));
      if (o.actions.length) { const a = el("div", "acts"); for (const x of o.actions) a.append(btn(x.label, "cmd", doIt(x.what, x.arg))); row.append(a); }
      box.append(row);
    }
    if (q.hand_in) {
      const row = el("div", "objrow"); row.append(el("div", "", "□  " + q.hand_in.text));
      if (q.hand_in.go) { const a = el("div", "acts"); a.append(btn("Go there", "cmd", doIt("route", q.hand_in.go))); row.append(a); }
      box.append(row);
    }
    if (q.reward) { box.append(el("div", "sub", "Reward")); box.append(el("div", "reward", q.reward)); }
    if (q.journal.length) { box.append(el("div", "sub", "Journal")); for (const l of q.journal) box.append(el("div", "small", l)); }
    if (q.live) {
      const bar = el("div", "dobar");
      if (!q.tracked) bar.append(btn("Track", "cmd accent", doIt("track")));
      const ab = btn(abandonArmed === q.id ? "Really abandon?" : "Abandon", "cmd", () => {
        if (abandonArmed === q.id) { abandonArmed = ""; doIt("abandon")(); } else { abandonArmed = q.id; questPage(out); }
      });
      bar.append(ab);
      box.append(bar);
    }
  }

  // ================================================================ Map: the place panel
  async function place(r) {
    const out = r || await call("place", {});
    const d = out.place, box = $("#place");
    const pin = $("#pin-line");
    pin.hidden = !out.pin;
    if (out.pin) pin.textContent = `Pinned: ${out.pin.title}. ${out.pin.text || ""}`;
    box.innerHTML = "";
    if (d.breadcrumb && d.breadcrumb.length) box.append(el("div", "crumbs", d.breadcrumb.join("  ›  ")));
    box.append(el("h2", "", d.name || "Somewhere"));
    if (d.description) box.append(el("p", "desc", d.description));
    if (["building", "street", null, undefined].includes(d.kind)) {
      box.append(el("div", "sub", "People here"));
      const l = el("div", "list");
      if (!(d.people || []).length) l.append(el("div", "empty", "Nobody else is here."));
      for (const p of d.people || []) { const r2 = el("div", "rowbtn"); r2.append(el("span", "", p.name), el("small", "", p.role || "")); l.append(r2); }
      box.append(l);
    }
    const groups = {};
    for (const x of d.exits || []) (groups[x.group || "Exits"] = groups[x.group || "Exits"] || []).push(x);
    for (const g of ["Journey", "Leave", "Places", "Streets", "Leave town", "Exits"]) {
      if (!groups[g]) continue;
      box.append(el("div", "sub", g));
      const l = el("div", "list");
      for (const x of groups[g]) l.append(rowBtn("►  " + x.name, x.note || "", async () => { const o = await run("place_go", { target: x.target }); place(o); MapView.refresh(true); }, false, !x.enabled));
      box.append(l);
    }
    if ((d.activities || []).length) {
      box.append(el("div", "sub", "Do"));
      const l = el("div", "list");
      for (const a of d.activities) l.append(rowBtn("◆  " + a.label, a.note || "", async () => { const o = await run("place_do", { target: a.target }); place(o); }, false, a.enabled === false));
      box.append(l);
    }
  }

  // ================================================================ Settings
  async function settings() {
    $("#dpad-right").checked = side() === "right";
    const all = await call("setting", {});                              // (web/games.py)
    const st = all.settings;
    showVolumes(all.volumes || {});
    share();
    $("#checks-mode").value = st.checks_mode === "Minigames" ? "Minigames" : "Dice";
    $("#minigame-slow").checked = !!st.minigame_slow;
    $("#react").checked = st.react !== false;
    $("#save-form").hidden = true; $("#save-list").hidden = true;
  }

  async function saveList(mode) {
    const S = await call("saves", {});
    const list = $("#save-list"); list.innerHTML = ""; list.hidden = false;
    $("#save-form").hidden = mode !== "save";
    if (S.hardcore) { list.append(el("div", "empty", "This world plays Hardcore: there are no manual saves. Your progress is kept automatically, until the party falls.")); $("#save-form").hidden = true; return; }
    if (mode === "save") { $("#save-name").value = S.suggest; list.append(el("div", "small", "Or save over one of these:")); }
    if (!S.saves.length) list.append(el("div", "empty", "No saves yet."));
    for (const sv of S.saves) {
      if (mode === "save" && sv.auto) continue;
      const row = el("div", "saverow");
      const b = el("button", "rowbtn");
      b.append(el("span", "", sv.auto ? "Autosave" : sv.name), el("small", "", [sv.clock, sv.where].filter(Boolean).join("  ·  ")));
      b.onclick = async () => {
        if (mode === "save") { await run("save_as", { name: sv.name, slot: sv.slot }); $("#save-note").textContent = `Saved over “${sv.name}”.`; saveList("save"); }
        else {
          $("#save-note").textContent = "Loading…";
          const v = await run("load", { slot: sv.slot });
          if (v.loaded) { MapView.refresh(true); $("#save-note").textContent = "Loaded."; show("walk"); }
          else $("#save-note").textContent = v.message || "Couldn't load that.";
        }
      };
      row.append(b);
      if (!sv.auto && mode === "load") row.append(btn("Delete", "cmd del", async (e) => {
        const t = e.currentTarget;
        if (t.dataset.armed) { await call("delete_save", { slot: sv.slot }); saveList("load"); } else { t.dataset.armed = "1"; t.textContent = "Sure?"; }
      }));
      list.append(row);
    }
  }

  // the sound (sound.js): the switch and four sliders, heard as they move, kept when let go
  function showVolumes(v) {
    Sound.setVolumes(v);
    $("#sound-on").checked = v.sound_on !== false;
    $$("#volumes input").forEach((r) => { r.value = v[r.dataset.vol] ?? 70; });
    $("#volumes").classList.toggle("off", v.sound_on === false);
  }

  // another device: this page's address, and its QR code when the site was built with one (tools/build_web.py)
  let shared = false;
  async function share() {
    if (shared) return;
    shared = true;
    let url = location.href.split(/[?#]/)[0];
    let qr = false;
    try { const r = await fetch("site.json"); if (r.ok) { const s = await r.json(); url = s.url || url; qr = !!s.qr; } } catch (_) { /* */ }
    $("#share-text").textContent = (qr ? "Scan this with a phone's camera, or open " : "Open ") + url +
      (qr ? "" : " on any phone, tablet or computer") + ". Each device keeps its own saves.";
    if (qr) { const img = $("#share-qr"); img.onload = () => { img.hidden = false; }; img.src = "qr.png"; }
  }

  function side() { try { return localStorage.getItem("dpad-side") || "left"; } catch (_) { return "left"; } }
  function setSide(s) {
    try { localStorage.setItem("dpad-side", s); } catch (_) { /* */ }
    $("#controls").classList.toggle("right", s === "right");
  }

  function init() {
    $$("#tabs button").forEach((b) => b.onclick = () => show(b.dataset.tab));
    $("#open-worldmap").onclick = () => WorldMap.open();
    $("#save-as").onclick = () => saveList("save");
    $("#load-game").onclick = () => saveList("load");
    $("#save-name-go").onclick = async () => {
      const r = await run("save_as", { name: $("#save-name").value });
      $("#save-note").textContent = r.saved ? "Saved." : (r.message || "Couldn't save.");
      if (r.saved) saveList("save");
    };
    $("#dpad-right").onchange = (e) => setSide(e.target.checked ? "right" : "left");
    $("#checks-mode").onchange = (e) => call("setting", { key: "checks_mode", value: e.target.value });
    $("#minigame-slow").onchange = (e) => call("setting", { key: "minigame_slow", value: e.target.checked });
    $("#react").onchange = (e) => call("setting", { key: "react", value: e.target.checked });
    $("#sound-on").onchange = (e) => {
      Sound.unlock();
      Sound.setVolumes({ sound_on: e.target.checked });
      $("#volumes").classList.toggle("off", !e.target.checked);
      call("setting", { key: "sound_on", value: e.target.checked });
    };
    $$("#volumes input").forEach((r) => {
      r.oninput = () => Sound.setVolumes({ [r.dataset.vol]: Number(r.value) });
      r.onchange = () => { call("setting", { key: r.dataset.vol, value: Number(r.value) }); Sound.hear({ sfx: [["click", 1]] }); };
    });
    setSide(side());
  }

  init();
  return { show, refresh };
})();
