// Pure geometry: turns a plan (labelled rectangles in metres) into walls with
// door and window openings, furniture and simple regulation checks.
// No DOM, no three.js, so it can be tested with plain Node.

export const ROOM_TYPES = {
  living:   { label: "Living room",  fill: "#f3d9b8", floor: 0xb8875a, habitable: true,  shared: true },
  kitchen:  { label: "Kitchen",      fill: "#f6e7a6", floor: 0xd8d4cc, habitable: true,  shared: true },
  dining:   { label: "Dining room",  fill: "#efc9a4", floor: 0xb08158, habitable: true,  shared: true },
  bedroom:  { label: "Bedroom",      fill: "#cfe0f3", floor: 0xc9a27a, habitable: true,  shared: false },
  study:    { label: "Study",        fill: "#d9d2ef", floor: 0xbf9a70, habitable: true,  shared: false },
  bathroom: { label: "Bathroom",     fill: "#c6ebe8", floor: 0xcfe0e3, habitable: false, shared: false },
  utility:  { label: "Scullery / laundry", fill: "#e3e7cf", floor: 0xd0ccc0, habitable: false, shared: false },
  passage:  { label: "Passage",      fill: "#ece6dc", floor: 0xa9896a, habitable: false, shared: true },
  entrance: { label: "Entrance hall",fill: "#e9dfd0", floor: 0xa9896a, habitable: false, shared: true },
  garage:   { label: "Garage",       fill: "#dcdcdc", floor: 0x9b9b98, habitable: false, shared: false },
  patio:    { label: "Stoep / patio",fill: "#d7e6c8", floor: 0x9a948a, habitable: false, shared: true, open: true },
};

export const EPS = 0.005;
const r2 = (v) => Math.round(v * 100) / 100;
export const area = (r) => r2(r.w * r.d);
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Four edges of a room. "side" is the compass side in plan view (north = top).
export function edgesOf(r) {
  return [
    { side: "N", axis: "x", fixed: r.y,       a: r.x, b: r.x + r.w },
    { side: "S", axis: "x", fixed: r.y + r.d, a: r.x, b: r.x + r.w },
    { side: "W", axis: "y", fixed: r.x,       a: r.y, b: r.y + r.d },
    { side: "E", axis: "y", fixed: r.x + r.w, a: r.y, b: r.y + r.d },
  ];
}
const OPPOSITE = { N: "S", S: "N", W: "E", E: "W" };

export function overlaps(p, q) {
  return p.x < q.x + q.w - EPS && q.x < p.x + p.w - EPS && p.y < q.y + q.d - EPS && q.y < p.y + p.d - EPS;
}

// Intervals of edge e (of room i) that touch a neighbouring room's opposite edge.
function sharedIntervals(plan, i, e) {
  const out = [];
  plan.rooms.forEach((q, j) => {
    if (j === i) return;
    const f = edgesOf(q).find((x) => x.side === OPPOSITE[e.side]);
    if (Math.abs(f.fixed - e.fixed) > EPS) return;
    const a = Math.max(e.a, f.a), b = Math.min(e.b, f.b);
    if (b - a > 0.05) out.push({ a, b, j });
  });
  return out.sort((p, q) => p.a - q.a);
}

function subtract(a, b, cuts) {
  const out = [];
  let cur = a;
  for (const c of cuts) {
    if (c.a > cur + EPS) out.push({ a: cur, b: Math.min(c.a, b) });
    cur = Math.max(cur, c.b);
  }
  if (b > cur + EPS) out.push({ a: cur, b });
  return out.filter((s) => s.b - s.a > 0.05);
}

// Default rule: a door between two rooms when at least one of them is a shared
// space (living, kitchen, passage, ...). Bedroom-bedroom gets no door.
// plan.doors overrides it per pair: { "idA|idB": true/false }.
export function hasDoor(plan, p, q) {
  const k = pairKey(p.id, q.id);
  if (plan.doors && k in plan.doors) return plan.doors[k];
  return !!(ROOM_TYPES[p.type]?.shared || ROOM_TYPES[q.type]?.shared);
}

function centred(a, b, w) {
  const m = (a + b) / 2;
  return { a: m - w / 2, b: m + w / 2 };
}

export function computeLayout(plan) {
  const H = plan.wallHeight || 2.6;
  const walls = [];
  const perRoom = Object.fromEntries(plan.rooms.map((r) => [r.id, { doorSides: new Set(), glazing: 0, doors: 0, front: false }]));
  let frontDoor = null;

  plan.rooms.forEach((r, i) => {
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.living;
    for (const e of edgesOf(r)) {
      const shared = sharedIntervals(plan, i, e);
      // Shared walls: build once, from the room with the lower index.
      for (const s of shared) {
        if (s.j < i) continue;
        const q = plan.rooms[s.j];
        const tq = ROOM_TYPES[q.type] || ROOM_TYPES.living;
        const outdoor = t.open || tq.open;
        const wall = { axis: e.axis, fixed: e.fixed, a: s.a, b: s.b, thick: outdoor ? 0.22 : 0.11, openings: [], rooms: [r.id, q.id] };
        if (hasDoor(plan, r, q)) {
          const len = s.b - s.a;
          let w = outdoor ? Math.min(2.4, len - 0.4) : 0.9;
          if (len < w + 0.2) w = len - 0.2;
          if (w >= 0.7) {
            wall.openings.push({ ...centred(s.a, s.b, w), bottom: 0, top: Math.min(outdoor ? 2.2 : 2.1, H - 0.1), kind: outdoor ? "slider" : "door" });
            perRoom[r.id].doorSides.add(e.side); perRoom[q.id].doorSides.add(OPPOSITE[e.side]);
            perRoom[r.id].doors++; perRoom[q.id].doors++;
            if (outdoor) {
              const glass = w * Math.min(2.2, H - 0.1);
              if (!t.open) perRoom[r.id].glazing += glass;
              if (!tq.open) perRoom[q.id].glazing += glass;
            }
          }
        }
        walls.push(wall);
      }
      if (t.open) continue; // a stoep has no outer walls
      // Exterior walls: windows for habitable rooms, a front door for the entrance.
      for (const s of subtract(e.a, e.b, shared)) {
        const len = s.b - s.a;
        const wall = { axis: e.axis, fixed: e.fixed, a: s.a, b: s.b, thick: 0.22, openings: [], rooms: [r.id], exterior: true, side: e.side };
        if (r.type === "entrance" && !frontDoor && len >= 1.3) {
          const o = { ...centred(s.a, s.b, 1.0), bottom: 0, top: Math.min(2.1, H - 0.1), kind: "front" };
          wall.openings.push(o);
          frontDoor = { room: r.id, side: e.side, axis: e.axis, fixed: e.fixed, at: (o.a + o.b) / 2 };
          perRoom[r.id].doorSides.add(e.side); perRoom[r.id].front = true;
        } else if (t.habitable && len >= 1.0) {
          const w = Math.max(0.6, Math.min(2.4, len * 0.45));
          const o = { ...centred(s.a, s.b, w), bottom: 0.9, top: Math.min(2.1, H - 0.1), kind: "window" };
          wall.openings.push(o);
          perRoom[r.id].glazing += w * (o.top - o.bottom);
        } else if ((r.type === "bathroom" || r.type === "utility" || r.type === "kitchen") && len >= 0.9) {
          const o = { ...centred(s.a, s.b, 0.6), bottom: 1.5, top: Math.min(2.1, H - 0.1), kind: "window" };
          wall.openings.push(o);
          perRoom[r.id].glazing += 0.6 * (o.top - o.bottom);
        }
        walls.push(wall);
      }
    }
  });

  const furniture = plan.rooms.flatMap((r) => furnish(r, perRoom[r.id].doorSides));
  return { walls, perRoom, frontDoor, furniture, H };
}

// Simplified checks inspired by SANS 10400 (Part O: natural lighting and
// ventilation; Part C: room height). Indicative only, not a compliance tool.
export function checks(plan, layout, r) {
  const t = ROOM_TYPES[r.type] || ROOM_TYPES.living;
  const pr = layout.perRoom[r.id];
  const a = area(r);
  const out = [];
  if (t.habitable) {
    const need = Math.max(0.2, 0.1 * a);
    out.push({ ok: pr.glazing >= need - 1e-6, text: `Natural light: ${pr.glazing.toFixed(2)} m² glazing, needs ≥ ${need.toFixed(2)} m² (10% of floor)` });
    const vent = pr.glazing * 0.5, needV = 0.05 * a;
    out.push({ ok: vent >= needV - 1e-6, text: `Ventilation: ~${vent.toFixed(2)} m² openable, needs ≥ ${needV.toFixed(2)} m² (5% of floor)` });
    out.push({ ok: (plan.wallHeight || 2.6) >= 2.4, text: `Ceiling height ${(plan.wallHeight || 2.6).toFixed(2)} m, needs ≥ 2.40 m` });
  }
  if (!t.open && pr.doors === 0 && !pr.front) out.push({ ok: false, text: "No door: this room can't be reached" });
  return out;
}

// Furniture as simple boxes, placed against a wall without a door.
// Each item: { cx, cy, sx, sy, h, elev, color } in plan metres.
export function furnish(r, doorSides) {
  const order = ["N", "E", "S", "W"];
  const free = order.filter((s) => !doorSides.has(s));
  const side = free[0] || "N";
  const along = side === "N" || side === "S" ? r.w : r.d;
  const deep = side === "N" || side === "S" ? r.d : r.w;
  const items = [];
  // u: offset from the wall's centre along it; v: distance from wall to item centre.
  const put = (u, v, w, d, h, color, elev = 0) => {
    if (w <= 0 || d <= 0) return;
    let cx, cy, sx, sy;
    if (side === "N") { cx = r.x + r.w / 2 + u; cy = r.y + v; sx = w; sy = d; }
    if (side === "S") { cx = r.x + r.w / 2 + u; cy = r.y + r.d - v; sx = w; sy = d; }
    if (side === "W") { cx = r.x + v; cy = r.y + r.d / 2 + u; sx = d; sy = w; }
    if (side === "E") { cx = r.x + r.w - v; cy = r.y + r.d / 2 + u; sx = d; sy = w; }
    items.push({ cx, cy, sx, sy, h, elev, color, room: r.id });
  };
  const gap = 0.12;
  switch (r.type) {
    case "bedroom": {
      if (along < 2.2 || deep < 2.6) break;
      const bw = Math.min(r.w * r.d > 11 ? 1.8 : 1.4, along - 1.2);
      put(0, gap + 1.0, bw, 2.0, 0.5, 0xf4f1ea);
      put(0, gap + 0.05, bw + 0.1, 0.08, 1.05, 0x6b4a32);
      put(0, gap + 0.35, bw - 0.2, 0.35, 0.62, 0xffffff);
      if (along > bw + 1.2) { put(-(bw / 2 + 0.3), gap + 0.22, 0.45, 0.4, 0.5, 0x8a6446); put(bw / 2 + 0.3, gap + 0.22, 0.45, 0.4, 0.5, 0x8a6446); }
      break;
    }
    case "living": {
      if (along < 2.8 || deep < 3) break;
      put(0, gap + 0.45, Math.min(2.4, along - 1), 0.9, 0.45, 0x5d6b7a);
      put(0, gap + 0.1, Math.min(2.4, along - 1), 0.2, 0.85, 0x56626f);
      put(0, gap + 1.6, 1.1, 0.6, 0.42, 0x7a5434);
      put(0, gap + 1.55, Math.min(2.6, along - 0.6), Math.min(2.0, deep - 1.6), 0.01, 0xd9cdb8);
      break;
    }
    case "kitchen": {
      put(0, 0.3 + gap / 2, along - 0.25, 0.6, 0.9, 0xe8e4dc);
      put(0, 0.3 + gap / 2, along - 0.25, 0.62, 0.04, 0x3a3a3a, 0.9);
      if (deep > 3.6 && along > 2.6) put(0, gap + 2.0, Math.min(1.8, along - 1.4), 0.9, 0.92, 0x8b6b4a);
      break;
    }
    case "utility":
      put(0, 0.3 + gap / 2, along - 0.25, 0.6, 0.9, 0xdcd8cf);
      break;
    case "dining": {
      if (along < 2.4 || deep < 2.6) break;
      put(0, deep / 2, Math.min(1.8, along - 1.4), 0.9, 0.75, 0x7a5434);
      break;
    }
    case "study":
      if (along >= 1.6) { put(0, gap + 0.35, Math.min(1.4, along - 0.4), 0.7, 0.75, 0x8a6446); put(0, gap + 1.05, 0.5, 0.5, 0.48, 0x333333); }
      break;
    case "bathroom": {
      if (along >= 1.8) put(along / 2 - 0.9 - 0.02, gap + 0.36, 1.7, 0.72, 0.55, 0xffffff);
      if (along >= 1.3) put(-(along / 2 - 0.35), gap + 0.3, 0.45, 0.6, 0.42, 0xffffff);
      break;
    }
    case "patio": {
      if (along >= 2.4 && deep >= 2.2) {
        put(-along / 4, deep / 2, 1.2, 0.8, 0.74, 0x6e5034);
        put(along / 2 - 0.6, 0.5, 0.8, 0.5, 0.85, 0x4b4b4b); // braai
      }
      break;
    }
  }
  return items;
}

// Rooms that share a wall with r, long enough for a door.
export function neighbours(plan, r) {
  const i = plan.rooms.indexOf(r);
  const seen = new Map();
  for (const e of edgesOf(r)) {
    for (const s of sharedIntervals(plan, i, e)) {
      if (s.b - s.a >= 0.9) seen.set(plan.rooms[s.j].id, plan.rooms[s.j]);
    }
  }
  return [...seen.values()];
}

export function roomAt(plan, x, y) {
  return plan.rooms.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d) || null;
}

export function bounds(plan) {
  if (!plan.rooms.length) return { x: 0, y: 0, w: 12, d: 10 };
  const x = Math.min(...plan.rooms.map((r) => r.x)), y = Math.min(...plan.rooms.map((r) => r.y));
  const X = Math.max(...plan.rooms.map((r) => r.x + r.w)), Y = Math.max(...plan.rooms.map((r) => r.y + r.d));
  return { x, y, w: X - x, d: Y - y };
}

// A generic South African 3-bedroom house with stoep, scullery and en-suite.
export function sampleHouse() {
  return {
    name: "Sample 3-bedroom house",
    wallHeight: 2.6,
    rooms: [
      { id: "stoep",    name: "Stoep",          type: "patio",    x: 0,    y: 0,   w: 6,   d: 3 },
      { id: "living",   name: "Living room",    type: "living",   x: 0,    y: 3,   w: 6,   d: 5 },
      { id: "kitchen",  name: "Kitchen",        type: "kitchen",  x: 6,    y: 3,   w: 3.5, d: 5 },
      { id: "scullery", name: "Scullery",       type: "utility",  x: 9.5,  y: 3,   w: 1.5, d: 5 },
      { id: "entrance", name: "Entrance hall",  type: "entrance", x: 11,   y: 3,   w: 3,   d: 5 },
      { id: "passage",  name: "Passage",        type: "passage",  x: 0,    y: 8,   w: 14,  d: 1.4 },
      { id: "bed2",     name: "Bedroom 2",      type: "bedroom",  x: 0,    y: 9.4, w: 3.5, d: 4 },
      { id: "bed3",     name: "Bedroom 3",      type: "bedroom",  x: 3.5,  y: 9.4, w: 3.5, d: 4 },
      { id: "bath",     name: "Bathroom",       type: "bathroom", x: 7,    y: 9.4, w: 2.5, d: 4 },
      { id: "main",     name: "Main bedroom",   type: "bedroom",  x: 9.5,  y: 9.4, w: 3,   d: 4 },
      { id: "ensuite",  name: "En-suite",       type: "bathroom", x: 12.5, y: 9.4, w: 1.5, d: 4 },
    ],
    doors: {
      [pairKey("main", "ensuite")]: true,
      [pairKey("passage", "ensuite")]: false,
      [pairKey("scullery", "entrance")]: false,
      [pairKey("scullery", "passage")]: false,
    },
  };
}
