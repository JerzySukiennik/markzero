# Classics sound credits

Every file is cut/layered/processed from recordings already vetted for
redistribution in this project (no synthesis, no new downloads). Built by
`next/blender/classics/audio-build.py` (44.1 kHz mono, loudnorm I=-16 LUFS, TP -1.5).

Sources: **U** = Jurek's own recordings (`Projects/MarkZero/audio/user-provided/`); **B** = the MarkZero bank (`Projects/MarkZero/audio/sfx/`, licences + original URLs in its CREDITS.md: Gravity Sound CC BY 4.0, rubberduck CC0, Work With Sounds CC BY 4.0 …); **K** = Kenney CC0 (`game/assets/audio/`, see its CREDITS.md).

| id | what | cut from |
|---|---|---|
| `cl_faceplate_close` | Mk II/III faceplate closing: slide flow + pressure hiss + latch + seat | B nano_flow band 500-3500 + B thruster_hot hiss + B latch @0.95x + B concrete_c lowpass |
| `cl_faceplate_open` | Mk II/III faceplate unlock + lift | B latch @1.25x + B thruster_hot hiss + B nano_flow |
| `cl_mk1_visor` | Mk I welded visor slamming (scrap clatter + crude latch, no ring) | B metal_debris @0.8x + B latch @0.75x + B concrete_b lowpass 900 Hz |
| `cl_servo_fast` | fast robot-arm sweep (hydraulic rush, no pitch) | B thruster_mid 0.3-0.85 s band 150-1800 Hz + B rubble_b 0-0.5 s lowpass 400 Hz |
| `cl_servo_small` | small precise approach (fine hydraulic flow, no pitch) | B nano_flow 0.5-0.85 s band 400-3000 Hz |
| `cl_servo_big` | big actuator move / arm stows (heavy hydraulics, no pitch) | B thruster_mid lowpass 900 + B rubble_b lowpass 350 + B concrete_b lowpass 800 |
| `cl_hiss` | pneumatic release hiss | B thruster_hot (sandblasting nozzle) 0.6-1.6 s, highpass 1.4 kHz, exponential decay |
| `cl_impact_driver` | torque head: ratcheting burst + seat click (no motor pitch) | B metal_debris @1.2x band 400-6000 Hz with 24 Hz tremolo (ratchet) + B latch @0.9x |
| `cl_clamp_lock` | armour piece clamps home (thud + latch, no ring) | B latch @0.85x + B concrete_c lowpass 900 Hz + B metal_debris 0-0.15 s |
| `cl_plate_clank` | plate touches plate (dull, no ring) | B concrete_c + B latch @1.1x |
| `cl_sparks` | spark crackle when a bolt seats | B metal_debris @1.4x, highpass 2.5 kHz |
| `cl_floor_unlock` | floor hatches unlock and drop (thud, latch, hiss) | B latch @0.8x + B concrete_b lowpass 700 + B metal_debris lowpass 2.5k + hiss |
| `cl_floor_open` | floor hatches swing down / up (rumble + seat) | B rubble_b lowpass 600 + B concrete_a lowpass 1.5k + hiss |
| `cl_gantry_rise` | robot arms rise out of the pit (hydraulic lift, no pitch) | B thruster_mid 0-1.6 s lowpass 700 + B rubble_b lowpass 300 |
| `cl_reactor_on` | arc reactor housing locks + ring lights up (hum swell) | B latch @0.9x + B reactor 0-1.6 s + B repulsor_charge @0.8x lowpassed |
| `cl_reactor_off` | reactor ring powers down + housing unlocks (suit-off) | B reactor reversed + B latch @0.85x |
| `cl_hud_on` | eyes / HUD boot chirp when the faceplate locks | B hud_confirm + B hud_scan 0-0.8 s + B servo_fine @1.4x |
| `cl_hud_off` | HUD shuts off (suit-off) | B hud_click + B hud_tick @0.8x |
| `cl_mk1_hydraulic` | Mk I clunky hydraulics (knee/elbow pistons) | B servo_grind @0.65x + hiss tail |
| `cl_mk1_step` | Mk I heavy step — Jurek's armour step, pitched down + scrap rattle | U steps/step-03 @0.82x + B clank_scrap @0.8x + B servo_grind |
| `cl_flame_loop` | flamethrower roar (loop) | B thruster_hot @0.78x lowpass 6.5 kHz + B thruster_sub, crossfade-looped |
| `cl_flame_start` | flamethrower valve + ignition whoomp | B latch + K boost @0.8x + head of cl_flame_loop |
| `cl_flame_stop` | flamethrower shut-off | tail of cl_flame_loop + B latch @0.85x |
| `cl_rocket_launch` | Mk I forearm rocket launch (crude) | K rpg_launch @0.85x + B clank_scrap |
| `cl_missile_launch` | Mk III forearm mini-missile launch | K rpg_launch + B thruster_whine @1.3x |
| `cl_pod_open` | forearm pod hatch flips open | B latch @1.2x + B servo_fine @1.3x |
| `cl_pod_close` | forearm pod hatch shuts | B servo_fine @1.3x + B latch |
| `cl_hatch_pop` | flare hatches pop | B latch @1.4x + hiss |
| `cl_hatch_close` | flare hatches close | B latch @1.1x |
| `cl_flare` | countermeasure flare pop + fizz | K rpg_launch head @1.6x + B thruster_hot @1.5x highpass |
| `cl_flaps_open` | stabiliser flaps deploy | B servo_fast @1.25x |
| `cl_flaps_close` | stabiliser flaps stow | B servo_fast @1.2x + B clank_light @1.3x |
