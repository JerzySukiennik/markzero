# Audio credits — Hulkbuster + Veronica (`assets/audio/hulkbuster/`)

Every file here is a **layered, pitch-shifted (tape-style, slower + deeper) and filtered mix of real
recordings**; nothing is synthesised. Regenerate: `python3 next/blender/hulkbuster/hbaudio.py`
(the exact recipe of every sound — sources, pitch ratios, gains, trims, filters — is in that script).
All outputs: 44.1 kHz, `loudnorm I=-16 TP=-1.5`, .ogg (oggenc q6) + .mp3 (192k). Loops
(`hb_rocket_loop`, `vr_hover_loop`) are cut seamless with an equal-power tail-over-head crossfade.

## Sources used (all already vetted for a free game)

| source file | original | author | licence |
|---|---|---|---|
| `MarkZero/audio/user-provided/steps/step-02,03,07,09,11,15.mp3` | armour footsteps | Jurek (own recording) | owned |
| `MarkZero/audio/user-provided/repulsor/repulsor-01,04,charged.mp3` | repulsor shots/charge | Jurek (own recording) | owned |
| `MarkZero/audio/sfx/latch` | Lock (Gravity Sound).wav, Wikimedia Commons | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/metal_heavy` | Slam closet door (Gravity Sound).wav | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/metal_b`, `clank_plate`, `metal_c`, `clank_light` | Metal pole hit / Metal Hit (Gravity Sound) | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/servo_heavy`, `servo_fast`, `servo_grind` | Scratching / Rubbing metal door, Mechanical sound (Gravity Sound) | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/thruster_hot` | WWS Sandblastingashiphull.ogg (Commons) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `MarkZero/audio/sfx/thruster_idle`, `thruster_mid`, `thruster_whine` | WWS SaabJ35DDrakenstartengineandtaxiing.ogg (Commons) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `MarkZero/audio/sfx/thruster_sub` | opengameart.org/content/underwater-or-space-engine-rumble | qubodup | CC0 |
| `MarkZero/audio/sfx/wind_low`, `wind_gust` | Windy day / Wind outside atmosphere (Gravity Sound) | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/concrete_a`, `concrete_c`, `metal_debris`, `glass_debris` | opengameart.org/content/75-cc0-breaking-falling-hit-sfx | rubberduck | CC0 |
| `MarkZero/audio/sfx/rubble_b` | Dropping rocks on ground (Gravity Sound) | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/gravel_land` | Land in Gravel (Gravity Sound).mp3 | Gravity Sound | CC BY 4.0 |
| `MarkZero/audio/sfx/repulsor_fire_a,b,c`, `repulsor_tail`, `repulsor_charge_big`, `reactor`, `suit_ready` | see `MarkZero/audio/CREDITS.md` (Gravity Sound, Commons) | Gravity Sound | CC BY 4.0 |
| `game/assets/audio/explosion.ogg`, `explosion_low.ogg`, `boost.ogg`, `hit_metal.ogg`, `swing_whoosh.ogg`, `laser_loop.ogg` | kenney.nl Sci-fi / Impact sounds | Kenney | CC0 |

Full original URLs: `Projects/MarkZero/audio/CREDITS.md` and `Projects/Mark Zero/game/assets/audio/CREDITS.md`.

## What each id is made of (short)

- `hb_step_heavy_1..4` (+ `hb_step_heavy` variant set): Jurek's step ×0.70 + door slam ×0.55 + concrete thump (LP 420 Hz) + faint slowed servo groan.
- `hb_step_run_1..2`, `hb_land`, `hb_land_heavy` (Kenney low explosion + concrete + rubble + slam).
- `hb_hydraulic_hiss`, `hb_hydraulic_breath`: sandblaster nozzle, high-passed, short envelopes (+ latch / servo creak).
- `hb_servo_heavy`, `hb_piston_fire`, `hb_swing_heavy`, `hb_block_impact`, `hb_clamp`, `hb_clamp_heavy`, `hb_flap`.
- `hb_faceplate` (rebuilt 2026-09-25): servo_fast slide ×0.8 + latch ×0.7 + metal_c clack (MarkZero CC bank).

**Banned sources:** `MarkZero/audio/user-provided/suit-up-sequence*.mp3` (film clip with AC/DC "Back in Black") and
`faceplate-close*.mp3` (same film score, see `next/docs/progress/gantry-v2/user_recordings_music_check.png`). The
mixer (`hbaudio.build`) refuses them; the old `hb_faceplate` built on faceplate-close was replaced.
- `hb_plate_whoosh`, `hb_power_up`, `hb_part_blowoff`.
- `hb_rocket_ignite`, `hb_rocket_loop` (space-engine rumble ×0.85 + Draken ×0.7 LP + nozzle), `hb_rocket_burst`.
- `hb_mega_charge`, `hb_mega_blast`, `hb_unibeam_charge`, `hb_unibeam_blast` (Jurek's repulsor recordings, deepened, + Kenney layers).
- `vr_reentry` (7 s swell), `vr_flip`, `vr_retro`, `vr_hover_loop`, `vr_clamp_release`, `vr_bay_open`, `vr_bay_close`,
  `vr_release_1..3` (+ `vr_release` variant set), `vr_part_launch`, `vr_clamp_lock`, `vr_ascend`.
