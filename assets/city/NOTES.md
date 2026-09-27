# City — NOTES (research + implementer notes)

Owner: **city** agent. Regenerate commands and the full file list are at the bottom
(filled in as the build lands). Godot-specific instructions live in `GODOT.md`.

## 1. Research — what AAA browser / Godot cities actually do

Sources read (Sept 2026):
- Joost van Dongen, *Interior Mapping: rendering real rooms without geometry* (2008 thesis,
  2018 blog) — <http://joostdevblog.blogspot.com/2018/09/interior-mapping-real-rooms-without.html>
- Polycount / ResetEra breakdowns of *Marvel's Spider-Man* (PS4) interior mapping — rooms are
  cube textures from an atlas picked per window, raycast in the pixel shader
  (<https://polycount.com/discussion/204601/interior-mapping-in-spider-man-ps4>), and the GDC
  technical postmortem (<https://www.gdcvault.com/play/1026496/-Marvel-s-Spider-Man>).
- `three-fenestra` (<https://github.com/codedgar/three-fenestra>) — 2D back-atlas of rooms
  (4×4 cells), `backScale` = back-wall fill factor, optional front atlas (curtains/blinds with
  alpha), per-window hash for lit/unlit, warm/cool, brightness; night = warm emissive + bloom.
- Rytelier, *Godot 4 interior mapping shader, no cubemap*
  (<https://github.com/Rytelier/Godot-4-interior-mapping-shader-no-cubemap>) — same idea in
  `.gdshader`: a front-view render of a room mapped onto a box by ray/box intersection and a
  perspective correction with the back-wall fraction.
- three.js r186 addons in the showroom vendor folder: `csm/CSM.js` (cascaded shadows — patches
  `lights_fragment_begin`/`lights_pars_begin` globally, gated by `USE_CSM`, and sets
  `material.onBeforeCompile`, so our own patches must be chained after it), `objects/Sky.js`
  (Preetham), `objects/Water.js` / `Water2.js` (planar Reflector + normal maps),
  `postprocessing/GTAOPass`, `UnrealBloomPass`, `SMAAPass`, `OutputPass`.
- three.js performance notes (instancing vs BatchedMesh, one shadow light, draw-call budgets):
  <https://www.utsubo.com/blog/threejs-best-practices-100-tips>,
  <https://waelyasmina.net/articles/batchedmesh-for-high-performance-rendering-in-three-js/>
- Water: *Open world in the browser pt. 26 — three ways to make water*
  (<https://app.cinevva.com/blog/2026-05-12-open-world-browser-part-26-water>): mirrored camera
  into an off-screen target, distorted by the wave normal, Schlick Fresnel, per-channel
  extinction toward a water-fog colour, shoreline foam.
- Godot 4: *Visibility ranges (HLOD)*
  (<https://docs.godotengine.org/en/stable/tutorials/3d/visibility_ranges.html>),
  MultiMeshInstance3D (one draw per cluster, culled as a whole), CPU occlusion culling with
  `OccluderInstance3D`; Godot has no built-in planar reflection — SSR (opaque surfaces only)
  or a mirrored-camera `SubViewport` (<https://godotforums.org/d/31722-planar-reflection-for-water-shader>).

### What we take from it (decisions)

1. **Facades are a shader, not geometry.** Every building face carries UVs in *facade cells*
   (u = bay index along the face, v = floor index up the face) and a per-building style id +
   seed. One facade shader draws window frames, mullions, sills, lintels, spandrels, ground
   floor shopfronts, and — behind every pane — an **interior-mapped room** from a 4×4 atlas
   rendered in Blender (day and night versions). Window reveals are ray-traced too (the glass
   sits 15–30 cm back; the lintel throws a sun shadow onto it), so the facade has depth
   without a single extra triangle. This is the Spider-Man trick and it is what makes the
   city read as inhabited.
2. **Silhouette is geometry.** Setbacks, crowns, cornices, parapets, water towers, roof
   bulkheads, HVAC, antennas, fire escapes are real meshes — the skyline and the roofscape are
   what you see from flight height, so they get the triangles.
3. **Few draw calls.** The island is cut into tiles; each tile is ONE facade mesh + ONE
   roof/detail mesh + ONE ground mesh; props are `InstancedMesh` per tile (Godot:
   `MultiMeshInstance3D` per tile). Tiles are frustum culled; props and small details switch
   off by distance (HLOD).
4. **Light = one sun + sky.** Cascaded shadow maps (3 cascades) from a single directional
   light, a physical sky (Preetham-style) that also feeds a PMREM environment for reflections,
   exponential **height fog with sun in-scattering** (aerial perspective), ACES/AgX tone
   mapping, bloom for night windows and street lamps, cheap AO (baked vertex AO in the meshes
   + optional GTAO).
5. **Water = planar reflection at reduced resolution + two scrolling normal maps + Fresnel +
   shoreline foam from a precomputed shore-distance texture.** Godot: SubViewport mirror or SSR.
6. **Night = emissive rooms (random lit fraction by hour), lamp heads + ground light pools as
   additive decals, warm street-light spill on the lower facade, car head/tail lights.**
   Thousands of real lights would be impossible; nobody ships that.

## 2. Files, regenerate commands

| step | command | writes |
|---|---|---|
| textures (ambientCG CC0 → strips) | `python3 next/blender/city/build_textures.py` | `tex/*_albedo.jpg, *_nrm.png, noise.png` (+ `tex/CREDITS.md`) |
| interior-room atlas | `Blender --background --python next/blender/city/build_rooms.py` | `tex/rooms_day.jpg, rooms_night.jpg, rooms.json` |
| street kit | `Blender --background --python next/blender/city/build_kit.py` | `kit/*.glb` |
| landmarks | `Blender --background --python next/blender/city/build_landmarks.py` | `landmarks/*.glb` |
| city (layout, tiles, world, props) | `python3 next/blender/city/citygen.py` | `layout.json, styles.json, props.json, tiles/*.glb, world.glb, tex/water_shore.png` |
| apartment + WIN-A window | `python3 next/blender/city/posters.py` then `Blender --background --python next/blender/city/build_apartment.py` | `../bases/apartment/*` |
| villa | `Blender --background --python next/blender/city/build_villa.py` | `../bases/villa/*` |
| audio | `python3 next/blender/city/audio/fetch.py && python3 next/blender/city/audio/build_audio.py` | `../audio/city/*` |
| Godot shaders | `python3 next/blender/city/godot_port.py` | `godot/*` |
| review shots | `node next/blender/city/dev/ms.mjs <exhibit> <views.mjs> <outdir> [w h]` (one page load, many views) | PNGs |

(`Blender` = `/Applications/Blender.app/Contents/MacOS/Blender`.)

## 3. Fixes 2026-09-24 (Jurek's review: black/pixelated buildings, sun too bright, water)

1. **"Weirdly black" buildings = no IBL specular at all.** three's vendored `CSMShader.lights_fragment_begin`
   is a copy from an older three: it lacks the r18x `material.dfg = texture2D(dfgLUT, …)` block, so every
   environment reflection was zero — metals rendered pure black (the villa hangar doors), glass curtain
   walls lost their sky reflection. `render.js` now grafts the current three prefix onto CSM's light loops.
   (Any other exhibit using `CSM.js` from the vendor folder has the same bug — worth fixing centrally.)
2. **"Sun far too bright" / washed out, no shadows.** The Preetham dome's radiance was ~5× the sun's: the
   sky PMREM out-lit the sun, shadows vanished. The dome is now gain-normalised per hour (horizon
   luminance target 0.85 noon → 0.18 at sunset), environment 0.32 by day, sun 5 → 2.7 at golden hour with
   a proper orange ramp, exposure keys retuned, golden preset moved to 19:12 (sun 4.7° up). The sun-side
   horizon sample is capped at 1.6× the other side (no white-out towards the sun).
3. **Horizon band / fog.** Fog colours are read back from the sky dome (3° above the horizon, away from
   and towards the sun); the dome below the horizon is exactly the fog colour and the fog completes by
   14 km, so the edge of the world disappears. Probe's lower hemisphere = dim ground bounce (shadows are no
   longer lit from below by "sky").
4. **Pixelated towers.** Per-window detail (window mask, lit/unlit, brightness) now fades in only above ~4 px
   per window by day (1 px at night — the night sparkle is wanted); below that the area average is used.
5. **Water repetitive / shaking.** The 131 m swirly layer weakened, the 43 m and 14 m layers strengthened;
   the water is a 160×160 grid following the camera snapped to cells (a single 30 km quad made the
   interpolated world position — and the per-vertex reflection coordinate — jitter); reflection UV now per
   pixel; `uTime` wraps at 16000 s (all scroll rates tile); dynamic resolution steps slower with hysteresis.
6. Muted curtain colours (saturated ones read as toy blocks); cliff tops no longer paint grass "drips".
7. GL "feedback loop" warnings: none in the headless runs (city/apartment/villa). The park lake uses the
   water shader without the reflection target (sampling it while drawing into it was the loop).

## 4. Known gaps

- Buildings are extruded parts with shader facades: good from street level to ~1 km, but skyline towers
  still read as boxes (few crowns/setbacks besides the three landmarks). Cars/cabs are crude.
- The "Jersey"/"Brooklyn" shores are low filler boxes + a few towers.
- Perf: not re-measured on the 5500M after these changes (headless only). The facade shader is unchanged
  in cost; the water grid adds 51k triangles.
