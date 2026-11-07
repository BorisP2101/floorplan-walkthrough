import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  ROOM_TYPES, area, pairKey, computeLayout, checks, neighbours, roomAt, bounds, overlaps, sampleHouse,
} from "./layout.js";

// ---------- State ----------
const STORE = "fpw-plan-v1";
let plan = load() || sampleHouse();
let layout = computeLayout(plan);
let selected = null; // room id
let view = "plan";

function load() {
  try { const p = JSON.parse(localStorage.getItem(STORE)); return p && Array.isArray(p.rooms) ? p : null; } catch { return null; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(plan)); } catch { /* storage unavailable */ } }
function changed() { layout = computeLayout(plan); save(); dirty3d = true; renderPlan(); renderPanel(); }
const byId = (id) => plan.rooms.find((r) => r.id === id);
const newId = () => "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const fmt = (v) => v.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f);
    else if (k === "text") e.textContent = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
};

// ---------- Tabs ----------
const tabs = [...document.querySelectorAll(".tabs button")];
tabs.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
function setView(v, opts = {}) {
  view = v;
  tabs.forEach((b) => b.setAttribute("aria-selected", b.dataset.view === v ? "true" : "false"));
  document.getElementById("plan").toggleAttribute("hidden", v !== "plan"); // SVG has no .hidden property
  document.getElementById("plan-help").hidden = v !== "plan";
  document.getElementById("three").hidden = v === "plan";
  if (v === "plan") { fitPlan(); renderPlan(); }
  else enter3d(v, opts);
  renderPanel();
}

// ---------- File buttons ----------
document.getElementById("btn-sample").onclick = () => { plan = sampleHouse(); selected = null; fitNext = true; changed(); if (view !== "plan") enter3d(view); };
document.getElementById("btn-new").onclick = () => {
  if (plan.rooms.length && !confirm("Start an empty plan? The current plan will be replaced.")) return;
  plan = { name: "New plan", wallHeight: 2.6, rooms: [], doors: {} }; selected = null; fitNext = true; changed(); setView("plan");
};
document.getElementById("btn-export").onclick = () => {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: (plan.name || "plan").replace(/[^\w-]+/g, "-").toLowerCase() + ".json" });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
document.getElementById("inp-import").onchange = async (ev) => {
  const f = ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (!Array.isArray(p.rooms)) throw new Error("no rooms");
    p.rooms = p.rooms.filter((r) => r && r.id && [r.x, r.y, r.w, r.d].every(Number.isFinite));
    p.doors ||= {}; p.wallHeight ||= 2.6;
    plan = p; selected = null; fitNext = true; changed();
  } catch { alert("That file doesn't look like an exported plan."); }
};

// ---------- 2D plan editor (SVG in metres) ----------
const svg = document.getElementById("plan");
const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
let vb = { x: -2, y: -2, w: 18, h: 16 };
let fitNext = true;
let drag = null;

function fitPlan() {
  const b = bounds(plan);
  const rect = svg.getBoundingClientRect();
  const aspect = rect.width && rect.height ? rect.width / rect.height : 1.3;
  let w = Math.max(b.w + 4, 14), h = Math.max(b.d + 4, 10);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  vb = { x: b.x + b.w / 2 - w / 2, y: b.y + b.d / 2 - h / 2, w, h };
}

function toPlan(ev) {
  const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

function renderPlan() {
  if (view !== "plan") return;
  if (fitNext) { fitPlan(); fitNext = false; }
  svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.replaceChildren();
  // grid: 1 m minor, 5 m major
  const g = s("g");
  for (let x = Math.floor(vb.x); x <= vb.x + vb.w; x++) g.append(s("line", { x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h, class: x % 5 ? "grid-minor" : "grid-major" }));
  for (let y = Math.floor(vb.y); y <= vb.y + vb.h; y++) g.append(s("line", { x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y, class: y % 5 ? "grid-minor" : "grid-major" }));
  svg.append(g);

  for (const r of plan.rooms) {
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.living;
    const gr = s("g", { class: "room" + (r.id === selected ? " sel" : "") + (drag?.clash && drag.id === r.id ? " clash" : ""), "data-id": r.id });
    gr.append(s("rect", { class: "body", x: r.x, y: r.y, width: r.w, height: r.d, fill: t.fill, "data-id": r.id }));
    const small = Math.min(r.w, r.d) < 1.8;
    const name = s("text", { class: "name", x: r.x + r.w / 2, y: r.y + r.d / 2 - (small ? 0.18 : 0.22) });
    name.textContent = r.name || t.label;
    const m2 = s("text", { x: r.x + r.w / 2, y: r.y + r.d / 2 + (small ? 0.18 : 0.22) });
    m2.textContent = fmt(area(r)) + " m²";
    if (small) { name.style.fontSize = "0.26px"; m2.style.fontSize = "0.24px"; }
    gr.append(name, m2);
    svg.append(gr);
  }
  // openings from the computed layout
  for (const w of layout.walls) for (const o of w.openings) {
    const [x1, y1, x2, y2] = w.axis === "x" ? [o.a, w.fixed, o.b, w.fixed] : [w.fixed, o.a, w.fixed, o.b];
    svg.append(s("line", { x1, y1, x2, y2, class: o.kind === "window" ? "window" : "door" }));
  }
  // handles
  const r = byId(selected);
  if (r) for (const [c, x, y] of [["nw", r.x, r.y], ["ne", r.x + r.w, r.y], ["sw", r.x, r.y + r.d], ["se", r.x + r.w, r.y + r.d]]) {
    svg.append(s("circle", { class: "handle " + c, cx: x, cy: y, r: Math.max(0.14, vb.w / 120), "data-corner": c }));
  }
  if (drag?.mode === "draw" && drag.rect) {
    const d = drag.rect;
    svg.append(s("rect", { class: "draft", x: d.x, y: d.y, width: d.w, height: d.d }));
  }
  // scale bar
  const sb = s("g", { class: "scale" });
  const sx = vb.x + 0.6, sy = vb.y + vb.h - 0.6;
  sb.append(s("line", { x1: sx, y1: sy, x2: sx + 2, y2: sy }));
  const st = s("text", { x: sx, y: sy - 0.2 }); st.textContent = "2 m"; sb.append(st);
  svg.append(sb);
}

const SNAP = 0.25;
const round1 = (v) => Math.round(v * 10) / 10;
function edgeCandidates(axis, exceptId) {
  const out = [];
  for (const r of plan.rooms) if (r.id !== exceptId) out.push(...(axis === "x" ? [r.x, r.x + r.w] : [r.y, r.y + r.d]));
  return out;
}
function snap1(v, cands) {
  let best = null;
  for (const c of cands) if (Math.abs(c - v) < SNAP && (best == null || Math.abs(c - v) < Math.abs(best - v))) best = c;
  return best ?? round1(v);
}
function snapSpan(v, len, cands) { // move a span [v, v+len], snapping either end
  let best = null;
  for (const c of cands) for (const d of [c - v, c - (v + len)]) if (Math.abs(d) < SNAP && (best == null || Math.abs(d) < Math.abs(best))) best = d;
  return best != null ? v + best : round1(v);
}
const clashes = (r) => plan.rooms.some((q) => q.id !== r.id && overlaps(r, q));

svg.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  const p = toPlan(ev);
  const corner = ev.target.dataset?.corner;
  const id = ev.target.dataset?.id;
  svg.setPointerCapture(ev.pointerId);
  if (corner && selected) {
    const r = byId(selected);
    drag = { mode: "resize", id: r.id, corner, orig: { ...r } };
  } else if (id) {
    const r = byId(id);
    if (selected !== id) { selected = id; renderPanel(); }
    drag = { mode: "move", id, px: p.x, py: p.y, orig: { ...r }, moved: false };
  } else {
    drag = { mode: "draw", sx: snap1(p.x, edgeCandidates("x")), sy: snap1(p.y, edgeCandidates("y")), rect: null };
  }
  renderPlan();
});

svg.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const p = toPlan(ev);
  if (drag.mode === "move") {
    const r = byId(drag.id), o = drag.orig;
    if (Math.hypot(p.x - drag.px, p.y - drag.py) > 0.05) drag.moved = true;
    r.x = snapSpan(o.x + p.x - drag.px, o.w, edgeCandidates("x", r.id));
    r.y = snapSpan(o.y + p.y - drag.py, o.d, edgeCandidates("y", r.id));
    drag.clash = clashes(r);
  } else if (drag.mode === "resize") {
    const r = byId(drag.id), o = drag.orig;
    const cx = edgeCandidates("x", r.id), cy = edgeCandidates("y", r.id);
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.d;
    if (drag.corner.includes("w")) x1 = Math.min(snap1(p.x, cx), x2 - 0.8); else x2 = Math.max(snap1(p.x, cx), x1 + 0.8);
    if (drag.corner.includes("n")) y1 = Math.min(snap1(p.y, cy), y2 - 0.8); else y2 = Math.max(snap1(p.y, cy), y1 + 0.8);
    Object.assign(r, { x: round2(x1), y: round2(y1), w: round2(x2 - x1), d: round2(y2 - y1) });
    drag.clash = clashes(r);
  } else {
    const x = snap1(p.x, edgeCandidates("x")), y = snap1(p.y, edgeCandidates("y"));
    drag.rect = { x: Math.min(x, drag.sx), y: Math.min(y, drag.sy), w: Math.abs(x - drag.sx), d: Math.abs(y - drag.sy) };
  }
  if (drag.mode !== "draw") layout = computeLayout(plan);
  renderPlan();
});
const round2 = (v) => Math.round(v * 100) / 100;

function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === "draw") {
    const rc = d.rect;
    if (rc && rc.w >= 0.8 && rc.d >= 0.8 && !plan.rooms.some((q) => overlaps(rc, q))) {
      const n = plan.rooms.length + 1;
      const room = { id: newId(), name: "Room " + n, type: "bedroom", x: round2(rc.x), y: round2(rc.y), w: round2(rc.w), d: round2(rc.d) };
      plan.rooms.push(room); selected = room.id;
    } else if (!rc || rc.w < 0.3) { selected = null; }
  } else if (d.clash) {
    Object.assign(byId(d.id), d.orig);
  }
  changed();
}
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);

window.addEventListener("keydown", (ev) => {
  if (view !== "plan" || !selected || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (ev.key === "Delete" || ev.key === "Backspace") { deleteRoom(selected); ev.preventDefault(); }
  if (ev.key === "Escape") { selected = null; renderPlan(); renderPanel(); }
});
function deleteRoom(id) {
  plan.rooms = plan.rooms.filter((r) => r.id !== id);
  for (const k of Object.keys(plan.doors || {})) if (k.split("|").includes(id)) delete plan.doors[k];
  selected = null; changed();
}

// ---------- Side panel ----------
const panel = document.getElementById("panel");
function renderPanel() {
  panel.replaceChildren();
  const r = byId(selected);
  if (r) return panel.append(roomPanel(r));
  panel.append(housePanel());
}

function field(label, input) { return el("label", { class: "field" }, el("span", { text: label }), input); }
function num(value, onSet, step = 0.1, min = 0) {
  return el("input", { type: "number", step, min, value, inputmode: "decimal", on: { change: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onSet(v); } } });
}

function housePanel() {
  const total = plan.rooms.filter((r) => !ROOM_TYPES[r.type]?.open).reduce((a, r) => a + area(r), 0);
  const issues = plan.rooms.flatMap((r) => checks(plan, layout, r).filter((c) => !c.ok).map((c) => ({ r, c })));
  const list = el("ul", { class: "roomlist" }, plan.rooms.map((q) => el("li", {}, el("button", { type: "button", on: { click: () => { selected = q.id; renderPlan(); renderPanel(); } } },
    el("span", {}, el("span", { class: "sw", style: `background:${(ROOM_TYPES[q.type] || ROOM_TYPES.living).fill}` }), q.name || ROOM_TYPES[q.type]?.label),
    el("span", { class: "muted", text: fmt(area(q)) + " m²" })))));
  return el("div", {},
    el("h2", { text: plan.name || "Untitled plan" }),
    el("p", { class: "muted", text: view === "walk" ? "Walk with W A S D or the arrow keys, drag to look around. On a phone: drag on the left half to walk, on the right half to look." : view === "overview" ? "Drag to orbit, scroll or pinch to zoom. Click a room for details, double-click to walk in." : "Draw and label rooms, then switch to 2 · 3D model or 3 · Walk through." }),
    view !== "walk" ? el("div", { class: "row" }, el("button", { class: "primary", type: "button", text: "Walk through the house →", on: { click: () => setView("walk") } })) : null,
    el("h3", { text: "Plan" }),
    field("Name", el("input", { type: "text", value: plan.name || "", on: { change: (e) => { plan.name = e.target.value; save(); renderPanel(); } } })),
    field("Ceiling height (m)", num(plan.wallHeight || 2.6, (v) => { plan.wallHeight = Math.min(4, Math.max(2.1, v)); changed(); }, 0.05, 2.1)),
    el("dl", { class: "stats" }, el("dt", { text: "Rooms" }), el("dd", { text: String(plan.rooms.length) }), el("dt", { text: "Floor area" }), el("dd", { text: fmt(total) + " m² (excl. stoep)" })),
    el("h3", { text: `Checks (${issues.length ? issues.length + " to look at" : "all fine"})` }),
    issues.length ? issues.slice(0, 8).map(({ r, c }) => el("div", { class: "check bad" }, el("span", { class: "mark", text: "✗" }), el("span", { text: `${r.name}: ${c.text}` })))
      : el("p", { class: "muted", text: "Every habitable room meets the simplified light, ventilation and height checks." }),
    el("p", { class: "muted", text: "Simplified checks inspired by SANS 10400 (Part O and C). Indicative only." }),
    el("h3", { text: "Rooms" }), list,
  );
}

function roomPanel(r) {
  const t = ROOM_TYPES[r.type] || ROOM_TYPES.living;
  const set = (k) => (v) => {
    const before = { ...r };
    r[k] = k === "w" || k === "d" ? Math.max(0.8, round2(v)) : round2(v);
    if (clashes(r)) { Object.assign(r, before); alert("That would overlap another room."); }
    changed();
  };
  const typeSel = el("select", { on: { change: (e) => { r.type = e.target.value; if (!r.name || Object.values(ROOM_TYPES).some((x) => x.label === r.name)) r.name = ROOM_TYPES[r.type].label; changed(); } } },
    Object.entries(ROOM_TYPES).map(([k, v]) => el("option", { value: k, selected: k === r.type ? "" : false, text: v.label })));
  const nb = neighbours(plan, r);
  const doors = nb.map((q) => el("label", { class: "check" },
    el("input", { type: "checkbox", checked: hasDoorUI(r, q) ? "" : false, on: { change: (e) => { plan.doors ||= {}; plan.doors[pairKey(r.id, q.id)] = e.target.checked; changed(); } } }),
    el("span", { text: (ROOM_TYPES[r.type]?.open || ROOM_TYPES[q.type]?.open ? "Sliding door to " : "Door to ") + (q.name || ROOM_TYPES[q.type]?.label) })));
  const cs = checks(plan, layout, r);
  return el("div", {},
    el("h2", { text: r.name || t.label }),
    el("p", { class: "muted", text: `${t.label} · ${fmt(area(r))} m² · ${fmt(r.w)} × ${fmt(r.d)} m` }),
    el("div", { class: "row" },
      el("button", { class: "primary", type: "button", text: "Walk in here →", on: { click: () => setView("walk", { room: r.id }) } }),
      el("button", { type: "button", text: "← All rooms", on: { click: () => { selected = null; renderPlan(); renderPanel(); } } })),
    el("h3", { text: "Label" }),
    field("Name", el("input", { type: "text", value: r.name || "", on: { change: (e) => { r.name = e.target.value; changed(); } } })),
    field("Type", typeSel),
    el("h3", { text: "Size and position (m)" }),
    el("div", { class: "grid2" },
      field("Width", num(r.w, set("w"), 0.1, 0.8)), field("Depth", num(r.d, set("d"), 0.1, 0.8)),
      field("X", num(r.x, set("x"), 0.1, -100)), field("Y", num(r.y, set("y"), 0.1, -100))),
    el("h3", { text: "Doors" }),
    doors.length ? doors : el("p", { class: "muted", text: "Place this room against another room to add a door." }),
    cs.length ? [el("h3", { text: "Checks" }), cs.map((c) => el("div", { class: "check " + (c.ok ? "ok" : "bad") }, el("span", { class: "mark", text: c.ok ? "✓" : "✗" }), el("span", { text: c.text }))),
      el("p", { class: "muted", text: "Simplified, inspired by SANS 10400. Indicative only." })] : null,
    el("div", { class: "row" }, el("button", { class: "danger", type: "button", text: "Delete room", on: { click: () => deleteRoom(r.id) } })),
  );
}
function hasDoorUI(r, q) {
  const k = pairKey(r.id, q.id);
  if (plan.doors && k in plan.doors) return plan.doors[k];
  return !!(ROOM_TYPES[r.type]?.shared || ROOM_TYPES[q.type]?.shared);
}

// ---------- 3D ----------
const host = document.getElementById("three");
const labelsEl = document.getElementById("labels");
const hud = document.getElementById("hud"), hudRoom = document.getElementById("hud-room");
const help = document.getElementById("help");
const minimap = document.getElementById("minimap");
let renderer, scene, camera, orbit, world, ceilings, floorMeshes = [], labelEls = [], colliders = [], dirty3d = true;
let centre = { x: 0, y: 0 };
const player = { x: 0, z: 0, yaw: 0, pitch: 0 };
const EYE = 1.62, RADIUS = 0.25;

function init3d() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe3f0);
  scene.fog = new THREE.Fog(0xcfe3f0, 30, 90);
  camera = new THREE.PerspectiveCamera(60, 1, 0.05, 300);
  camera.rotation.order = "YXZ";
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.47;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b0, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-12, 22, -9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x86a05e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  new ResizeObserver(resize).observe(host);
  setupWalkInput(renderer.domElement);
  setupPicking(renderer.domElement);
  renderer.setAnimationLoop(tick);
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

const toW = (x, y) => ({ x: x - centre.x, z: y - centre.y });
const mats = {};
const mat = (color, extra = {}) => (mats[color + JSON.stringify(extra)] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra }));

function build3d() {
  if (world) { scene.remove(world); world.traverse((o) => o.geometry?.dispose()); }
  world = new THREE.Group(); ceilings = new THREE.Group(); world.add(ceilings);
  floorMeshes = []; colliders = [];
  const b = bounds(plan); centre = { x: b.x + b.w / 2, y: b.y + b.d / 2 };
  const H = layout.H;

  for (const r of plan.rooms) {
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.living;
    const c = toW(r.x + r.w / 2, r.y + r.d / 2);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.06, r.d), mat(t.floor, { roughness: t.open ? 1 : 0.75 }));
    floor.position.set(c.x, 0.03, c.z); floor.receiveShadow = true; floor.userData.room = r.id;
    world.add(floor); floorMeshes.push(floor);
    if (!t.open) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat(0xfbfaf7));
      ceil.rotation.x = Math.PI / 2; ceil.position.set(c.x, H, c.z); ceil.castShadow = true;
      ceilings.add(ceil);
      const lamp = new THREE.PointLight(0xffe9c7, 3.5, 7, 1.2);
      lamp.position.set(c.x, H - 0.3, c.z);
      ceilings.add(lamp);
    }
  }

  const wallMat = mat(0xf2efe8, { roughness: 0.95 });
  const glassMat = mat(0x9cc7e0, { transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1 });
  const frameMat = mat(0x5a4636);
  const box = (axis, fixed, a, b2, bottom, top, thick, m, collide) => {
    const L = b2 - a, h = top - bottom;
    if (L <= 0.01 || h <= 0.01) return;
    const geo = axis === "x" ? new THREE.BoxGeometry(L, h, thick) : new THREE.BoxGeometry(thick, h, L);
    const mesh = new THREE.Mesh(geo, m);
    const p = axis === "x" ? toW((a + b2) / 2, fixed) : toW(fixed, (a + b2) / 2);
    mesh.position.set(p.x, bottom + h / 2, p.z);
    mesh.castShadow = m !== glassMat; mesh.receiveShadow = true;
    world.add(mesh);
    if (collide && bottom < 1.4) {
      const [w, d] = axis === "x" ? [L, thick] : [thick, L];
      colliders.push({ x1: p.x - w / 2, x2: p.x + w / 2, z1: p.z - d / 2, z2: p.z + d / 2 });
    }
  };
  for (const w of layout.walls) {
    const ext = w.thick / 2; // extend ends so corners close
    const ops = [...w.openings].sort((p, q) => p.a - q.a);
    let cur = w.a - ext;
    for (const o of ops) {
      box(w.axis, w.fixed, cur, o.a, 0, H, w.thick, wallMat, true);
      box(w.axis, w.fixed, o.a, o.b, 0, o.bottom, w.thick, wallMat, true);
      box(w.axis, w.fixed, o.a, o.b, o.top, H, w.thick, wallMat, true);
      if (o.kind === "window" || o.kind === "slider") box(w.axis, w.fixed, o.a, o.b, o.bottom, o.top, 0.02, glassMat, o.kind === "window");
      if (o.kind === "slider") { box(w.axis, w.fixed, o.a, o.b, 0, 0.04, w.thick + 0.02, frameMat, false); }
      if (o.kind !== "window") { // door frame
        box(w.axis, w.fixed, o.a, o.a + 0.04, 0, o.top, w.thick + 0.03, frameMat, false);
        box(w.axis, w.fixed, o.b - 0.04, o.b, 0, o.top, w.thick + 0.03, frameMat, false);
        box(w.axis, w.fixed, o.a, o.b, o.top - 0.04, o.top, w.thick + 0.03, frameMat, false);
      }
      cur = o.b;
    }
    box(w.axis, w.fixed, cur, w.b + ext, 0, H, w.thick, wallMat, true);
  }
  // sliding doors: glass is passable when open; we leave sliders open (no collider).

  for (const f of layout.furniture) {
    const p = toW(f.cx, f.cy);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(f.sx, Math.max(0.01, f.h), f.sy), mat(f.color, { roughness: 0.8 }));
    mesh.position.set(p.x, f.elev + f.h / 2 + 0.06, p.z);
    mesh.castShadow = f.h > 0.05; mesh.receiveShadow = true;
    world.add(mesh);
    if (f.h > 0.2 && f.elev < 1) colliders.push({ x1: p.x - f.sx / 2, x2: p.x + f.sx / 2, z1: p.z - f.sy / 2, z2: p.z + f.sy / 2 });
  }
  scene.add(world);

  labelsEl.replaceChildren();
  labelEls = plan.rooms.map((r) => {
    const d = el("div", {}, r.name || ROOM_TYPES[r.type]?.label, el("small", { text: fmt(area(r)) + " m²" }));
    labelsEl.append(d);
    return { d, p: new THREE.Vector3(toW(r.x + r.w / 2, 0).x, 0.6, toW(0, r.y + r.d / 2).z) };
  });
  dirty3d = false;
}

function enter3d(v, opts = {}) {
  if (!renderer) init3d();
  resize();
  if (dirty3d) build3d();
  const H = layout.H;
  ceilings.visible = v === "walk";
  labelsEl.hidden = v !== "overview";
  hud.hidden = v !== "walk";
  orbit.enabled = v === "overview";
  const b = bounds(plan);
  if (v === "overview") {
    const span = Math.max(b.w, b.d, 6);
    camera.position.set(span * 0.55, span * 0.95, span * 0.95);
    orbit.target.set(0, 0, 0); orbit.update();
    help.textContent = "Drag to orbit · scroll/pinch to zoom · click a room for details · double-click a room to walk in";
  } else {
    spawn(opts.room || selected);
    help.textContent = innerWidth < 760 ? "Drag left half to walk · drag right half to look" : "W A S D / arrow keys to walk · drag to look · Shift to walk faster";
  }
  void H;
}

function spawn(roomId) {
  const r = roomId && byId(roomId);
  if (r) {
    const p = freePoint(r);
    Object.assign(player, { x: p.x, z: p.z, pitch: 0 });
    // face the room's longer axis from where we stand
    player.yaw = r.w >= r.d ? (p.x > toW(r.x + r.w / 2, 0).x ? Math.PI / 2 : -Math.PI / 2) : (p.z > toW(0, r.y + r.d / 2).z ? 0 : Math.PI);
    return;
  }
  const fd = layout.frontDoor;
  if (fd) { // arrive outside the front door, facing it
    const out = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[fd.side];
    const px = fd.axis === "x" ? fd.at : fd.fixed, py = fd.axis === "x" ? fd.fixed : fd.at;
    const p = toW(px + out[0] * 3, py + out[1] * 3);
    Object.assign(player, { x: p.x, z: p.z, pitch: 0, yaw: Math.atan2(out[0], out[1]) });
    return;
  }
  if (plan.rooms[0]) return spawn(plan.rooms[0].id);
  Object.assign(player, { x: 0, z: 5, yaw: 0, pitch: 0 });
}

function freePoint(r) {
  const c = toW(r.x + r.w / 2, r.y + r.d / 2);
  const cands = [[0, 0]];
  for (let k = 1; k <= 4; k++) for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) cands.push([a * k * r.w / 10, b2 * k * r.d / 10]);
  for (const [dx, dz] of cands) if (!collides(c.x + dx, c.z + dz)) return { x: c.x + dx, z: c.z + dz };
  return c;
}

function collides(x, z) {
  for (const c of colliders) if (x > c.x1 - RADIUS && x < c.x2 + RADIUS && z > c.z1 - RADIUS && z < c.z2 + RADIUS) return true;
  return false;
}

// ---- walk input ----
const keys = new Set();
let joy = null, look = null;
addEventListener("keydown", (e) => {
  if (view !== "walk" || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  keys.add(e.code);
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

function setupWalkInput(canvas) {
  canvas.addEventListener("pointerdown", (e) => {
    if (view !== "walk") return;
    canvas.setPointerCapture(e.pointerId);
    const left = e.pointerType !== "mouse" && e.clientX - canvas.getBoundingClientRect().left < canvas.clientWidth / 2;
    if (left) joy = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    else look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (joy && e.pointerId === joy.id) { joy.dx = e.clientX - joy.x; joy.dy = e.clientY - joy.y; }
    if (look && e.pointerId === look.id) {
      player.yaw -= (e.clientX - look.x) * 0.0045;
      player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - (e.clientY - look.y) * 0.0045));
      look.x = e.clientX; look.y = e.clientY;
    }
  });
  const up = (e) => { if (joy?.id === e.pointerId) joy = null; if (look?.id === e.pointerId) look = null; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
}

function setupPicking(canvas) {
  const ray = new THREE.Raycaster(), m = new THREE.Vector2();
  let down = null;
  const pick = (e) => {
    const rc = canvas.getBoundingClientRect();
    m.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(m, camera);
    return ray.intersectObjects(floorMeshes)[0]?.object.userData.room || null;
  };
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("click", (e) => {
    if (view !== "overview" || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    selected = pick(e); renderPanel();
  });
  canvas.addEventListener("dblclick", (e) => { if (view !== "overview") return; const id = pick(e); if (id) { selected = id; setView("walk", { room: id }); } });
}

const clock = new THREE.Clock();
const v3 = new THREE.Vector3();
let lastRoom = undefined;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (view === "plan") return;
  if (view === "overview") {
    orbit.update();
    const w = host.clientWidth, h = host.clientHeight;
    for (const { d, p } of labelEls) {
      v3.copy(p).project(camera);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      d.style.display = vis ? "" : "none";
      if (vis) d.style.transform = `translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    }
  } else {
    let f = 0, s2 = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD")) s2 += 1;
    if (keys.has("KeyA")) s2 -= 1;
    if (keys.has("ArrowLeft") || keys.has("KeyQ")) player.yaw += 1.8 * dt;
    if (keys.has("ArrowRight") || keys.has("KeyE")) player.yaw -= 1.8 * dt;
    if (joy) { f -= Math.max(-1, Math.min(1, joy.dy / 60)); s2 += Math.max(-1, Math.min(1, joy.dx / 60)); }
    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 3.2 : 1.6) * dt;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const dx = (-sin * f + cos * s2) * speed, dz = (-cos * f - sin * s2) * speed;
    if (!collides(player.x + dx, player.z)) player.x += dx;
    if (!collides(player.x, player.z + dz)) player.z += dz;
    player.x = Math.max(-60, Math.min(60, player.x)); player.z = Math.max(-60, Math.min(60, player.z));
    camera.position.set(player.x, EYE, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    const here = roomAt(plan, player.x + centre.x, player.z + centre.y);
    if ((here?.id ?? null) !== lastRoom) {
      lastRoom = here?.id ?? null;
      hudRoom.replaceChildren(...(here
        ? [el("b", { text: here.name || ROOM_TYPES[here.type]?.label }), `${ROOM_TYPES[here.type]?.label} · ${fmt(area(here))} m²`]
        : [el("b", { text: "Outside" }), plan.name || ""]));
    }
    drawMinimap();
  }
  renderer.render(scene, camera);
}

function drawMinimap() {
  const ctx = minimap.getContext("2d");
  const W = minimap.width, Hh = minimap.height;
  const b = bounds(plan);
  const sc = Math.min((W - 20) / Math.max(b.w, 1), (Hh - 20) / Math.max(b.d, 1));
  const ox = (W - b.w * sc) / 2 - b.x * sc, oy = (Hh - b.d * sc) / 2 - b.y * sc;
  ctx.clearRect(0, 0, W, Hh);
  for (const r of plan.rooms) {
    ctx.fillStyle = r.id === lastRoom ? "#f0c27a" : (ROOM_TYPES[r.type] || ROOM_TYPES.living).fill;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(ox + r.x * sc, oy + r.y * sc, r.w * sc, r.d * sc);
    ctx.globalAlpha = 1; ctx.strokeStyle = "#333"; ctx.lineWidth = 1;
    ctx.strokeRect(ox + r.x * sc, oy + r.y * sc, r.w * sc, r.d * sc);
  }
  const px = ox + (player.x + centre.x) * sc, py = oy + (player.z + centre.y) * sc;
  ctx.save(); ctx.translate(px, py); ctx.rotate(-player.yaw);
  ctx.fillStyle = "#c2602f"; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- Start ----------
addEventListener("resize", () => { if (view === "plan") { fitPlan(); renderPlan(); } });
requestAnimationFrame(() => {
  // Deep links: #overview, #walk, #walk:<room id> (e.g. #walk:living)
  const [start, room] = decodeURIComponent(location.hash.slice(1)).split(":");
  if (start === "overview" || start === "walk") setView(start, { room: byId(room) ? room : null });
  else { fitPlan(); renderPlan(); renderPanel(); }
});
