# Floorplan Walkthrough (prototype)

Draw and label rooms in 2D, then walk through them in 3D in the browser.

This is an early prototype for an AI floorplanner aimed at South Africa. Later
the floor plan would come from photos or a phone scan; for now you draw it
yourself. That way we can first test whether the 2D → 3D → walk-through step
feels right.

## What it does

1. **Plan**: drag to draw rooms, give each one a name and type (living room,
   bedroom, scullery, stoep, ...). Edges snap to neighbouring rooms.
   Doors and windows are added automatically:
   - a door between two rooms when at least one is a shared space (passage,
     living room, kitchen, ...); you can switch each door on/off per room
   - windows on outside walls of habitable rooms, small high windows for
     bathrooms and sculleries
   - a front door on the entrance hall, sliding doors to the stoep
2. **3D model**: a dollhouse view with the ceilings off. Click a room for
   details, double-click it to walk in.
3. **Walk through**: first-person, with furniture, ceilings and lighting.
   A minimap shows where you are.
   - Desktop: `W A S D` or the arrow keys, drag to look around, `Shift` to go faster
   - Phone/tablet: drag on the left half to walk, on the right half to look

There's also a **simplified check inspired by SANS 10400** per room: natural
light (glazing ≥ 10% of the floor area), ventilation (≥ 5%) and ceiling height
(≥ 2.4 m). It's indicative only, not a compliance tool.

Plans are saved in your browser. Use Export/Import to share a plan as JSON.
Deep links: `#overview`, `#walk`, `#walk:living` (walk in from a room id).

## Run it locally

No build step needed. It just needs a local web server, because ES modules
don't load from `file://`:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

Tests for the geometry (walls, doors, windows, checks): `npm test` (Node 18+).

## Structure

- `layout.js`: pure geometry: rooms → walls with openings, furniture, checks, sample house
- `app.js`: 2D editor (SVG), 3D scene and walk controls (three.js)
- `vendor/`: three.js r160 (MIT)

## Ideas for next steps

- Floor plan from photos / a guided phone scan (LiDAR) instead of drawing
- Non-rectangular rooms, multiple floors, roof
- Materials and furniture from a moodboard or reference images
- Fuller SANS 10400 rules, compared against the municipality's approved plans
