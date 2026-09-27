# Villa suit-up gantry SP-3 v2 (classics agent)

Rebuilt 2026-09-25 from scratch after the Iron Man (2008) Mk III workshop scene (Jurek:
"redo it following the film"). Tony walks onto a 4 × 4 m floor of numbered panels, the 8 hatches
around his pad open, four yellow 6-axis **floor arms** rise out of the pit and bolt the boots,
calf/thigh plates and pelvis with spinning torque heads; he spreads his arms; four **ceiling
arms** hanging from a truss bring the torso back and front, slide the sleeves on along his arms,
fit the gauntlets, the reactor ring lights, he lowers his arms, the helmet shell comes from
behind/above, the gold faceplate closes from the front, the eyes light. Suit-off is the exact
time reversal.

## Clip API (for the game / V3 story agent)

Three GLBs, started on the **same frame**, no blending, all **25.5 s (766 frames @ 30 fps)**:

| what | GLB | suit-up clip | suit-off clip |
|---|---|---|---|
| machines (hatches, 8 arms, torque spindles) + machine sounds, sparks | `next/assets/bases/gantry/gantry.glb` | `suitup_gantry_<mk>` | `suitoff_gantry_<mk>` |
| the plates (rack/tray → arm → body) + reactor/eye glow driver, faceplate/eye/reactor cues | `next/assets/suits/<mk>/<mk>.glb` | `suitup_gantry` | `suitoff_gantry` |
| Tony's body (joints only, same canonical skeleton) | clip lives in the suit GLB, play it on `tony.glb` by node name | `suitup_gantry_wearer` | `suitoff_gantry_wearer` |

`<mk>` = `mk1`, `mk2`, `mk3`. Choreography is identical for all three (Mk III is the film suit).

**Where things stand.** Put the gantry root node `gantry` AND the suit root AND Tony's root at the
villa's `sp3_anchor` (floor level, centre of the pad), all facing −Z (Tony's facing).
The wearer clip carries **root motion** on `piv_root`: Tony starts at **z = +2.2 m** (on the floor
panel behind the pad, walking towards −Z) and stops at the origin at **t = 2.3 s**; after that he
never moves his feet off the pad. So: before starting, place/blend Tony to (0, 0, +2.2) in anchor
space facing −Z (or start the clips at t = 2.3 s if he is already standing on the pad — every
clip is valid from any start time). The suit clip carries the same root motion, so the suit root
must sit at the anchor too (not parented under Tony).

**Timeline** (seconds): 0–2.3 walk-in · 2.35–3.05 hatches unlock (drop 2 cm) and swing down ·
floor arms rise 2.55 · bootL 5.0 · bootR 6.5 (Tony lifts each foot) · legs front+back L 8.1,
R 9.6 · pelvis 11.2 · floor arms stow 10.6–13.25 · Tony spreads his arms 11.6–12.5 · hatches
close 13.3–14.2 · torso back 13.0 (from behind/above) · torso front 13.9 · sleeves L 15.4,
R 15.8 (slide along the arm axis) · gauntlets 18.5 / 18.9 · reactor ring lights 19.35 · Tony
lowers his arms 19.8–21.0 · helmet shell 21.4 (from behind/above) · faceplate 22.8 (from the
front) · eyes light 24.3 · ceiling arms stow 19.7–24.85. Each delivery: rack → lift off → fast
travel → hover → ease-out approach → slow precise final approach (0.5 s) → contact
(`cl_clamp_lock`) → torque burst (`cl_impact_driver` + `sparks` VFX at the tip) → hiss → retreat.

**End state.** At t = 25.5 the suit is fully on in rest pose (arms at the sides), all machines
stowed (floor arms in the pit, hatches closed and flush, ceiling arms folded up under the rails).
Hand control to the armour controller; hide or keep Tony's skinned mesh (the armour covers him;
the suit's rigid stand-in `under_*`/`pilot_head*` should be hidden when `tony.glb` is shown).
Suit-off: start with the armour at rest on the anchor, play `suitoff_*`; at the end Tony stands
at z = +2.2 having walked backwards off the pad — cut at t ≈ 23.2 (he is still on the pad) and
blend into the game's own walk if you prefer.

**Cues** (clips.json `events`): gantry clips carry all machine sounds (`cl_gantry_rise`,
`cl_servo_fast/small/big`, `cl_clamp_lock`, `cl_impact_driver`, `cl_hiss`, `cl_floor_unlock`,
`cl_floor_open`) with `at` = the arm's tip / joint node, `vfx: "sparks"` on every bolt-down;
suit clips carry `cl_faceplate_close` (Mk I: `cl_mk1_visor`), `cl_reactor_on` + vfx
`reactor_flare` at `piv_reactor`, `cl_hud_on` + vfx `eye_flash` at `piv_faceplate`; driver
`drv_glow` (0.1 dark → 1.4 flare at the reactor → 0.7 → 1.8 flash at the eyes → 1.0).
**No music, machine SFX only.** v1's `cl_suitup_bed` is gone; Jurek's `suit-up-sequence.mp3`
turned out to be a film clip with AC/DC "Back in Black" under it — the clunks once cut from it
(`cl_clamp_lock`, `cl_plate_clank`, `cl_floor_unlock`) carried the song. It is now a BANNED
source (audio-build refuses it; `faceplate-close.mp3` dropped too, on doubt). All machine sounds
are rebuilt atonal (hydraulic rush, thuds, latches, ratchets — no servo whine, no ringing
clanks), and the gantry clips play at most 3 machine sounds at once (`thin_cues` in
gantry2-build.py). The only pitched sounds are the reactor (19.35 s) and the HUD chirp (24.3 s).
Proof: `next/docs/progress/gantry-v2/sound_before_after_spec.png` + the `.wav` mixes
(render: `python3 blender/classics/soundtrack.py <mk> <out> [suitup|suitoff]`).

## Rig (nodes)
- `gantry` root, `sp3_anchor_ref`.
- `sp3_floor`: 25 panels `sp3_pad_22` (fixed centre), `sp3_panel_*` (fixed outer ring),
  `sp3_hatch0..7` hinge nodes (outer edge) with `sp3_hatch_*` panels; white painted grid lines
  and numbers 1–25 (the film's grid).
- `sp3_pit`: 2.4 × 2.4 × 1.6 m pit walls, ribs, light strips, pad pillar, floor-arm shelves `rack_<arm><level>`.
- `sp3_truss`: posts (±1.9, ±1.9), perimeter beams, rails `truss_railF/B` at 3.55 m, ceiling
  light panels, hanging trays `tray_<arm><level>` for the upper-body pieces.
- Arms `FL FR BL BR` (floor, on lift columns `arm_<A>_lift`) and `CFL CFR CBL CBR` (ceiling,
  mounted upside down on the rails): `arm_<A>` → [`_lift`] → `_a1` (yaw) → `_a2` → `_a3` → `_a4`
  (roll) → `_a5` → `_a6` (roll) → `arm_<A>_spindle` (torque bit) + `arm_<A>_tip` (tool point).
  Ceiling arms carry the film's yellow C-ring grippers.
- Which arm does what: FL bootL, legfrontL, pelvisfront · FR bootR, legfrontR · BL legbackL,
  pelvisback · BR legbackR · CBL torso back, helmet · CFR torso front, faceplate · CFL sleeveL,
  gauntletL · CBR sleeveR, gauntletR.

## Size (CONTRACT §10 SP-3 v2)
Floor module 4.0 × 4.0 m, pit 2.4 × 2.4 × 1.6 m, truss top 3.75 m → the villa room needs
≥ 3.9 m clear height over 4.2 × 4.2 m. ~48k triangles, flat PBR materials (`mat_gantry_*`,
`mat_glow`), no textures.

## Also in the GLB
`gantry_idle` (closed, 2 s loop), `gantry_open_close` (hatch demo, 4 s).

## Regenerate
```
cd next/blender/classics
./run.sh _work/mk3-build.log mk3-build.py mk3      # suits first (write data/<mk>_suitup.json), mk2, mk1 the same
./run.sh _work/gantry2.log gantry2-build.py        # then the gantry (add "-- --quick" to skip previews)
python3 notes.py
```
Choreography (timing, arm assignment, Tony's pose track, rig dimensions) lives in ONE file,
`choreo2.py`, used by both builds so the robot tool and the plate can never disagree.
The old v1 round-iris gantry (`gantry-build.py`, `choreo.py`) is kept for reference only.

## Generated facts (notes.py)

- File: `next/assets/bases/gantry/gantry.glb` (10.20 MB), 48423 triangles, 573 nodes, extensionsRequired: []
- Clips (8), 30 fps:

| clip | s | frames | loop | layer | events (t: sfx / vfx) |
|---|---|---|---|---|---|
| `suitup_gantry_mk1` | 25.50 | 766 | False | full | 2.35: cl_floor_unlock; 2.53: cl_floor_open; 2.55: cl_gantry_rise; 3.45: cl_servo_fast; 4.95: cl_servo_fast; 5.00: cl_clamp_lock; 5.08: cl_impact_driver / sparks; 5.45: cl_hiss; … (+49) |
| `suitoff_gantry_mk1` | 25.50 | 766 | False | full | 0.65: cl_servo_big; 2.05: cl_servo_big; 2.20: cl_impact_driver / sparks; 2.75: cl_clamp_lock; 3.60: cl_impact_driver / sparks; 3.65: cl_servo_fast; 4.15: cl_clamp_lock; 4.45: cl_servo_big; … (+45) |
| `suitup_gantry_mk2` | 25.50 | 766 | False | full | 2.35: cl_floor_unlock; 2.53: cl_floor_open; 2.55: cl_gantry_rise; 3.45: cl_servo_fast; 4.95: cl_servo_fast; 5.00: cl_clamp_lock; 5.08: cl_impact_driver / sparks; 5.45: cl_hiss; … (+49) |
| `suitoff_gantry_mk2` | 25.50 | 766 | False | full | 0.65: cl_servo_big; 2.05: cl_servo_big; 2.20: cl_impact_driver / sparks; 2.75: cl_clamp_lock; 3.60: cl_impact_driver / sparks; 3.65: cl_servo_fast; 4.15: cl_clamp_lock; 4.45: cl_servo_big; … (+45) |
| `suitup_gantry_mk3` | 25.50 | 766 | False | full | 2.35: cl_floor_unlock; 2.53: cl_floor_open; 2.55: cl_gantry_rise; 3.45: cl_servo_fast; 4.95: cl_servo_fast; 5.00: cl_clamp_lock; 5.08: cl_impact_driver / sparks; 5.45: cl_hiss; … (+49) |
| `suitoff_gantry_mk3` | 25.50 | 766 | False | full | 0.65: cl_servo_big; 2.05: cl_servo_big; 2.20: cl_impact_driver / sparks; 2.75: cl_clamp_lock; 3.60: cl_impact_driver / sparks; 3.65: cl_servo_fast; 4.15: cl_clamp_lock; 4.45: cl_servo_big; … (+45) |
| `gantry_idle` | 2.00 | 61 | True | full |  |
| `gantry_open_close` | 4.00 | 121 | False | full | 0.00: cl_floor_unlock; 0.18: cl_floor_open; 2.00: cl_floor_open; 2.85: cl_clamp_lock |
