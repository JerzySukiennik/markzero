# Repulsors, thruster plumes, contrails, arm aim — implementer notes

Reference implementation (look at it moving first): showroom exhibits **Repulsor lab** and
**Flight lab** (`showroom/js/vfx.js`, `showroom/js/aim.js`). Everything in this folder is a
faithful Godot 4.6 port, compile- and run-tested headless (`--script` probe, 2026-09-23).

| file | what | replaces / plugs into (game/) |
|---|---|---|
| `arm_aim.gd` | `ArmAim` — procedural aim layer: 2-bone IK raises the arm onto the shoulder→target line, wrist turns the palm emitter (-Y) onto the target, fingers bend back, weight blends in/out, `recoil` kick | `SuitPilot._drive_shot_arms` + the symmetric `fire` pose in `suit_rig.gd` |
| `repulsor_vfx.gd` | `RepulsorVFX` — bolt streak visual, muzzle (flash, shock ring, blast light, sparks), charge glow, impact (flash, ring, sparks, light, scorch decal) | the sphere+cylinder bolt built in `scripts/combat/repulsor.gd::_make_bolt` (keep the gameplay: pool, cooldown, magazine, magnetism, sweep hit test) |
| `repulsor_bolt.gdshader` | streak shader (white-hot head, blue halo, tail) | — |
| `thruster_plume.gd` + `thruster_plume.gdshader` | `ThrusterPlume` — 3 layered cones (core with Mach diamonds, sheath, outer), nozzle glow, flickering light; `style` = `repulsor` or `flame` | the flame/core/glow built in `scripts/flight/thrusters.gd` (keep its drive() inputs; call `set_level()`) |
| `ribbon_trail.gd` + `trail_ribbon(_add).gdshader` | `RibbonTrail` — camera-facing condensation ribbon per emitter (+ thin additive vortex lines from the palms above 60 m/s) | complements `scripts/flight/contrail.gd` (Jurek likes the current trail — keep the puffs, ADD ribbons; A/B it) |

## The one behaviour that fixes "you can't see the arm come up and aim"

The game fires the instant R1 is pressed, from wherever the palm is, and only then adds a
reach offset — so the bolt leaves a hand that is still down by the hip. Change the order:

1. On press, set `arm_aim[hand].target = Repulsors.aim_point(camera, …)` and `want = 1`.
2. **Hold the shot until `arm_aim[hand].weight > 0.8`** (≈ 80–90 ms from rest, 0 ms if the arm is
   already up — rapid fire keeps it up). The existing `FIRE_BUFFER` (0.22 s) already covers this
   latency; nothing is dropped.
3. Fire from `piv_palm{hand}.global_position` *after* `ArmAim.update()` ran this frame.
4. On fire: `arm_aim[hand].recoil = 0.6` (charged: 1.0), `RepulsorVFX.muzzle(...)`,
   `Sfx.play("repulsor_fire")` (a random pick of the six variants, pitch jitter ±4 %).
5. `want = 0` 1.4 s after the last shot of that hand (the arm lowers at the slower rate).
6. Chest/neck turn a little towards the target while aiming (see `LookAt` in `showroom/js/aim.js`,
   30–55 % of the angle, clamped) — it is what makes the whole body read as aiming.

Order of updates each frame: AnimationTree/AnimationPlayer poses the rig → `ArmAim.update()`
for both hands → fire → VFX. ArmAim slerps FROM the animated pose, so it never fights the clip.

## Numbers (tuned in the showroom)

- Bolt: speed 260 m/s (showroom uses 110 so you can see it), streak length
  `clamp(speed·0.024, 1.4, 5)` m (×1.5 charged), width 0.34 m (0.7 charged); the streak
  grows out of the palm over its first `length` metres. Light 7 (14 charged) energy, range 6 (9).
- Muzzle: flash 0.55 m / 90 ms, shock ring 0.16 m growing ×2.8 over 160 ms, oriented to the shot,
  6 blue sparks, light pop 12 energy for 80 ms.
- Impact: flash 1.6 m / 160 ms, ring 0.2 → ×4 over 240 ms on the surface normal, 32 warm + 10
  blue sparks, light 18 for 120 ms, scorch decal 0.5 m fading after 14 s, 3 smoke puffs.
- ArmAim: raise rate 16/s, lower 7/s; reach 93 % of arm length (−10 % at full recoil); elbow
  pole (±0.35, −1, 0.15); fingers back −0.38 rad (+ −0.25 rad at full recoil), splay 0.09 rad.
- Plumes: core 0.34 m, sheath 0.75 m, outer 1.1 m at level 1; length scales 0.4+0.75·L etc.;
  light 6·L. Colours: repulsor white→(0.55,0.82,1)→(0.12,0.32,1); flame white→(1,0.55,0.12)→(0.5,0.12,0.02).
- Trails: boots width 0.10 → ×(0.35+2.6·age), life 1.8 s, only above 8 m/s; palms 0.025, life
  0.9 s, above 60 m/s, additive.

## Sounds (assets/audio/core)

`repulsor_fire` (variants 1–6, built from Jurek's own repulsor recordings + a low body layer —
the current game uses a Kenney sci-fi "pew" with falling harmonics, which is why it sounded
cheap), `repulsor_fire_big`, `repulsor_charge` (stop it on release), `repulsor_impact(_big)`,
thruster beds `thruster_idle/mid/hot/sub/whine` (crossfade by thrust: idle→mid→hot, whine
pitched 0.85–1.15 with thrust), `wind_low/high/gust` (by airspeed). Credits in `CREDITS-core.md`.
