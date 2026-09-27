# Audio credits — `assets/audio/mk42/` (Mark 42, summon runtime, human locomotion)

Every file here is **layered / processed real recordings** built by
`next/blender/mk42/audio_build.py` (numpy: cutting, speed/pitch change, doppler sweeps,
envelopes, layering; ffmpeg: filters + 2-pass `loudnorm I=-16 TP=-1.5 linear`; oggenc q6 +
libmp3lame 192k). No oscillator synthesis. Rebuild: `python3 next/blender/mk42/audio_build.py`.

No new downloads were made: every source is from banks already vetted for this game.

## Sources

| source file | what it is | origin | author | licence |
|---|---|---|---|---|
| ~~`MarkZero/audio/user-provided/suit-up-sequence.mp3`~~ | **REMOVED 2026-09-25** — the recording has AC/DC "Back in Black" under it (copyrighted music). The 9 clicks once cut from it are now built from B `latch.mp3` (rubberduck, CC0) + B `concrete_c.mp3`; `audio_build.py` refuses the file | — | — | — |
| ~~`MarkZero/audio/user-provided/faceplate-close.mp3`~~ | **REMOVED 2026-09-25** — spectrogram shows the same thin sustained lines as the film clip with music; dropped on doubt. `mk42_faceplate_latch` is now B thruster_hot hiss + B latch + B concrete_c | — | — | — |
| `clank_plate.mp3`, `metal_a.mp3` | striking a metal pole | [Metal pole hit (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Metal_pole_hit_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `metal_b.mp3` | striking a metal pole | [Metal pole hit 3](https://commons.wikimedia.org/wiki/File:Metal_pole_hit_3_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `clank_scrap.mp3`, `metal_c.mp3` | striking a metal pole | [Metal pole hit 7](https://commons.wikimedia.org/wiki/File:Metal_pole_hit_7_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `clank_light.mp3`, `metal_light.mp3` | bright metal strike | [Metal Hit (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Metal_Hit_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `latch.mp3` | a lock closing | [Lock (Gravity Sound).wav](https://commons.wikimedia.org/wiki/File:Lock_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `metal_heavy.mp3` | slamming a closet door | [Slam closet door](https://commons.wikimedia.org/wiki/File:Slam_closet_door_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `servo_fine.mp3` | sanding a metal slide | [Sand down metal slide](https://commons.wikimedia.org/wiki/File:Sand_down_metal_slide_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `servo_fast.mp3` | rubbing a metal door | [Rubbing metal door](https://commons.wikimedia.org/wiki/File:Rubbing_metal_door_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `servo_grind.mp3` | small mechanism running | [Mechanical sound](https://commons.wikimedia.org/wiki/File:Mechanical_sound_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `plates_swarm.mp3` | sorting metal cutlery | [Sorting cutlery](https://commons.wikimedia.org/wiki/File:Sorting_cutlery_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `suit_ready.mp3` | task-complete chime | [Complete (Gravity Sound).mp3](https://commons.wikimedia.org/wiki/File:Complete_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `wind_gust.mp3` | wind gusting | [Wind outside atmosphere](https://commons.wikimedia.org/wiki/File:Wind_outside_atmosphere_%28Gravity_Sound%29.wav) | Gravity Sound | CC BY 4.0 |
| `gravel_land.mp3` | landing in gravel | [Land in Gravel](https://commons.wikimedia.org/wiki/File:Land_in_Gravel_%28Gravity_Sound%29.mp3) | Gravity Sound | CC BY 4.0 |
| `thruster_hot.mp3` | abrasive blasting nozzle, near field | [WWS Sandblastingashiphull.ogg](https://commons.wikimedia.org/wiki/File:WWS_Sandblastingashiphull.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `thruster_whine.mp3` | Saab J35D Draken turbojet | [WWS SaabJ35DDrakenstartengineandtaxiing.ogg](https://commons.wikimedia.org/wiki/File:WWS_SaabJ35DDrakenstartengineandtaxiing.ogg) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `metal_d.mp3`, `metal_debris.mp3`, `rubble_a.mp3` | breaking / falling / hit sounds | [75-cc0-breaking-falling-hit-sfx](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx) | rubberduck | CC0 1.0 |
| `game/assets/audio/armour_drop.ogg`, `body_drop.ogg`, `hit_metal.ogg`, `land.ogg`, `step.ogg` | impacts, footsteps | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | CC0 1.0 |
| `game/assets/audio/explosion.ogg`, `explosion_low.ogg` | explosions | [Kenney Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | Kenney | CC0 1.0 |
| `game/assets/audio/swing_whoosh.ogg`, `dodge.ogg` | cloth / air whoosh | [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio) | Kenney | CC0 1.0 |

(`MarkZero/audio/sfx/*` files are themselves cut from the originals listed in
`Projects/MarkZero/audio/CREDITS.md`, which has the full attribution text.)

## What each id is made of

| id (variants) | recipe |
|---|---|
| `mk42_lock` (8) | latch/concrete click + metal ring (pole hits / lock / Kenney metal, pitched ±6–18 %) + low thump (Kenney armour drop, lowpassed, slowed 0.62–0.9) |
| `mk42_lock_big` (3) | double latch/concrete click + heavy ring (door slam / pole hit, slowed 0.8) + body-drop thump |
| `mk42_wake` (3) | lock release tick (pitched up) + 0.35 s burst of sandblasting noise, highpassed, fast decay = micro-thruster puff |
| `mk42_whoosh` (5) | sandblast noise through a doppler speed sweep 0.8→1.45 + Kenney swing whoosh |
| `mk42_whoosh_big` (2) | Draken turbine whine through a sweep + wind gust |
| `mk42_servo` (4) | 0.3 s slices of metal-slide / rubbing / mechanism, pitched up + a click |
| `mk42_faceplate_latch` | pressure hiss (B thruster_hot) + latch (B latch) + dull tick (B concrete_c) — rebuilt 2026-09-25 |
| `mk42_faceplate_unlatch`, `mk42_faceplate_slide` | lock tick + hiss; metal-slide slice |
| `mk42_flap_open`, `mk42_flap_close` | rubbing-metal slice + light metal strike / click |
| `mk42_eject` | Kenney explosion + low explosion + metal debris + cutlery rattle + two latch/concrete clicks |
| `mk42_plate_hit` (3), `mk42_plate_bounce` (3) | debris / pole-hit / armour drop / rubble; light strikes pitched up with fast decay |
| `mk42_suit_ready` | Gravity Sound "Complete" chime + click |
| `human_step` (6), `human_step_run` (4), `human_step_scuff` | Kenney step (pitched), + Kenney land for runs, + gravel for the scuff |
| `human_land`, `human_jump_push`, `human_cloth`, `human_hit_body` | Kenney land / body drop / step / cloth whoosh layers |

## Full attribution text (CC BY 4.0 items)

Sounds by **Gravity Sound** (<https://www.gravitysound.studio/>, mirrored on Wikimedia Commons)
and **Work With Sounds / Torsten Nilsson**, licensed CC BY 4.0
(<https://creativecommons.org/licenses/by/4.0/>), cut, pitched and layered as described above.
