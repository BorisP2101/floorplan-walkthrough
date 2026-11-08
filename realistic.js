// Realistic look for the 3D views: procedural materials (drawn on canvases, so no
// image files are needed), image-based daylight, and furniture with real shapes.
// Everything here is used only when the "Realistic" style is on.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { DEFAULT_FLOORS } from "./layout.js";

// ---------- procedural textures ----------
const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
function canvasTex(size, draw, { srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;
function noise(ctx, n, r, alpha, light, dark) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = r() > 0.5 ? light : dark;
    ctx.globalAlpha = alpha * r();
    ctx.fillRect(r() * ctx.canvas.width, r() * ctx.canvas.height, 1 + r() * 2, 1 + r() * 2);
  }
  ctx.globalAlpha = 1;
}
// Each entry: [texture factory, metres covered by one texture tile, roughness]
const FLOORS = {
  oak: [() => planks(34, 45, 62, 7), 2.4, 0.55],
  walnut: [() => planks(25, 40, 34, 6), 2.4, 0.5],
  pine: [() => planks(38, 55, 70, 8), 2.4, 0.6],
  tiles: [() => tiles("#d9d6cf", "#b9b4aa", 4), 1.2, 0.35],
  terrazzo: [() => terrazzo(), 1.6, 0.4],
  concrete: [() => concrete(), 3, 0.8],
  slate: [() => tiles("#6f6f6a", "#4e4e4a", 2, true), 1.2, 0.75],
  carpet: [() => carpet(), 1, 0.95],
};
function planks(h, s, l, rows) {
  return canvasTex(1024, (ctx, S) => {
    const r = rand(h * 97 + l);
    const ph = S / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r() * S * 0.5;
      while (x < S) {
        const len = S * (0.35 + r() * 0.5);
        ctx.fillStyle = hsl(h + (r() - 0.5) * 4, s + (r() - 0.5) * 8, l + (r() - 0.5) * 9);
        ctx.fillRect(x, row * ph, len, ph);
        // grain
        ctx.strokeStyle = hsl(h, s, l - 12);
        for (let g = 0; g < 7; g++) {
          ctx.globalAlpha = 0.12 + r() * 0.12;
          ctx.beginPath();
          const y0 = row * ph + r() * ph;
          ctx.moveTo(x, y0);
          for (let k = 0; k <= 8; k++) ctx.lineTo(x + (len * k) / 8, y0 + Math.sin(k * 1.3 + r() * 2) * ph * 0.05);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(40,25,10,.55)";
        ctx.fillRect(x, row * ph, 2, ph); // end joint
        x += len;
      }
      ctx.fillStyle = "rgba(40,25,10,.5)";
      ctx.fillRect(0, row * ph, S, 2); // long seam
    }
  });
}
function tiles(base, grout, n, irregular = false) {
  return canvasTex(512, (ctx, S) => {
    const r = rand(n * 31 + (irregular ? 7 : 1));
    ctx.fillStyle = grout; ctx.fillRect(0, 0, S, S);
    const t = S / n, g = irregular ? 5 : 3;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = base;
      ctx.filter = `brightness(${0.94 + r() * 0.12})`;
      ctx.fillRect(i * t + g, j * t + g, t - 2 * g, t - 2 * g);
    }
    ctx.filter = "none";
    noise(ctx, 6000, r, 0.25, "#fff", "#000");
  });
}
function terrazzo() {
  return canvasTex(512, (ctx, S) => {
    const r = rand(5);
    ctx.fillStyle = "#e6e2da"; ctx.fillRect(0, 0, S, S);
    const cols = ["#9a8f80", "#c9b8a0", "#7d7a74", "#b4a28c", "#f5f2ec"];
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      ctx.beginPath(); ctx.ellipse(r() * S, r() * S, 1 + r() * 5, 1 + r() * 4, r() * 3, 0, 7); ctx.fill();
    }
  });
}
function concrete() {
  return canvasTex(512, (ctx, S) => {
    const r = rand(11);
    ctx.fillStyle = "#a7a49e"; ctx.fillRect(0, 0, S, S);
    noise(ctx, 30000, r, 0.35, "#c9c6c0", "#7f7c77");
  });
}
function carpet() {
  return canvasTex(256, (ctx, S) => {
    const r = rand(3);
    ctx.fillStyle = "#b9ad9b"; ctx.fillRect(0, 0, S, S);
    noise(ctx, 20000, r, 0.5, "#d2c7b6", "#968a78");
  });
}
let shared = null;
function sharedTextures() {
  if (shared) return shared;
  shared = {
    plaster: canvasTex(512, (ctx, S) => { const r = rand(17); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, S, S); noise(ctx, 26000, r, 0.06, "#ffffff", "#b0aaa0"); }),
    grass: canvasTex(512, (ctx, S) => {
      const r = rand(23);
      ctx.fillStyle = "#6f8f45"; ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 26000; i++) { ctx.fillStyle = hsl(80 + r() * 25, 35 + r() * 20, 26 + r() * 22); ctx.fillRect(r() * S, r() * S, 1, 2 + r() * 3); }
    }),
    fabric: canvasTex(256, (ctx, S) => { const r = rand(29); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, S, S); noise(ctx, 12000, r, 0.07, "#ffffff", "#8a8a8a"); }),
    floors: {},
  };
  return shared;
}

// ---------- environment ----------
let envTex = null, skyTex = null;
export function applyEnvironment(scene, renderer, realistic) {
  if (!realistic) { scene.environment = null; scene.background = new THREE.Color(0xcfe3f0); scene.fog = new THREE.Fog(0xcfe3f0, 30, 90); renderer.toneMappingExposure = 1; return; }
  if (!envTex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
  }
  if (!skyTex) {
    skyTex = canvasTex(256, (ctx, S) => {
      const g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, "#5f93c9"); g.addColorStop(0.55, "#a9cbe8"); g.addColorStop(1, "#e9eef0");
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    });
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
  }
  scene.environment = envTex;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xdfe8ee, 40, 140);
  renderer.toneMappingExposure = 0.8;
}

// ---------- materials ----------
export function realisticMaterials(plan) {
  const T = sharedTextures();
  const wallColor = new THREE.Color(plan.style?.walls || "#efe9df");
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const floorFor = (room, w, d) => {
    const kind = plan.style?.floors?.[room.id] || plan.style?.floors?.[room.type] || DEFAULT_FLOORS[room.type] || "oak";
    const [make, size, rough] = FLOORS[kind] || FLOORS.oak;
    T.floors[kind] ||= make();
    const map = T.floors[kind].clone();
    map.needsUpdate = true;
    map.repeat.set(w / size, d / size);
    return std({ map, roughness: rough, metalness: 0, envMapIntensity: 0.9 });
  };
  const ground = std({ map: (() => { const g = T.grass.clone(); g.needsUpdate = true; g.repeat.set(60, 60); return g; })(), roughness: 1 });
  return {
    wall: std({ color: wallColor, map: T.plaster, roughness: 0.92, envMapIntensity: 0.45 }),
    ceiling: std({ color: 0xfbfaf7, roughness: 0.95, envMapIntensity: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xdfeef7, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.5 }),
    frame: std({ color: 0xf6f4ef, roughness: 0.5 }),
    door: std({ color: 0xf3f0ea, roughness: 0.45 }),
    sill: std({ color: 0xd8d4cc, roughness: 0.4 }),
    ground,
    floorFor,
  };
}

// ---------- furniture ----------
const cache = {};
function M(key, make) { return (cache[key] ||= make()); }
const mat = {
  wood: () => M("wood", () => new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.55 })),
  lightwood: () => M("lightwood", () => new THREE.MeshStandardMaterial({ color: 0xb48a5e, roughness: 0.6 })),
  fabric: (c) => M("fabric" + c, () => new THREE.MeshStandardMaterial({ color: c, map: sharedTextures().fabric, roughness: 0.95 })),
  matte: (c, r = 0.6) => M("matte" + c + r, () => new THREE.MeshStandardMaterial({ color: c, roughness: r })),
  ceramic: () => M("ceramic", () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 0.6 })),
  metal: () => M("metal", () => new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.3, metalness: 0.9 })),
  stone: () => M("stone", () => new THREE.MeshStandardMaterial({ color: 0x2f2f30, roughness: 0.25, metalness: 0.1 })),
  leaf: () => M("leaf", () => new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.8 })),
};
function part(g, geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
function legs(g, w, d, h, inset, material, r = 0.025) {
  const geo = new THREE.CylinderGeometry(r, r * 0.8, h, 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, geo, material, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset));
}

// Builds one furniture item in local coordinates: x along the wall it stands
// against, z away from that wall (the "front"), y up. Returns null to fall back to a box.
export function furnitureMesh(f) {
  // local size: along-wall width and depth, whatever the wall's direction
  const alongX = f.side === "N" || f.side === "S";
  const w = alongX ? f.sx : f.sy, d = alongX ? f.sy : f.sx, h = f.h;
  const g = new THREE.Group();
  switch (f.kind) {
    case "bed":
      part(g, new THREE.BoxGeometry(w, 0.22, d), mat.wood(), 0, 0.17, 0);
      part(g, rbox(w - 0.04, 0.2, d - 0.04, 0.06), mat.fabric(0xf7f5f0), 0, 0.38, 0);
      part(g, rbox(w + 0.02, 0.08, d * 0.62, 0.04), mat.fabric(0xc9c2b3), 0, 0.5, d * 0.18); // duvet
      break;
    case "pillows":
      for (const sx of w > 1.2 ? [-0.25, 0.25] : [0]) part(g, rbox(Math.min(0.6, w / 2.2), 0.14, 0.38, 0.07), mat.fabric(0xffffff), sx * w, 0.55, 0);
      break;
    case "headboard":
      part(g, rbox(w, h, d, 0.03), mat.fabric(0x8f8676), 0, h / 2, 0);
      break;
    case "sidetable":
      part(g, rbox(w, 0.42, d, 0.02), mat.lightwood(), 0, 0.29, 0);
      part(g, new THREE.CylinderGeometry(0.07, 0.09, 0.28, 16), mat.matte(0xe9e3d8, 0.4), 0, 0.64, 0);
      break;
    case "sofa":
      part(g, rbox(w, 0.42, d, 0.08), mat.fabric(0x6b7480), 0, 0.27, 0);
      for (const sx of [-1, 1]) part(g, rbox(0.2, 0.62, d, 0.06), mat.fabric(0x5f6873), sx * (w / 2 - 0.1), 0.37, 0);
      for (const sx of w > 1.8 ? [-0.25, 0.25] : [0]) part(g, rbox(w / (w > 1.8 ? 2.4 : 1.3), 0.16, d - 0.3, 0.07), mat.fabric(0x7a8490), sx * w, 0.53, 0.06);
      break;
    case "sofaback":
      part(g, rbox(w, h - 0.06, d + 0.05, 0.07), mat.fabric(0x5f6873), 0, (h - 0.06) / 2 + 0.06, 0);
      break;
    case "coffeetable":
      part(g, rbox(w, 0.05, d, 0.02), mat.lightwood(), 0, h - 0.025, 0);
      legs(g, w, d, h - 0.05, 0.06, mat.matte(0x222222, 0.4), 0.015);
      break;
    case "rug":
      part(g, new THREE.BoxGeometry(w, 0.012, d), mat.fabric(0xd4c7b0), 0, 0.006, 0);
      break;
    case "plant":
      part(g, new THREE.CylinderGeometry(0.17, 0.13, 0.36, 20), mat.matte(0xd9d2c5, 0.7), 0, 0.18, 0);
      for (let i = 0; i < 6; i++) { const a = i * 1.05; part(g, new THREE.SphereGeometry(0.16 + (i % 3) * 0.03, 12, 10), mat.leaf(), Math.cos(a) * 0.12, 0.6 + (i % 3) * 0.22, Math.sin(a) * 0.12); }
      break;
    case "counter": {
      part(g, new THREE.BoxGeometry(w, h - 0.1, d), mat.matte(0xf2efe9, 0.45), 0, (h - 0.1) / 2 + 0.1, 0);
      part(g, new THREE.BoxGeometry(w - 0.02, 0.1, d - 0.06), mat.matte(0x2b2b2b, 0.8), 0, 0.05, -0.03);
      const n = Math.max(1, Math.round(w / 0.6));
      for (let i = 1; i < n; i++) part(g, new THREE.BoxGeometry(0.006, h - 0.16, 0.01), mat.matte(0xc9c4ba), -w / 2 + (i * w) / n, (h - 0.16) / 2 + 0.12, d / 2 + 0.001);
      for (let i = 0; i < n; i++) part(g, new THREE.BoxGeometry(0.16, 0.012, 0.02), mat.metal(), -w / 2 + ((i + 0.5) * w) / n, h - 0.12, d / 2 + 0.01);
      // wall cabinets above, unless there's a window in that wall
      if (!f.window) part(g, new THREE.BoxGeometry(w, 0.7, 0.34), mat.matte(0xf2efe9, 0.45), 0, 1.85, -d / 2 + 0.17);
      break;
    }
    case "countertop":
      part(g, new THREE.BoxGeometry(w, 0.04, d), mat.stone(), 0, f.elev + 0.02, 0);
      if (w > 1.2) part(g, new THREE.BoxGeometry(0.5, 0.012, 0.38), mat.metal(), w / 4, f.elev + 0.035, 0); // sink
      return g;
    case "island":
      part(g, new THREE.BoxGeometry(w, h - 0.04, d), mat.wood(), 0, (h - 0.04) / 2, 0);
      part(g, new THREE.BoxGeometry(w + 0.04, 0.04, d + 0.04), mat.stone(), 0, h - 0.02, 0);
      break;
    case "diningtable":
    case "patiotable": {
      part(g, rbox(w, 0.04, d, 0.015), f.kind === "patiotable" ? mat.matte(0x7a5a3c, 0.8) : mat.wood(), 0, h - 0.02, 0);
      legs(g, w, d, h - 0.04, 0.08, f.kind === "patiotable" ? mat.matte(0x333333, 0.5) : mat.wood(), 0.03);
      const chairs = f.kind === "patiotable" ? [[-w / 2 - 0.3, 0], [w / 2 + 0.3, 0]] : [[-w / 4, d / 2 + 0.35], [w / 4, d / 2 + 0.35], [-w / 4, -d / 2 - 0.35], [w / 4, -d / 2 - 0.35]];
      for (const [cx, cz] of chairs) {
        part(g, rbox(0.44, 0.05, 0.44, 0.02), mat.matte(0x3a3a3a, 0.6), cx, 0.45, cz);
        part(g, rbox(0.44, 0.4, 0.04, 0.02), mat.matte(0x3a3a3a, 0.6), cx, 0.68, cz + Math.sign(cz || 1) * 0.2);
        const lg = new THREE.Group(); legs(lg, 0.44, 0.44, 0.43, 0.04, mat.metal(), 0.012); lg.position.set(cx, 0, cz); g.add(lg);
      }
      break;
    }
    case "desk":
      part(g, rbox(w, 0.04, d, 0.015), mat.lightwood(), 0, h - 0.02, 0);
      legs(g, w, d, h - 0.04, 0.05, mat.matte(0x222222, 0.4), 0.02);
      part(g, new THREE.BoxGeometry(0.55, 0.32, 0.02), mat.matte(0x111111, 0.3), 0, h + 0.2, -d / 2 + 0.1);
      break;
    case "chair":
      part(g, rbox(w, 0.08, d, 0.03), mat.fabric(0x333333), 0, 0.48, 0);
      part(g, rbox(w, 0.5, 0.06, 0.03), mat.fabric(0x333333), 0, 0.78, d / 2 - 0.03);
      part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.44, 10), mat.metal(), 0, 0.22, 0);
      break;
    case "bath":
      part(g, rbox(w, h, d, 0.08), mat.ceramic(), 0, h / 2, 0);
      part(g, rbox(w - 0.16, 0.04, d - 0.16, 0.06), mat.matte(0xcfe3ea, 0.1), 0, h - 0.03, 0);
      break;
    case "toilet":
      part(g, rbox(w * 0.85, 0.4, d * 0.7, 0.12), mat.ceramic(), 0, 0.2, d * 0.1);
      part(g, rbox(w, 0.38, 0.18, 0.04), mat.ceramic(), 0, 0.6, -d / 2 + 0.09);
      break;
    case "braai":
      part(g, rbox(w, 0.5, d, 0.04), mat.matte(0x8a8378, 0.9), 0, 0.25, 0);
      part(g, new THREE.BoxGeometry(w - 0.1, 0.35, d - 0.1), mat.matte(0x2a2a2a, 0.7), 0, 0.68, 0);
      part(g, new THREE.BoxGeometry(w - 0.12, 0.01, d - 0.12), mat.metal(), 0, 0.86, 0);
      break;
    default:
      return null;
  }
  return g;
}

// Rotation that turns the item's local front (+z) away from the wall it stands against.
export const FACING = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 };
