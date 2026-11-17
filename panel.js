// Talking to people, trading, and the app's other small windows (stage 3): one screen for all of them
// (web/panel.py). The page draws what it's given and says which button was pressed, with what's in the boxes.
"use strict";

const Panel = (() => {
  let P = null, open = false, timer = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function values() {
    const out = {};
    $$("#panel-blocks [data-id]").forEach((x) => {
      out[x.dataset.id] = x.type === "checkbox" ? x.checked : x.type === "number" ? parseInt(x.value || "0", 10) : x.value;
    });
    return out;
  }

  async function send(args) {
    const r = await call("panel", { values: values(), ...args });
    show(r);
  }

  function show(r) {
    P = r.panel;
    open = !!P;
    if (r.view) showView(r.view, false);
    if (!P) { close(); return; }
    $("#panel").hidden = false;
    $("#panel-title").textContent = P.title;
    $("#panel-who").hidden = !P.name && !P.picture;
    $("#panel-pic").hidden = !P.picture;
    $("#panel-pic").src = P.picture ? "data:image/png;base64," + P.picture : "";
    $("#panel-name").textContent = P.name || "";
    $("#panel-sub").textContent = P.sub || "";
    const lines = $("#panel-lines"); lines.innerHTML = "";
    for (const l of P.lines) {
      const d = el("div", l.kind);
      if (l.kind === "them" && l.who) { d.append(el("b", "", l.who + ": ")); d.append(l.text); }
      else d.textContent = l.text;
      lines.append(d);
    }
    lines.scrollTop = lines.scrollHeight;
    const box = $("#panel-blocks"); const top = box.scrollTop; box.innerHTML = "";
    for (const b of P.blocks) box.append(block(b));
    box.scrollTop = top;
    $("#panel-message").textContent = P.message || "";
    $("#panel-close").textContent = P.close || "Done";
    if (P.pick) WorldMap.open({ pick: (x, y) => send({ do: "point", values: { x, y } }) });   // a spot on the map
  }

  function block(b) {
    if (b.t === "text") return el("p", b.style || "", b.text);
    if (b.t === "head") return el("div", "head", b.text);
    if (b.t === "opt") {
      const r = el("button", "rowbtn" + (b.on ? " on" : "") + (b.style ? " " + b.style : ""));
      r.append(el("span", "", b.label));
      if (b.sub) r.append(el("small", "", b.sub));
      r.disabled = !b.enabled;
      if (b.desc) r.title = b.desc;
      r.onclick = () => send({ do: "pick", index: b.i });
      return r;
    }
    if (b.t === "row") {
      const r = el("div", "btnrow");
      for (const it of b.items) {
        const x = el("button", "cmd" + (it.style === "primary" ? " accent" : it.style === "ghost" ? " ghost" : ""), it.label);
        x.disabled = !it.enabled; x.onclick = () => send({ do: "pick", index: it.i }); r.append(x);
      }
      return r;
    }
    const f = el("label", "field");
    f.append(el("span", "", b.label));
    let input;
    if (b.t === "number") {
      input = el("input"); input.type = "number"; input.min = b.min; input.max = b.max; input.value = b.value; input.inputMode = "numeric";
      f.append(input); if (b.suffix) f.append(el("span", "", b.suffix.trim()));
      const step = (d) => { input.value = Math.max(b.min, Math.min(b.max, (parseInt(input.value || "0", 10) || 0) + d)); changed(); };
      f.append(Object.assign(el("button", "cmd", "−"), { onclick: (e) => { e.preventDefault(); step(-1); } }),
               Object.assign(el("button", "cmd", "+"), { onclick: (e) => { e.preventDefault(); step(1); } }));
    } else if (b.t === "field") {
      input = el("input"); input.type = "text"; input.value = b.value; f.append(input);
    } else if (b.t === "select") {
      input = el("select");
      for (const [v, lab] of b.options) input.append(Object.assign(el("option", "", lab), { value: v, selected: String(b.value) === v }));
      f.append(input);
    } else if (b.t === "check") {
      input = el("input"); input.type = "checkbox"; input.checked = b.value; f.prepend(input); f.classList.add("check");
    }
    input.dataset.id = b.id;
    input.onchange = changed;
    return f;
  }

  function changed() {                       // a box changed: the panel may show something from it (a price)
    clearTimeout(timer);
    timer = setTimeout(() => send({ do: "set" }), 250);
  }

  function close() {
    open = false; P = null;
    $("#panel").hidden = true;
    MapView.refresh(true);
    if (typeof Tabs !== "undefined") Tabs.refresh();
  }

  $("#panel-close").onclick = () => send({ do: "close" });
  $("#panel-x").onclick = () => send({ do: "close" });

  async function fetch() { show(await call("panel", {})); }
  return { fetch, get open() { return open; } };
})();
