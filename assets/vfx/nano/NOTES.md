# Nano shader (owner: mk85 agent)

The nanotech reveal used by the Mk 85, its nano weapons and the Iron Spider. One look, two
engines: `nano.three.js` (showroom) and `nano.gdshader` + `nano_apply.gd` (Godot). Both
read the same inputs and use the same hash, so the cell pattern is identical in both.

## Inputs

| input | where | meaning |
|---|---|---|
| `NanoUV.u` | TEXCOORD_1 (three `uv1`, Godot `UV2`) `.x` | arrival time 0..1 (≤ 0.985). Geodesic distance from the source, normalised, + smooth noise |
| `NanoUV.v` | TEXCOORD_1 `.y` | per-plate random seed 0..1 |
| `nano` | Empty `drv_nano`, local `position.x` | 0..1, a fragment EXISTS when `u < nano` |
| `paint` | Empty `drv_paint`, local `position.x` | 0..1, a fragment is PAINTED when `u < paint` (else bare liquid metal). Clamped to ≤ nano |

A mesh (or any ancestor) with glTF extras `{"nano_driver": "drv_nano_blade", "nano_paint": "drv_paint_blade"}`
is driven by those Empties instead (weapons each have their own). Missing paint driver → paint
follows nano with a 0.16 lag. Missing driver node → 1 (fully formed). `nano = paint = 1` gives
exactly the original material: no cost in the look when the suit is simply worn.

## What it draws

1. **Discard** where `u > nano` (per-cell jitter, so the front arrives tile by tile).
2. **Leading band** (`edge` = 0.045 u): emissive, hot cyan `#7fe6ff` at the front → gold `#ffb347`
   behind, strongest on the cell borders (a hex-like Worley lattice, ~1.8 cm cells, object space).
3. **Growth**: vertices within `grow` (0.07 u) of the front are pulled in along −normal by
   `thickness` (1.8 cm), so the shell pours out over the skin and thickens instead of popping in.
   Tiny liquid ripple on the same band.
4. **Two-stage resolve**: between the nano front and the paint front the surface is liquid
   metal (`#8d949c`, metal 1, rough 0.14–0.32 with darker cell seams); the paint front is a soft
   gold-sparkle line; behind it the real baked PBR material.

Recede (suit-down, mask open, weapon retract) is the same shader with the driver going 1 → 0.

## three.js

```js
import { NanoController } from '/assets/vfx/nano/nano.three.js';
const nano = new NanoController(gltf.scene);     // patches every mesh with uv1; shadows included
function tick(dt) { mixer.update(dt); nano.update(dt); }   // AFTER the mixer: reads drv_* nodes
nano.set('drv_nano', 0.5); nano.release();        // manual override for sliders
```
Lower level: `makeNanoUniforms(opts)`, `patchNanoMaterial(mat, uniforms)`,
`makeNanoDepthMaterial(uniforms)`. Options = `NANO_DEFAULTS` (edge, paintEdge, paintLag,
cellScale, thickness, grow, edgeColor, edgeColor2, liquidColor, emissive, ripple).
The emissive band is ≥ 3 so the showroom bloom picks it up.

## Godot 4.6

```gdscript
var nano := NanoApply.new()
func _ready(): nano.install(suit_root, preload("res://assets/vfx/nano/nano.gdshader"))
func _process(_d): nano.update(suit_root)   # after the AnimationPlayer advanced
```
`install` swaps each imported `StandardMaterial3D` on surfaces with UV2 for a
`ShaderMaterial` (copies albedo, metallic/roughness image — glTF packs G=rough, B=metal —,
normal, emission, AO). Node extras arrive as meta `"extras"` (Godot ≥ 4.3). Shadow passes run
the same fragment, so shadows follow the reveal.

## Making NanoUV in Blender (any agent)

`next/blender/mk85/nanouv.py` (pure bpy, no nextlib edits):
```python
sys.path.insert(0, NEXT + "/blender/mk85"); import nanouv
field = nanouv.GeodesicField(body_obj, source_g=(0, 1.40, -0.16))   # Dijkstra over the body
nanouv.write_nano_uv(plate_obj, field, remap=my_remap, noise=0.06)  # writes UV map #2 "NanoUV"
```
The guide mesh is the base body in rest pose; each armour vertex takes the geodesic time of the
nearest body vertex, so the front crosses the gaps between plates the way it crosses skin.
`remap(u, p_gltf, obj)` reshapes the schedule (the Mk 85 puts the helmet last, closing from the
collar up in segments). Keep a UV map #1 ("UVMap", the texture atlas) in front of it: the
glTF exporter writes map #1 as TEXCOORD_0 and "NanoUV" as TEXCOORD_1.

## Known limits
- The cell lattice is in each mesh's OBJECT space: plates with their origin at their centre
  (CONTRACT §3) get independent patterns, which reads fine; a skinned mesh gets one pattern.
- Growth displaces along the vertex normal, so a hard-edged plate (split normals) can open
  hairline cracks at its rim for the ~0.1 s the front passes. Invisible in motion.
