# Spider-Man's apartment — NOTES

Files: `apartment.glb` (top floor of building B0818 + roof), `window_a.glb` (+ `window_a.glb.clips.json`).
Regenerate: `python3 next/blender/city/posters.py` (once), then
`/Applications/Blender.app/Contents/MacOS/Blender --background --python next/blender/city/build_apartment.py`,
then `python3 next/blender/city/walkcheck.py apartment --path next/assets/bases/apartment/apartment.walkpath.json`
and `v3/tools/sync-next-slim.sh`. (v1 script kept as `build_apartment_v1.py`.)

**Space:** origin = NW corner of the lot at the apartment floor; lot x 0..24 (east), z 0..25 (south);
street facade z = 0 faces −Z, avenue facade x = 0 faces −X. Floor 0, ceiling 3.55, roof 3.9, parapet 4.95.
The city places it at `layout.bases.apartment` (world −585, 20.2, 650).

**Markers:** `win_01..win_10` (WIN-A frames, each receives one `window_a.glb` instance), `spawn_spider`,
`roof_hatch` (moved 2026-09-26, see below), `roof_access`, `prop_water_tower`, `prop_fire_escape_top` (extras `kit`, `variant`, `scale`),
`light_*` (extras `light` omni|spot, `energy_w`, `color`, `range`).

**WIN-A** (CONTRACT §10): origin bottom-centre of the opening at sill level, +Y up, glass z = 0, room +Z.
Opening 1.40 × 2.10, sill 0.45 above the floor. Nodes `window_a / win_frame, win_leafL` (hinge x −0.70),
`win_leafR` (hinge +0.70), `win_handle` (child of the right leaf, pivot (0, 0.65, 0.03), turns about local Z).
Clips:
- `window_open` 1.4 s, not looped: hand on handle by 0.35, handle 90° 0.35–0.55, right leaf pushed open
  0.55–1.4 (100° out, towards −Z), left follows 0.08 s later. Events: 0.35 `city_window_unlatch` @win_handle,
  0.58 `city_window_open` @window_a.
- `window_close` 1.2 s: reach 0–0.25, leaves pulled shut 0.25–0.85, handle back 0.85–1.05. Events: 0.84
  `city_window_close`, 1.0 `city_window_latch`.

Interior: bed, desk + computer, chair, posters (GSP/NY), ladder to the roof hatch, plant, living
area with sofa, kitchen counter, pendant lamps, brick walls. Showroom: exhibit `apartment` (views, "Open all
windows", walk mode, street ambience muffled indoors / opens up with the windows).

Known gaps: furniture is simple boxes (reads fine at walking distance, not in close-ups); interior light
is sky ambient ×2.2 + lamps (no baked GI) — in Godot use a ReflectionProbe + LightmapGI.

## 2026-09-26 — walkable + colliders (classics agent)
- **Roof access:** the steel ladder (not walkable) is replaced by a **ship stair** in Peter's room along the partition
  wall (x 14.1–15.05, 15 treads 0.26 × 0.213 m, 50°, step on at z ≈ 0.7 from the front), through a 0.95 × 3.0 m roof
  hatch (z 1.2–4.2, lid hinged on the north edge, no curb on the exit side). Robot-part shelves moved to the east wall,
  the periodic-table poster to the south wall, the roof chairs/crate east of the hatch.
- **Colliders:** node `colliders` → `col_shell`, `col_interior`, `col_roof` (188 closed boxes = the axis-aligned box
  of every solid primitive: walls, slabs, parapets, partitions, ceiling, stair treads, furniture; skipped: glass, glow,
  pictures/screens, rugs, plants, lampshades, tiny props). Material `mat_collider` alpha 0 (invisible), extras
  `{"collider": true}`; same boxes in `apartment.colliders.json`. WIN-A openings are OPEN (sill 0.45 = one step:
  Peter can walk / jump out of every window, e.g. `win_06` in front of `spawn_spider`). The entry, bath and roof
  bulkhead doors are CLOSED (they lead to building parts that are not modelled) and collide as walls.
- **Verified** by `walkcheck.py apartment` (capsule r 0.28, step 0.6): Peter's room → doorway → living, dining,
  kitchen, to the west and north window sills, ship stair → roof → round the roof → back down: all walkable;
  north wall, partition, parapet and entry door block.
- Game: use only `col_*` for this base and hide them (request in `v3/docs/game/CORE-REQUESTS.md`); story places the
  WIN-A instances at `win_*` (story/bases.js) — unchanged.
