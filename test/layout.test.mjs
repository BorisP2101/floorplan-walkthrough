import { computeLayout, sampleHouse, checks, neighbours } from "../layout.js";
import assert from "node:assert/strict";
const plan = sampleHouse();
const L = computeLayout(plan);
const doors = L.walls.flatMap(w => w.openings.filter(o => o.kind !== "window").map(o => [w.rooms.join("+"), o.kind]));
console.log(doors.map(d => d.join(" ")).join("\n"));
assert.ok(L.frontDoor && L.frontDoor.room === "entrance", "front door on entrance");
for (const r of plan.rooms) {
  const pr = L.perRoom[r.id];
  assert.ok(pr.doors > 0 || pr.front, `${r.id} reachable`);
  const bad = checks(plan, L, r).filter(c => !c.ok);
  if (bad.length) console.log("check:", r.id, bad.map(c => c.text));
}
assert.ok(!doors.some(([k]) => k === "bed2+bed3"), "no door between bedrooms");
assert.ok(doors.some(([k]) => k === "main+ensuite"), "ensuite door");
assert.equal(neighbours(plan, plan.rooms.find(r => r.id === "bed2")).length, 2);
console.log("walls", L.walls.length, "furniture", L.furniture.length, "OK");
