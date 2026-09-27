# UI sound pack — credits

Every file in `v3/assets/audio/ui/` is built by `v3/design/tools/build_ui_audio.py` from **real recordings only** (no oscillators): layered, varispeeded, filtered, with a small convolution plate made of filtered noise. Delivered as `.ogg` (oggenc -q 6) + `.mp3` (192k), 44.1 kHz stereo, each normalised to max-momentary −16 LUFS (400 ms K-weighted) and capped at −1.5 dBFS peak; the per-sound mix level is `gain` in `index.json` (bus `ui`).

## Licences in use

* **CC0 1.0 / Public domain** — no attribution required (credited anyway).
* **CC BY 4.0** — inherited through reused NEXT bank layers; attribution below is required in the game credits.

## A. Recordings fetched for this pack (Wikimedia Commons) — code `C:` in the recipes

| source | author | licence | used as |
|---|---|---|---|
| [Clickick switch.ogg](https://commons.wikimedia.org/wiki/File%3AClickick_switch.ogg) | stephan | Public domain | switch clicks (back, thump) |
| [Dipswitch on off.ogg](https://commons.wikimedia.org/wiki/File%3ADipswitch_on_off.ogg) | stephan | Public domain | muted knocks (error) |
| [Mechanical tack.ogg](https://commons.wikimedia.org/wiki/File%3AMechanical_tack.ogg) | stephan | Public domain | slide + latch (tab, panels) |
| [Computer mouse single click.ogg](https://commons.wikimedia.org/wiki/File%3AComputer_mouse_single_click.ogg) | Darklanlan | CC0 | click body (confirm, joined) |
| [415061 gsb1039 clock-chime-tubebells-handbells-vibes.wav](https://commons.wikimedia.org/wiki/File%3A415061_gsb1039_clock-chime-tubebells-handbells-vibes.wav) | gsb1039 | CC0 | tubular-bell strikes, varispeeded x2-x10 (the 'sparkle' of every sound) |
| [SingingBowl1.ogg](https://commons.wikimedia.org/wiki/File%3ASingingBowl1.ogg) | BambooBeast | Public domain | bowl bloom/shimmer (room, map, error beating) |
| [SingingBowl2.ogg](https://commons.wikimedia.org/wiki/File%3ASingingBowl2.ogg) | BambooBeast | Public domain | bowl shimmer (panels, retint, glowing suits) |
| [Wine glass.ogg](https://commons.wikimedia.org/wiki/File%3AWine_glass.ogg) | hugh | Public domain | downloaded, auditioned, NOT used (too quiet/noisy) |
| [Tuning-fork-440Hz.ogg](https://commons.wikimedia.org/wiki/File%3ATuning-fork-440Hz.ogg) | jmuehlhans | CC0 | pure tone (countdown, ping, scan) |
| [Auslösegeräusch SLR Serienaufnahme mit AF Schärfepriorität.ogg](https://commons.wikimedia.org/wiki/File%3AAusl%C3%B6seger%C3%A4usch_SLR_Serienaufnahme_mit_AF_Sch%C3%A4rfepriorit%C3%A4t.ogg) | Smial (talk) | CC0 | camera-shutter micro clicks (focus, ticks, zoom, ping) |

## B. Layers reused from the vetted NEXT banks — code `N:` in the recipes

Taken as-is from `next/assets/audio/<area>/<id>.ogg`; their original sources, authors and cuts are logged row by row in the bank credits (`next/assets/audio/{classics,core,mk42,mk85,hulkbuster,spider}/CREDITS-*.md`, which in turn point at `Projects/MarkZero/audio/CREDITS.md` and Jurek's own recordings). Used here: `cl_servo_small, cl_mk1_hydraulic, cl_plate_clank, cl_flame_start, cl_servo_fast, cl_clamp_lock, cl_faceplate_close, thruster_whine, mk42_whoosh_1, mk42_whoosh_2, mk42_whoosh_big_1, mk42_lock_1, mk42_lock_2, mk42_lock_big_1, mk42_lock_big_2, mk42_suit_ready, im_thruster_burst, mk85_nano_flow, mk85_nano_crystallise, mk85_nano_lock, hb_clamp_heavy, hb_step_heavy_1, hb_hydraulic_hiss, sp_nano_seal, sp_leg_deploy, sp_lens_focus, sp_thwip_1, sp_sneaker_1, sp_cloth_1`.

**Required attribution inherited through those layers (CC BY 4.0):** Gravity Sound (Wikimedia Commons — latch/lock, metal hits, servo scrapes, 'Complete' chime); Work With Sounds / Torsten Nilsson (Saab J35D Draken, sandblasting — thruster whine); plus the other CC BY 4.0 rows listed in `CREDITS-mk85.md` for `im_thruster_burst` and `mk85_nano_flow`. Everything else in those banks used here is CC0 / public domain or Jurek's own recordings.

## C. Per-sound recipes

| id | ms | gain | what | recipe |
|---|---|---|---|---|
| `ui_focus_1` | 94 | 0.55 | focus moved to the next item (round-robin 1-3) | C:SLR shutter click #1 HP1.8k + C:tubular bell strike 0 x8 speed, 90 ms, -13 dB |
| `ui_focus_2` | 94 | 0.55 | focus moved to the next item (round-robin 1-3) | C:SLR shutter click #4 HP1.8k + C:tubular bell strike 1 x8 speed, 90 ms, -13 dB |
| `ui_focus_3` | 94 | 0.55 | focus moved to the next item (round-robin 1-3) | C:SLR shutter click #7 HP1.8k + C:tubular bell strike 2 x8 speed, 90 ms, -13 dB |
| `ui_slider_tick_1` | 34 | 0.4 | slider step (1-3 = low/mid/high end of the range) | C:SLR click #9 HP3k, varispeed x1.00 |
| `ui_slider_tick_2` | 30 | 0.4 | slider step (1-3 = low/mid/high end of the range) | C:SLR click #10 HP3k, varispeed x1.12 |
| `ui_slider_tick_3` | 26 | 0.4 | slider step (1-3 = low/mid/high end of the range) | C:SLR click #11 HP3k, varispeed x1.26 |
| `ui_confirm` | 987 | 0.8 | confirm / select (cross or A) | C:mouse click + C:switch x0.45 LP900 (thump) + C:bell x4 450 ms + C:bell x8 250 ms, 0.25 s plate |
| `ui_back` | 824 | 0.65 | back / cancel (circle or B) | C:SLR click reversed LP6k (air) + C:switch #2 + C:bell x3 280 ms, 0.2 s plate |
| `ui_error` | 319 | 0.7 | invalid action / cannot select (pairs with danger colour) | C:dipswitch x0.6 + x0.55 LP2k (two knocks 85 ms apart) + C:singing bowls 1 & 2 detuned 6 % (beating) |
| `ui_tab` | 199 | 0.6 | tab / shoulder-button page switch (L1/R1) | C:mechanical tack x1.35 HP400 + C:bell x8 80 ms |
| `ui_panel_open` | 1213 | 0.7 | panel / menu opens (holo slide-in) | N:mk42_whoosh_1 0.35-0.8 s HP500 + N:cl_servo_small x1.5 + C:tack latch + C:bowl 2 x2 + C:bell x8 |
| `ui_panel_close` | 1036 | 0.65 | panel / menu closes | N:mk42_whoosh_1 reversed + N:cl_servo_small x1.2 + C:tack latch x0.8 LP5k |
| `ui_room_created` | 2688 | 0.9 | room opened / hosted — a small ceremony | N:mk42_lock_big_1 + C:bell x2 1.4 s + C:bell x3 1.0 s + C:bowl 1 x2 + C:bell x8, 0.6 s plate |
| `ui_player_joined` | 1440 | 0.75 | a player joined the room (rising third) | C:mouse click + C:bell x4 then x5.04 (+4 st) 110 ms apart + C:bell x10 |
| `ui_player_left` | 1409 | 0.6 | a player left the room (falling third, darker) | C:bell x5.04 then x4, LP 4k / 3k, 120 ms apart |
| `ui_ready` | 981 | 0.75 | player toggled READY | N:mk42_lock_1 (clamp click + ring + thump) + C:bell x6 350 ms |
| `ui_unready` | 462 | 0.6 | player un-readied | N:mk42_lock_2 x0.85 LP4k |
| `ui_countdown_3` | 280 | 0.7 | match start countdown tick 3 | C:SLR click + C:tuning fork x2 (880 Hz) 280 ms |
| `ui_countdown_2` | 280 | 0.7 | match start countdown tick 2 | C:SLR click + C:tuning fork x2 (880 Hz) 280 ms |
| `ui_countdown_1` | 280 | 0.7 | match start countdown tick 1 | C:SLR click + C:tuning fork x2 (880 Hz) 280 ms |
| `ui_countdown_go` | 3014 | 1.0 | match start — GO | N:mk42_lock_big_2 + N:im_thruster_burst + C:fork x3 (1320 Hz) + C:bell x2 + N:mk42_whoosh_big_1, 0.7 s plate |
| `ui_map_zoom_in` | 215 | 0.5 | map zoom step in (R2) | N:sp_lens_focus x1.25 + C:SLR click + C:bell x9 |
| `ui_map_zoom_out` | 173 | 0.5 | map zoom step out (L2) | N:sp_lens_focus reversed x0.9 + C:SLR click |
| `ui_map_ping` | 3290 | 0.85 | map ping / mark (square) — sonar with two echoes | C:SLR click + C:tuning fork x3 (1320 Hz) 700 ms + C:bell x6, echoes at 220/440 ms LP 5k/3k, 0.8 s plate |
| `ui_map_open` | 2253 | 0.8 | full map opens — pairs with the rise-reveal (starts at t=0, bell lands at 120 ms) | N:mk42_whoosh_2 + C:bowl 1 x3 + C:bell x4 + C:SLR click, 0.5 s plate |
| `ui_map_close` | 517 | 0.65 | full map closes | N:mk42_whoosh_2 reversed + C:switch |
| `ui_retint_wave` | 2899 | 0.7 | palette wave sweeping the UI on suit change (layer under the suit stinger) | N:mk42_whoosh_big_1 + C:bowl 2 x4 + C:bell x8, 0.6 s plate |
| `ui_scan_sweep` | 895 | 0.35 | map / HUD scan sweep passing (quiet one-shot; retrigger with each sweep) | N:mk42_whoosh_1 band-passed 3.5k + C:fork x4 faint |
| `ui_suit_mk1` | 2254 | 0.9 | suit select stinger — raw steel: hydraulic + plate clank + ember flame | N:cl_mk1_hydraulic + N:cl_plate_clank + N:cl_flame_start + C:bell x1.80 tail |
| `ui_suit_mk2` | 2135 | 0.9 | suit select stinger — brushed silver + ice: fast servo + clamp + high icy bell/bowl | N:cl_servo_fast + N:cl_clamp_lock + C:bell x6.00 tail + C:bowl 2 shimmer |
| `ui_suit_mk3` | 2337 | 0.9 | suit select stinger — hot-rod: faceplate slam + clamp + thruster whine tail | N:cl_faceplate_close + N:cl_clamp_lock + N:thruster_whine + C:bell x3.00 tail |
| `ui_suit_mk42` | 2207 | 0.9 | suit select stinger — plates clamping in a burst + suit-ready chime | N:mk42_lock_1 + N:mk42_lock_2 + N:mk42_lock_big_1 + N:mk42_suit_ready + C:bell x4.00 tail |
| `ui_suit_mk85` | 2310 | 0.9 | suit select stinger — nanotech: flow -> crystallise -> lock + cyan shimmer | N:mk85_nano_flow + N:mk85_nano_crystallise + N:mk85_nano_lock + C:bell x5.04 tail + C:bowl 2 shimmer |
| `ui_suit_hulkbuster` | 2253 | 0.9 | suit select stinger — heavy clamp + a giant step + hydraulic hiss | N:hb_clamp_heavy + N:hb_step_heavy_1 + N:hb_hydraulic_hiss + C:bell x1.50 tail |
| `ui_suit_ironspider` | 2204 | 0.9 | suit select stinger — nano seal + spider legs deploy + lens focus | N:sp_nano_seal + N:sp_leg_deploy + N:sp_lens_focus + C:bell x4.50 tail + C:bowl 2 shimmer |
| `ui_suit_peter` | 2276 | 0.9 | suit select stinger — web thwip + sneaker landing + cloth (no metal: out of suit) | N:sp_thwip_1 + N:sp_sneaker_1 + N:sp_cloth_1 + C:bell x6.00 tail |

Rebuild: `python3 v3/design/tools/audio_fetch.py && python3 v3/design/tools/build_ui_audio.py` (raw downloads cached in `v3/design/tools/_cache/`, git-ignored). Analysis sheets (waveform + log spectrogram of every output): `v3/docs/design/ui_audio_sheet_{1,2}.png`.
