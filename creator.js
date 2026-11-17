// Making characters (stage 3): a new game's welcome, the character creator page by page, levelling up, a
// feature's choices, a hero's look; one sheet over the screen for each. The rules are web/creator.py's.
"use strict";

const Sheets = (() => {
  let mode = "";                 // "creator" | "levelup" | "choices" | "look" | "more"
  let D = null;                  // what the game last said for it
  let welcoming = false;         // making the first heroes of a new game
  let made = { count: 1, max: 6 };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const body = () => $("#sheetbox-body");

  function open(title) {
    $("#sheetbox").hidden = false;
    $("#sheetbox-title").textContent = title;
  }
  function close() { $("#sheetbox").hidden = true; mode = ""; D = null; }
  function foot(back, next, backOn = true) {
    $("#sheetbox-back").textContent = back; $("#sheetbox-back").hidden = !back; $("#sheetbox-back").disabled = !backOn;
    $("#sheetbox-next").textContent = next; $("#sheetbox-next").hidden = !next;
  }
  function side(pic, lines) {
    $("#sheetbox-side").hidden = !pic && !(lines && lines.length);
    $("#sheetbox-pic").src = pic ? "data:image/png;base64," + pic : "";
    $("#sheetbox-pic").hidden = !pic;
    $("#sheetbox-lines").textContent = (lines || []).join("\n");
  }
  function pickRow(title, info, more, on, fn, disabled) {
    const b = el("button", "pick" + (on ? " on" : ""));
    b.append(el("b", "", title));
    if (info) b.append(el("small", "", info));
    if (more) b.append(el("span", "more", more));
    b.disabled = !!disabled;
    b.onclick = fn;
    return b;
  }

  // ================================================================ a new game
  function welcome(w) {
    welcoming = true;
    $("#welcome-title").textContent = w.first ? "A new adventure" : "Your party";
    $("#welcome-text").textContent = (w.first ? `Welcome to ${w.world}. ` : "Your party is empty. ") +
      "Every adventure starts with its heroes. You'll make your first character now, one step at a time: their people, " +
      "their class, where they came from, their ability scores, skills, spells and starting gear, and finally how they " +
      "look and what they're called. When they're done you can make more: a party can have up to six. You can always " +
      "add characters later from the Party tab.";
    $("#welcome").hidden = false;
  }
  $("#welcome-quick").onclick = async () => { $("#welcome").hidden = true; welcoming = false; showView(await call("party_new", { how: "quick" }), false); MapView.refresh(true); };
  $("#welcome-create").onclick = () => { $("#welcome").hidden = true; creator(); };

  async function begin() {
    welcoming = false;
    showView(await call("party_new", { how: "begin" }), false);
    MapView.refresh(true);
  }

  // ================================================================ the character creator
  async function creator() {
    const r = await call("creator", { do: "start" });
    if (!r.creator) { if (r.message) $("#save-note").textContent = r.message; return; }
    mode = "creator"; open("New character"); show(r.creator);
  }
  async function cr(args) {
    const r = await call("creator", args);
    if (r.view) showView(r.view, false);
    if (r.creator) { show(r.creator); return; }
    close();
    if (r.made) {                                       // made: their choices, then another?
      made = r;
      if (r.choices) { await choicesOpen(r.choices); return; }
      afterMade(r);
    } else if (welcoming) welcome({ world: "", first: false });
  }
  function afterMade(r) {
    if (!welcoming) { Tabs.refresh(); return; }
    if (r.count >= r.max) { begin(); return; }
    mode = "more"; open("Your party");
    side("", []);
    const b = body(); b.innerHTML = "";
    b.append(el("p", "", `Your party has ${r.count} ${r.count === 1 ? "hero" : "heroes"}. Add another character? (Up to ${r.max}.)`));
    $("#sheetbox-problem").textContent = "";
    foot("Start adventuring", "Create another");
  }

  function show(c) {
    const samePage = D && D.page === c.page;
    D = c;
    $("#sheetbox-title").textContent = `New character  ·  Step ${c.step} of ${c.steps}: ${c.page}`;
    side(c.picture, c.side);
    $("#sheetbox-problem").textContent = c.problem || "";
    foot("Back", c.last ? "Create" : "Next", !c.first);
    const b = body(); const top = b.scrollTop; b.innerHTML = "";
    const set = (what, value) => cr({ do: "set", what, value });
    if (c.page === "Race" || c.page === "Class") {
      b.append(el("h2", "", c.page === "Race" ? "Choose a race" : "Choose a class"));
      for (const o of c.options) b.append(pickRow(o.name, o.info, o.desc, o.on, () => set(c.page === "Race" ? "race" : "class", o.id)));
      if (c.page === "Race" && c.subraces.length) {
        b.append(el("div", "sub", "Subrace"));
        for (const o of c.subraces) b.append(pickRow(o.name, "", "", o.on, () => set("subrace", o.id)));
      }
    } else if (c.page === "Ability scores") {
      b.append(el("h2", "", "Ability scores"));
      const ms = el("div", "chips");
      for (const m of c.methods) ms.append(Object.assign(el("button", m === c.method ? "on" : "", m === "Roll" ? "Roll 4d6" : m), { onclick: () => set("method", m) }));
      b.append(ms);
      if (c.method === "Roll") b.append(Object.assign(el("button", "cmd", "Roll again"), { onclick: () => set("reroll", 1) }));
      const g = el("div", "scores");
      for (const r of c.rows) {
        g.append(el("span", "", r.name));
        if (c.method === "Point buy") {
          const st = el("div", "step");
          st.append(Object.assign(el("button", "", "−"), { onclick: () => r.value > 8 && set("score", [r.key, r.value - 1]) }),
                    el("span", "", String(r.value)),
                    Object.assign(el("button", "", "+"), { onclick: () => r.value < 15 && set("score", [r.key, r.value + 1]) }));
          g.append(st);
        } else {
          const sel = el("select");
          for (const v of c.choices) sel.append(Object.assign(el("option", "", String(v)), { value: v, selected: v === r.value }));
          sel.onchange = () => set("score", [r.key, parseInt(sel.value, 10)]);
          g.append(sel);
        }
        g.append(el("b", "", `= ${r.total} (${r.mod >= 0 ? "+" : ""}${r.mod})${r.bonus ? "  " + r.bonus : ""}`));
      }
      b.append(g);
      if (c.points) b.append(el("div", "gold", c.points));
      if (c.flexible) {
        const lab = el("label", "check"); const cb = el("input"); cb.type = "checkbox"; cb.checked = c.flexible.on;
        cb.onchange = () => set("flexible", cb.checked); lab.append(cb, " Place racial bonuses yourself"); b.append(lab);
        if (c.flexible.on) c.flexible.chunks.forEach((ch, i) => {
          const row = el("div", "row-head"); row.append(el("span", "", `+${ch.amount} to`));
          const sel = el("select");
          for (const k of c.flexible.keys) sel.append(Object.assign(el("option", "", k.toUpperCase()), { value: k, selected: k === ch.value }));
          sel.onchange = () => set("bonus", [i, sel.value]); row.append(sel); b.append(row);
        });
      }
    } else if (c.page === "Background & skills") {
      b.append(el("h2", "", "Background and skills"));
      const sel = el("select");
      for (const o of c.backgrounds) sel.append(Object.assign(el("option", "", o.name), { value: o.id, selected: o.on }));
      sel.onchange = () => set("background", sel.value); b.append(sel);
      if (c.info) b.append(el("p", "small", c.info));
      b.append(el("div", "sub", c.need ? `Choose ${c.need} skills from your class` : "Your class has no skill choices"));
      for (const sk of c.skills) b.append(pickRow(sk.name + (sk.granted ? "  (already have)" : ""), "", "", sk.on, () => set("skill", sk.id), sk.granted));
    } else if (c.page === "Equipment") {
      b.append(el("h2", "", "Starting equipment"));
      if (c.always) b.append(el("p", "", "You get: " + c.always));
      for (const g of c.groups) {
        b.append(el("div", "sub", `Choice ${g.group}`));
        for (const o of g.options) b.append(pickRow(o.label, "", "", o.on && !c.gold.on, () => set("gear", [g.group, o.index]), c.gold.on));
      }
      if (c.from_background) b.append(el("p", "small", "From your background: " + c.from_background));
      const lab = el("label", "check"); const cb = el("input"); cb.type = "checkbox"; cb.checked = c.gold.on; cb.disabled = !c.gold.can;
      cb.onchange = () => set("gold", cb.checked); lab.append(cb, " " + c.gold.label); b.append(lab);
    } else if (c.page === "Spells") {
      b.append(el("h2", "", "Spells"));
      if (c.note) b.append(el("p", "small", c.note));
      for (const sec of c.sections) {
        b.append(el("div", "sub", sec.title + (sec.need !== null ? `  ·  choose ${sec.need}` : "")));
        for (const sp of sec.spells) b.append(pickRow(sp.name, "", sp.desc, sp.on, () => set("spell", sp.id), sp.locked));
      }
    } else if (c.page === "Name & look") {
      b.append(el("h2", "", "Name and look"));
      const name = el("input"); name.type = "text"; name.placeholder = "Name"; name.value = c.name; name.maxLength = 40;
      name.onchange = () => set("name", name.value); name.onkeydown = (e) => { if (e.key === "Enter") name.blur(); };
      b.append(name);
      lookEditor(b, c.look, (key, value) => set("look", [key, value]), () => set("look_random", 1));
      for (const t of c.traits) b.append(el("p", "small", t));
    } else if (c.page === "Summary") {
      b.append(el("h2", "", "Ready?"));
      const sh = c.sheet;
      b.append(el("h2", "", sh.name || "(no name)"), el("p", "small", sh.tags.join("   ·   ")),
               el("p", "", sh.badges.map((x) => `${x.label} ${x.value}`).join("   ")),
               el("p", "", sh.resources.map((x) => `${x.label} ${x.current}/${x.max}`).join("   ")));
      for (const g of sh.stat_groups) b.append(el("p", "", g.stats.map((x) => `${x.label} ${x.sub} (${x.main})`).join("   ")));
      for (const sec of sh.sections) {
        b.append(el("div", "sub", sec.title));
        for (const row of sec.rows.slice(0, 12)) b.append(el("div", "small", `${row[0]}   ${row[1]}`));
      }
      if (c.gold) b.append(el("p", "gold", `Starting gold: ${c.gold} gp (goes into the party purse)`));
    }
    b.scrollTop = samePage ? top : 0;
  }

  // ---- a look: the body, colours, hair; shared by the creator and the Party tab
  function lookEditor(box, L, set, random) {
    const row = el("div", "row-head");
    const sel = el("select");
    let group = null;
    for (const o of L.bases) {
      if (o.group && o.group !== group) { group = o.group; const og = el("optgroup"); og.label = group; sel.append(og); }
      const opt = Object.assign(el("option", "", o.label), { value: o.id, selected: o.id === L.base });
      (sel.lastElementChild && sel.lastElementChild.tagName === "OPTGROUP" ? sel.lastElementChild : sel).append(opt);
    }
    sel.onchange = () => set("base", sel.value);
    row.append(el("span", "small", "Body"), sel, Object.assign(el("button", "cmd", "Randomize"), { onclick: random }));
    box.append(row);
    if (L.picture && mode === "look") side(L.picture, [L.name || ""]);
    for (const f of L.fields) {
      const r = el("div", "lookrow"); r.append(el("span", "", f.label));
      if (f.type === "choice") {
        const s = el("select");
        for (const [v, lab] of f.options) s.append(Object.assign(el("option", "", lab), { value: v, selected: v === f.value }));
        s.onchange = () => set(f.key, s.value); r.append(s);
      } else {
        const sw = el("div", "swatches");
        sw.append(Object.assign(el("button", "none" + (!f.value ? " on" : "")), { title: "Default", onclick: () => set(f.key, "") }));
        for (const col of f.options) {
          const b = el("button", f.value === col ? "on" : ""); b.style.background = col; b.title = col;
          b.onclick = () => set(f.key, col); sw.append(b);
        }
        const pick = el("input"); pick.type = "color"; pick.value = /^#[0-9a-f]{6}$/i.test(f.value) ? f.value : "#888888";
        pick.onchange = () => set(f.key, pick.value); sw.append(pick);
        r.append(sw);
      }
      box.append(r);
    }
  }

  // ================================================================ levelling up
  async function levelup(member) {
    const r = await call("levelup", { do: "open", member });
    if (!r.levelup) return;
    mode = "levelup"; open("Level up"); levelShow(r.levelup);
  }
  async function lu(args) {
    const r = await call("levelup", args);
    if (r.view) showView(r.view, false);
    if (r.levelup) { levelShow(r.levelup); return; }
    close();
    if (r.choices) { await choicesOpen(r.choices); return; }
    if (r.again) { levelup(r.again); return; }
    Tabs.refresh();
  }
  function levelShow(L) {
    D = L;
    $("#sheetbox-title").textContent = `Level up  ·  ${L.name}`;
    side("", []);
    $("#sheetbox-problem").textContent = L.problem || "";
    foot("Not now", "Level up");
    const b = body(); b.innerHTML = "";
    const set = (what, value) => lu({ do: "set", what, value });
    b.append(el("h2", "", `${L.name} reaches level ${L.level}!`));
    if (L.classes.length > 1) {
      b.append(el("div", "sub", "Take this level in"));
      const ch = el("div", "chips");
      for (const k of L.classes) ch.append(Object.assign(el("button", k.on ? "on" : "", k.name), { onclick: () => set("class", k.id) }));
      b.append(ch);
    }
    if (L.multi) b.append(el("p", "gold", "Multiclassing into a new class."));
    if (L.line) b.append(el("p", "", L.line));
    if (L.hp) {
      b.append(el("div", "sub", `Hit points (d${L.hp.die}, plus CON)`));
      const row = el("div", "chips");
      if (L.hp.rule === "Choose") {
        row.append(Object.assign(el("button", L.hp.value === L.hp.average ? "on" : "", `Take ${L.hp.average}`), { onclick: () => set("hp", L.hp.average) }),
                   Object.assign(el("button", "", "Roll"), { onclick: () => lu({ do: "roll" }) }));
      }
      row.append(el("b", "", L.hp.value === null ? "" : `+${L.hp.value} (before CON)`));
      b.append(row);
    }
    if (L.subclass) {
      b.append(el("div", "sub", `Choose your ${L.subclass.title}`));
      for (const s of L.subclass.options) b.append(pickRow(s.name, "", s.desc, s.on, () => set("sub", s.id)));
    }
    if (L.asi) {
      b.append(el("div", "sub", "Ability score improvement"));
      const ch = el("div", "chips");
      for (const m of L.asi.modes) ch.append(Object.assign(el("button", m === L.asi.mode ? "on" : "", m), { onclick: () => set("asi_mode", m) }));
      b.append(ch);
      if (L.asi.mode === "A feat") for (const f of L.asi.feats) b.append(pickRow(f.name, "", f.desc, f.on, () => set("feat", f.id)));
      else L.asi.picks.forEach((k, i) => {
        const s = el("select");
        for (const o of L.asi.keys) s.append(Object.assign(el("option", "", o.label), { value: o.key, selected: o.key === k }));
        s.onchange = () => set("asi", [i, s.value]); b.append(s);
      });
    }
    for (const sec of L.spells || []) {
      b.append(el("div", "sub", `${sec.title}  ·  choose ${sec.need}`));
      for (const sp of sec.spells) b.append(pickRow(sp.name, "", sp.desc, sp.on, () => set("spell", sp.id)));
    }
  }

  // ================================================================ choices
  async function choicesOpen(c) {
    if (!c) { Tabs.refresh(); return; }
    mode = "choices"; open("Choices"); choicesShow(c);
  }
  async function choices(member) {
    const r = await call("choices", { do: "open", member });
    await choicesOpen(r.choices);
  }
  function choicesShow(c) {
    D = c;
    $("#sheetbox-title").textContent = `Choices  ·  ${c.name}`;
    side("", []);
    $("#sheetbox-problem").textContent = c.problem || "";
    foot("Later", "Save choices");
    const b = body(); const top = b.scrollTop; b.innerHTML = "";
    b.append(el("p", "small", "Some of your features let you choose. Pick as many as each one allows."));
    if (!c.rows.length) b.append(el("p", "small", "Nothing to choose right now."));
    for (const row of c.rows) {
      b.append(el("div", "sub", row.title));
      if (row.desc) b.append(el("p", "small", row.desc));
      const picked = row.options.filter((o) => o.on).length;
      for (const o of row.options) b.append(pickRow(o.name, "", o.desc, o.on, async () => {
        const r = await call("choices", { do: "toggle", feature: row.id, option: o.id }); choicesShow(r.choices);
      }, !o.on && picked >= row.need));
    }
    b.scrollTop = top;
  }

  // ================================================================ a hero's look
  async function look(member) {
    const r = await call("look", { do: "open", member });
    if (!r.look) return;
    mode = "look"; open("Look"); lookShow(r.look);
  }
  function lookShow(L) {
    D = L;
    $("#sheetbox-title").textContent = `Look  ·  ${L.name}`;
    $("#sheetbox-problem").textContent = "";
    foot("Cancel", "Use this look");
    const b = body(); const top = b.scrollTop; b.innerHTML = "";
    lookEditor(b, L, async (key, value) => lookShow((await call("look", { do: "set", key, value })).look),
               async () => lookShow((await call("look", { do: "random" })).look));
    b.scrollTop = top;
  }

  // ================================================================ the buttons
  $("#sheetbox-next").onclick = async () => {
    if (mode === "creator") cr({ do: "go", step: 1 });
    else if (mode === "levelup") lu({ do: "apply" });
    else if (mode === "choices") {
      const r = await call("choices", { do: "save" });
      if (r.view) showView(r.view, false);
      if (r.choices) choicesShow(r.choices);
      else { close(); if (welcoming) afterMade(made); else Tabs.refresh(); }
    } else if (mode === "look") {
      const r = await call("look", { do: "save" });
      if (r.view) showView(r.view, false);
      close(); MapView.refresh(true); Tabs.refresh();
    } else if (mode === "more") { close(); creator(); }
  };
  $("#sheetbox-back").onclick = async () => {
    if (mode === "creator") cr({ do: "go", step: -1 });
    else if (mode === "levelup") { await call("levelup", { do: "cancel" }); close(); }
    else if (mode === "choices") { await call("choices", { do: "cancel" }); close(); if (welcoming) afterMade(made); }
    else if (mode === "look") { await call("look", { do: "cancel" }); close(); }
    else if (mode === "more") { close(); begin(); }
  };
  $("#sheetbox-close").onclick = async () => {
    if (mode === "creator") cr({ do: "cancel" });
    else if (mode === "more") { close(); begin(); }
    else $("#sheetbox-back").onclick();
  };

  return { welcome, creator, levelup, choices, look, lookEditor, get open() { return !$("#sheetbox").hidden; } };
})();
