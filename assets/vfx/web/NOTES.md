# Web VFX (spider agent) — notes for the implementer

Jurek: *"wygląd/feeling strzelania sieciami spider-mana jest słaby"*. Everything here is built
from silk FIBRES (a bright core wrapped in fine twisted filaments + a fixed-pixel halo), not a
cable. Review it in the showroom: exhibit **Web range** (`webs`) and the **Iron Spider** exhibit
(web_shoot_*, web_zip, web_pull clips fire it from `piv_webL/R`).

## Files

| file | what |
|---|---|
| `web.three.js` | reference implementation (three.js r186): `WebFX`, `WebLine`, `LOOK`, `JUICE` |
| `web_range.js` | the showroom test range (wall, dummies, deterministic demos, camera juice) |
| `web_fx.gd` | **Godot 4.6 port of `WebFX`** (class_name `WebFX`, a Node3D): globs, splats, sprites, fibres, rings, zip, pull, clip cues, physics raycasts, `sound`/`juice` signals |
| `web_line.gd` | Godot port of `WebLine` (class_name `WebFXLine`, RefCounted) — owned by WebFX |
| `web_line.gdshader` | every strand of the frame, one ImmediateMesh (TRIANGLE_STRIP) |
| `web_sprite.gdshader` | flares / puffs / stars, one MultiMesh (QuadMesh 2×2) |
| `web_glob.gdshader` | the thrown glob and a flying line's tip (lumpy icosphere, COLOR.r = cavity) |
| `web_splat.gdshader` | impact splat, one mesh per splat, baked at radius 1, burst/bounce/dissolve/body-bend/strand-shadows in the shader via instance uniforms `u_age u_fade u_curve u_width` |

(`web.three.js`'s header mentions `web_splat.gd` — there is none; splats live in `web_fx.gd`.)

## Godot usage

```gdscript
var fx := preload("res://…/web_fx.gd").new()     # one per player
add_child(fx)                                       # top_level; works before entering the tree too
fx.sound.connect(func(id, pos, gain): Audio.play_at(id, pos, gain))   # ids = assets/audio/spider/index.json
fx.juice.connect(_on_web_juice)                     # see "Juice" below
fx.set_light(sun_dir_towards_light, sun_color, ambient)
# clip events from spider_core.glb.clips.json: {"t":0.15,"vfx":"web_shot","at":"piv_webR","hand":"R"}
fx.cue("web_shot", {"at": skeleton_node("piv_webR"), "dir": aim_dir})   # dir optional: default = emitter -Y
fx.line(hand_node, anchor_point)                    # swing line; .release() when the player lets go
fx.zip(web_l_node, web_r_node, target_point)       # web_zip clip
fx.pull(web_r_node, enemy_node, func(info): enemy.apply_impulse(info.dir * 9.0))
```

Collision: thrown globs ray-cast the physics world (`collision_mask`). A collider in group
**`web_body`** (or meta `is_body = true`) counts as a body: 0.4 m splat that sticks to it and
bends round it (`u_curve`), `sp_web_hit_body`, hitstop. Group **`no_web`** is ignored.
Verified: headless Godot 4.6 loads both scripts and runs shoot/line/zip/pull/release for 90
frames with a wall and a body (splats spawned, all sounds fired). Shaders were NOT compiled
headless (no rendering driver) — first thing to check in the editor.

## Emitters and aim

`piv_webL/R` are children of `piv_elbowL/R` at the underside of the wrist; local −Y = the shot
direction along the forearm. In the game, aim the shot at the target (auto-aim / camera ray)
and pass `dir`; the clip's arm already points roughly there (web_shoot_* layer, `fire_at`).

## Juice (the numbers in `JUICE`, recommended camera/controller response)

| event | FOV kick | hitstop | shake | rumble low/high, s |
|---|---|---|---|---|
| shoot (glob leaves) | +1.5° | – | – | 0.08/0.35, 0.06 |
| line fire | +2° | – | – | 0.05/0.25, 0.05 |
| line attaches | – | – | 0.10 | 0.32/0.12, 0.10 |
| splat on a body | – | 50 ms | 0.22 | 0.50/0.55, 0.10 |
| splat on a wall | – | – | – | 0/0.12, 0.03 |
| zip start | +7° | – | 0.18 | 0.55/0.35, 0.22 |
| pull (yank) | −1.5° | 60 ms | 0.30 | 0.80/0.45, 0.16 |
| line snaps | – | – | 0.28 | 0.30/0.80, 0.10 |
| creak under load | – | – | – | 0/0.18, 0.05 |
| release | – | – | – | 0/0.10, 0.03 |

FOV kick: add the degrees instantly, return with a critically damped spring (ω ≈ 14 s⁻¹).
Shake: trauma model (offset = trauma² × 6 cm, roll = trauma² × 1.5°, Perlin 25 Hz, trauma decays
1.8/s). Hitstop: `Engine.time_scale = 0.05` for the duration (the web keeps animating because
`WebFX.step()` can be driven with unscaled delta). Rumble: `Input.start_joy_vibration(dev, low,
high, duration)`.

## Sounds used (all in assets/audio/spider/)

`sp_thwip_1..4` (shots, never the same twice in a row), `sp_thwip_swing`, `sp_thwip_double`,
`sp_web_attach_1/2`, `sp_web_splat_1..3`, `sp_web_hit_body`, `sp_web_creak_1/2`,
`sp_web_tension_loop`, `sp_web_release`, `sp_web_snap`, `sp_web_pull`, `sp_zip_whoosh`.
