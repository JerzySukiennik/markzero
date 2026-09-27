# Iron Man's villa v2 — NOTES (walkable, collider-ready)

Rebuilt 2026-09-26 by the classics agent (Jurek: "you can't walk around Iron Man's house: the stairs lead
nowhere and 95 % of the walls have no collision"). Files: `villa.glb` (+ `villa.glb.clips.json`),
`villa.colliders.json`, `villa.walkpath.json` (the verified walking route).
Regenerate: `/Applications/Blender.app/Contents/MacOS/Blender --background --python next/blender/city/build_villa.py`
then `python3 next/blender/city/walkcheck.py villa --path next/assets/bases/villa/villa.walkpath.json`
(v1 script kept as `build_villa_v1.py`). After changes run `v3/tools/sync-next-slim.sh`.

**Space:** unchanged — origin = main floor level, local −Z faces the sea/skyline; placed at `layout.bases.villa`
(world 1444, 31, 1723, rot_y 1.32645 rad) on the headland. Footprint as v1 (x −23..19, z −18..42, pad to x 35).

## Plan (one connected house, no dead ends)
| level | y | what | how you get there |
|---|---|---|---|
| Workshop + hangar | −7 | x −18..18, z −4..20, **6.1 m clear** (ceiling −0.9). SP-3 v2 module (4 × 4 m opening at (0, 7), 1.7 m pit, walkable collider cap) for the gantry; hall of armour (8 alcoves, back wall); benches, cars, robot arm; glass front with the **10 × 5.2 m bay door** onto the **launch deck** (z −18..−4) | east-wall stair from the living level |
| Workshop stair | −7 → 0 | x 15.7..17.9, 20 steps (0.175 × 0.28) → landing (y −3.5) → 20 steps, arriving at z 13.5 inside the pavilion; stair-well in the living floor has a glass guard | — |
| Living pavilion | 0 | x −20..18.2, z −2..17: glass front (sliding door x −8.5..−4.5 → terrace + infinity pool, glass balustrades), west glass, concrete back wall with the **entry door** (x −1.6..1.6 → forecourt, drive to the land), east wall with the **pad door** (z 2.6..5.4 → bridge → landing pad Ø16). Living, dining, bar, piano, fireplace | entry door / pad / terrace |
| Upper stair | 0 → 4.6 | along the back wall, 26 steps climbing west from x 12.9 to 5.4 (z 15.3..16.9) | from the living room |
| Upper level | 4.6 | x −8..13, z 3..17: bedroom + study, glass front with a **door onto the roof terrace** and 2 WIN-A windows | upper stair |
| Roof terrace | 4.6 | pavilion roof in front of the upper level (z −4..3), glass railing all round | roof door |

## Markers
`sp3_anchor` (0, −7, 7) — SP-3 v2 module centre on the floor, Tony faces −Z (towards the bay door); the gantry
(`assets/bases/gantry/gantry.glb`) goes here as is (see its NOTES for the suit-up clip API; Tony walks in from local
z +2.2 = villa z 9.2, clear floor). `spawn_ironman` (workshop), `spawn_tony` (living room), `spawn_ironman_pad`,
`pad_center` (r 8), `veronica_drop` (25 m above the pad), `flight_exit` (fly out along −Z through the bay door),
`door_entry`, `door_terrace`, `door_pad`, `door_roof` (extras w/h), `alcove_1..8` (suits face −Z),
`win_01..04` (**WIN-A**, CONTRACT §10: origin at sill level of the opening, room +Z, sea −Z — put one
`assets/bases/apartment/window_a.glb` instance under each; win_01/02 living front, win_03/04 upper front),
`light_*` (extras light/energy_w/color/range).

## Colliders
Node `colliders` → meshes `col_workshop`, `col_stair_ws`, `col_main`, `col_stair_up`, `col_upper`, `col_roof`,
`col_deck`, `col_pad`, `col_site`, `col_sp3_cap`: 323 closed axis-aligned boxes, material `mat_collider`
(alphaMode MASK, alpha 0 → invisible even if an engine ignores the convention), extras `{"collider": true}`.
Every wall **including glass**, floors/slabs, stair treads, landings, rails/balustrades, pool walls, the pad (8 boxes),
big furniture. Openings (doors, bay door, WIN-A) are open; the bay-door panels and WIN-A leaves are NOT in it (they
move); the pool water is walk-through (floor at −1.4). The same boxes in `villa.colliders.json`
`{"boxes": [[x0,y0,z0,x1,y1,z1,zone]…]}` (villa-local). **Game:** use only `col_*` for the villa, hide them
(request filed in `v3/docs/game/CORE-REQUESTS.md`).
Verified by `walkcheck.py villa` (capsule r 0.28 m, h 1.8, step 0.6 = V3 groundAt default): 9 legs —
forecourt → entry → living → pad → terrace/pool → upper stair → upper → roof terrace → down → workshop stair →
SP-3 → hall of armour → bay → launch deck — all walkable; walking through the west/front glass, the back wall, the
workshop wall, the upper glass, the roof railing and the terrace balustrade is blocked.

## Clips
`bay_open` 3.6 s (panels slide 5.3 m into wall pockets, open at 2.7 s; event 0.0 `villa_bay_door`),
`bay_close` 3.6 s (events 0.0 `villa_bay_door`, 2.6 `villa_bay_door_thud`). Not looped.

## Materials to treat specially
`mat_glass` α 0.15 (thin clear glass), `mat_pool_water` (patchBase handles it), `mat_glow_*` emissive, `mat_collider`
(never render). Textures: Concrete034/042A, WoodFloor051, Tiles143, Rock030 (ambientCG CC0, from next/blender/city/_cache).

## Showroom
`villa` (city renderer; views incl. Workshop stair, Stair up, Upper level, Roof terrace; WIN-A windows placed,
"Open WIN-A windows" toggle) and `villa-walk` (Tony walks the verified route; "Show colliders" toggle).

## Known gaps
Architecture is still clean boxes (15k triangles) with basic furniture — it reads as a modern glass/concrete house,
but has none of the film villa's curved roofs; no baked light. Stair treads collide as boxes (fine with a 0.6 m step;
an engine with a lower step height needs a ramp — ask). The forecourt ends at the headland terrain (z 42) — the
drive beyond is the city's.
