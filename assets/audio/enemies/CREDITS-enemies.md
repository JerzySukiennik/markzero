# Audio credits — enemies (`assets/audio/enemies/`)

Every file is a layered / pitched / filtered mix of **real recordings**; nothing is synthesised.
Regenerate: `python3 next/blender/enemies/enaudio.py` (exact recipe per id — sources, pitch ratios, trims,
gains, filters — in that script; the mixer is `blender/hulkbuster/hbaudio.py`). All outputs 44.1 kHz,
`loudnorm I=-16 TP=-1.5`, .ogg (oggenc q6) + .mp3 (192k). `en_rpg_flight` is a seamless loop.

## Sources

**Attribution required in the game credits:** Michel Baradari (CC-BY 3.0) and HaelDB (OGA-BY 3.0) — see the voice rows.


| source (path in this repo tree) | original | author | licence |
|---|---|---|---|
| `next/blender/enemies/_cache/voices/player/` (`michelbaradari-human.7z`) | 11 male human pain/death sounds — opengameart.org/content/11-male-human-paindeath-sounds | Michel Baradari (submitted by qubodup) | **CC-BY 3.0** |
| `next/blender/enemies/_cache/voices/yelling/` (`yelling sounds.zip`) | Male Grunt/Yelling sounds — opengameart.org/content/male-gruntyelling-sounds | HaelDB | CC0 / **OGA-BY 3.0** |
| `next/blender/enemies/_cache/voices/death pain grunts.wav` | grunts of male death and pain — opengameart.org/content/grunts-male-death-and-pain | thebardofblasphemy | CC0 |
| `next/blender/enemies/_cache/Prepared SFX Library/` (`Prepared SFX Library.7z`, 194 MB, downloaded 2026-09-25 with Jurek's approval) | The Free Firearm Sound Library — opengameart.org/content/the-free-firearm-sound-library — 96 kHz stereo field recordings. Used: Walther PPQ `X_39P` (near) / `X_31P` (mid), Colt 1911 `A_42P` / `A_34P`, Bersa .380 `F_47P` / `F_41P`, AK-47 `C_28P` / `C_31P`, Norinco SKS `U_14P` / `U_19P` | Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney | CC0 |
| `Voxel World/Audio (od jurka)/Shotgun/Shotgun reload+Shoot.mp3` | shotgun pump actions (used for the pistol slide / rifle bolt) | Jurek (provided by him) | owned |
| `Voxel World/assets/audio/explosion_huge.ogg` | Chunky Explosion — opengameart.org/content/chunky-explosion | Joth | CC0 |
| `Voxel World/assets/audio/explosion_0/1.ogg`, `explosion_small_0/1.ogg` | opengameart.org/content/explosions-4 | EZduzziteh | CC0 |
| `Voxel World/assets/audio/explosion_small_2.ogg` | bang_08 — opengameart.org/content/25-cc0-bang-firework-sfx | rubberduck | CC0 |
| `Voxel World/assets/audio/explosion_rumble.ogg` | Muffled Distant Explosion — opengameart.org/content/muffled-distant-explosion | NenadSimic | CC0 |
| `Voxel World/assets/audio/rocket_launch.ogg` | launch.wav — opengameart.org/content/rocket-launch | qubodup | CC0 |
| `Voxel World/assets/audio/swing_0..4.ogg` | Swishes Sound Pack — opengameart.org/content/swishes-sound-pack | artisticdude | CC0 |
| `Voxel World/assets/audio/footstep_concrete_0..5.ogg` | Fantozzi's Footsteps (Stone) — opengameart.org/content/fantozzis-footsteps-grasssand-stone | Fantozzi | CC0 |
| `Voxel World/assets/audio/bounce_clink_0/1.ogg`, `thud_1.ogg` | 75 CC0 breaking/falling/hit sfx; 100 CC0 metal and wood SFX (opengameart) | rubberduck | CC0 |
| `next/blender/spider/_cache/audio_raw/kenney/k_impact/` | Impact Sounds — kenney.nl/assets/impact-sounds | Kenney | CC0 |
| `next/blender/spider/_cache/audio_raw/kenney/k_rpg/` | RPG Audio — kenney.nl/assets/rpg-audio (cloth, metal clicks/latches, knife slices, creaks) | Kenney | CC0 |
| `game/assets/audio/rpg_launch.ogg`, `body_drop.ogg` | Kenney Sci-fi / Impact packs | Kenney | CC0 |
| `MarkZero/audio/sfx/thruster_hot`, `thruster_mid` | WWS Sandblasting / Saab J35D Draken (Wikimedia Commons) | Work With Sounds / Torsten Nilsson | CC BY 4.0 |
| `MarkZero/audio/sfx/concrete_a/c`, `rubble_b`, `glass_debris`, `wind_gust` | see `MarkZero/audio/CREDITS.md` | rubberduck (CC0) / Gravity Sound (CC BY 4.0) | CC0 / CC BY 4.0 |

## What is what
- Guns (real recordings, 2026-09-25 rebuild): single shots are cut out of the Free Firearm Sound Library by
  `next/blender/enemies/enshots.py` (onset detection, each shot keeps its own natural tail until the next shot).
  - `en_pistol_shot_1..6` — close: PPQ ×3, 1911 ×2, Bersa ×1; each = the near recording + the same gun's mid-distance
    recording as body (−6 dB) + diffuse street reflections (28 decaying taps, low-passed, −8 dB), light limiting,
    peak −1.5 dBFS, index gain 1.5. `en_pistol_shot_far_1..5` — the mid recordings, low-passed (air absorption) with a
    longer reflection tail, peak −4 dBFS.
  - `en_rifle_shot_1..6` — close: AK-47 ×4, SKS ×2 (same 7.62x39 cartridge), built the same way, peak −1 dBFS.
    `en_rifle_shot_far_1..4` — AK/SKS mid recordings, distant treatment.
  - Variant sets: `en_pistol_shot`, `en_pistol_shot_far`, `en_rifle_shot`, `en_rifle_shot_far`. Gunshots are
    peak-normalised (not loudnorm'd, which would flatten the transient).
  - Reloads: the library has gunshots only (no handling), so `en_pistol_mag_out/in`, `en_rifle_mag_out/in`,
    `en_rpg_*` stay Kenney metal clicks/latches and `en_pistol_slide` / `en_rifle_bolt` stay Jurek's pump recording.
  - `en_shell_drop_1..3`, `en_rpg_launch/flight`, `en_explosion`, `en_bullet_flyby`, `en_impact_concrete/metal` unchanged.
- Melee: `en_swish_1..4`, `en_knife_swish/hit`, `en_bat_swish/hit`, `en_punch_hit_1..3`, `en_hit_body`, `en_ground_pound`.
- Body: `en_step_1..6`, `en_cloth_1..4`, `en_body_fall`, `en_web_creak`.
- Voice (rebuilt 2026-09-26 from real non-verbal recordings; the old countdown-based files stay in
  `next/blender/enemies/_cache/_rejected_voice/`). Every take was transcribed with whisper (ggml-small, en) and anything
  that is a word was thrown out (`1yell3` "NOOO", `3yell15` / dpg take 7 "HELLO!", Baradari `paino` = the pack's "ouch",
  plus burps, coughs, sneezes, gagging, "baby cooing", "gibberish"). Spectrograms: `voices_spectrograms.png`.
  - `en_grunt_1..6` — short effort grunts: HaelDB `3grunt1`, `3grunt3`, `3grunt4`, `3grunt5`, `1yell6`, `2yell9`.
  - `en_pain_1..6` — sharp hit sounds: Baradari `pain1`, `pain2`, `pain4`, `pain5`, `painh`; HaelDB `1yell8` (yelp).
  - `en_death_1..6` — death groans: Baradari `die1`, `die2`, `deathh`; thebardofblasphemy takes 9, 12, 14.
  - `en_alert_1..3` — startled "huh?!" / gasp: HaelDB `1yell9`, `1yell10`, `3yell4`.
  - `en_struggle` — HaelDB `2yell2` + `2yell7` growls + `3grunt4`, with Kenney cloth.
  - `en_brute_roar` (HaelDB `2yell4` yell ×0.76 + `2yell11` growl ×0.82 + low rumble), `en_brute_grunt` (`3grunt1` ×0.74 +
    `2yell10` ×0.8), `en_brute_breath` (`3yell13` growl ×0.82, low-passed).
  - Processing: leading silence trimmed (cue-accurate), high-pass 90 Hz, gentle compression, loudnorm −16 LUFS.

- Variant sets (random pick): `en_pistol_shot`, `en_rifle_shot`, `en_shell_drop`, `en_swish`, `en_punch_hit`, `en_step`,
  `en_cloth`, `en_grunt`, `en_pain`, `en_death`.

Banned sources (refused by the build scripts): `suit-up-sequence*.mp3` (film clip with AC/DC "Back in Black") and
`faceplate-close*.mp3` (same film score). None of the enemy sounds use them.

Known limits: no spoken barks (non-verbal only, by design); reloads are not recorded on real guns (see above).
