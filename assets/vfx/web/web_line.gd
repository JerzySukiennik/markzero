class_name WebFXLine
extends RefCounted
## One web line (tether) — port of `WebLine` in web.three.js (the visual reference).
##
## Jurek's complaint was that the old line was "zwykla nitka", a plain thread, and he wanted
## "prawdziwe sieci". So this is SILK: a verlet rope of `rope_points` points, drawn as a bright
## core wrapped in fine, irregular, twisted fibres plus a fixed-pixel halo. When the gap reaches
## the rope's length it is carrying weight and goes dead straight with a tension ripple; shorter,
## it sags into a catenary on its own. States: "flying" → "attached" → "released" → "dead".
##
## Named WebFXLine (not WebLine) so it can live next to the old game/scripts/combat/web_line.gd
## until that one is deleted.

const MAXS := 64

## The owning WebFX. Untyped on purpose: WebFX preloads this script, so a typed back-reference
## would be a cyclic dependency. Only its public helpers are called.
var fx = null
var kind := "swing"
var state := "flying"
var reach := 0.0
var tension := 0.0
var travel_speed := 320.0
var silent := false
var on_attach := Callable()

var from_node: Node3D = null
var from_point := Vector3.ZERO
var to_node: Node3D = null
var to_local := Vector3.ZERO
var to_point := Vector3.ZERO
var known_normal := Vector3.ZERO

var n_pts := 28
var p := PackedVector3Array()
var o := PackedVector3Array()
var hand := Vector3.ZERO
var anchor := Vector3.ZERO
var hand_prev := Vector3.ZERO
var anchor_prev := Vector3.ZERO
var retract_from := Vector3.ZERO
var age := 0.0
var state_age := 0.0
var twang := 0.0
## Extra high-frequency vibration (web-zip). 0..1.
var thrum := 0.0
var snapped := false
var break_at := -1
var seg_scale := 1.0
var pin_hand := true
var pin_anchor := true
var mode := "normal"
var fade := 1.0
var line_seed := 0.0
var fib := PackedFloat32Array()
var tip_glob = null

var _rest := 0.0
var _rest_set := false
var _low := 1.0
var _creak_cool := 0.0

# render scratch (per line, allocated once)
var _sp := PackedVector3Array()
var _st := PackedVector3Array()
var _sn := PackedVector3Array()
var _sb := PackedVector3Array()
var _arc := PackedFloat32Array()
var _su := PackedFloat32Array()

## Rope length. Defaults to the distance at the moment the line lands; set it to reel in/out.
var rest_length: float:
	get:
		return _rest
	set(value):
		_rest = maxf(0.05, value)
		_rest_set = true

## `from` is the emitter Node3D (re-read every frame) or a Vector3. `to` is a Vector3, a Node3D,
## or {"object": Node3D, "local": Vector3}.
func setup(owner_fx, from: Variant, to: Variant, speed: float, line_kind: String, is_silent: bool) -> void:
	fx = owner_fx
	kind = line_kind
	travel_speed = speed
	silent = is_silent
	if from is Node3D:
		from_node = from
	else:
		from_point = from
	if to is Node3D:
		to_node = to
	elif to is Dictionary:
		to_node = to.get("object", null)
		to_local = to.get("local", Vector3.ZERO)
	else:
		to_point = to
	n_pts = int(fx.look["rope_points"])
	p.resize(n_pts)
	o.resize(n_pts)
	var rng: RandomNumberGenerator = fx.rng
	line_seed = rng.randf() * 100.0
	var nf := int(fx.look["fibres"])
	fib.resize(nf * 5)
	for f in nf:
		fib[f * 5] = float(f) / nf * TAU + (rng.randf() - 0.5) * 0.7   # phase
		fib[f * 5 + 1] = 0.45 + 0.55 * rng.randf()                       # radius factor
		fib[f * 5 + 2] = rng.randf() if rng.randf() < 0.35 else -1.0     # stray loop position
		fib[f * 5 + 3] = 2.5 + rng.randf() * 3.0                         # loop size (x braid)
		fib[f * 5 + 4] = rng.randf() * 0.55                              # dissolve offset
	_sp.resize(MAXS); _st.resize(MAXS); _sn.resize(MAXS); _sb.resize(MAXS)
	_arc.resize(MAXS); _su.resize(MAXS)
	_resolve()
	hand_prev = hand
	anchor_prev = anchor
	for i in n_pts:
		p[i] = hand
		o[i] = hand
	tip_glob = fx.glob_take("tip")

func is_alive() -> bool:
	return state != "dead"

func _resolve() -> void:
	if pin_hand:
		if from_node != null:
			if is_instance_valid(from_node) and from_node.is_inside_tree():
				hand = from_node.global_position
		else:
			hand = from_point
	if mode == "retract":
		return
	if to_node != null:
		if is_instance_valid(to_node) and to_node.is_inside_tree():
			anchor = to_node.global_transform * to_local
	else:
		anchor = to_point

## Detach at the hand: the line goes slack, wobbles, falls away and dissolves.
func release() -> void:
	if state == "dead" or state == "released":
		return
	var was_flying := state == "flying"
	state = "released"
	state_age = 0.0
	pin_hand = false
	fade = float(fx.look["release_fade"])
	if was_flying:
		pin_anchor = false
		_rest = _polyline_length()
	# a flick at the free end, so it visibly lets go instead of just drooping
	var rng: RandomNumberGenerator = fx.rng
	var kick := Vector3((rng.randf() - 0.5) * 3.0, 1.5 + rng.randf() * 1.5, (rng.randf() - 0.5) * 3.0)
	for i in 4:
		o[i] -= kick * ((4.0 - i) / 4.0 / 120.0)
	_free_tip()
	if not silent:
		fx.emit_sound("sp_web_release", hand, 0.8)
		fx.emit_juice_set("release")

## Break mid-span: both halves recoil toward their ends with a whip and dissolve.
func snap() -> void:
	if state != "attached":
		release()
		return
	var rng: RandomNumberGenerator = fx.rng
	state = "released"
	state_age = 0.0
	snapped = true
	fade = float(fx.look["snap_fade"])
	break_at = int(n_pts * (0.4 + rng.randf() * 0.2))
	var b := break_at
	var u := (anchor - hand).normalized()
	var n := perp_of(u)
	var q := u.cross(n)
	var recoil := 11.0 + 9.0 * tension
	var h := 1.0 / 120.0
	for i in n_pts:
		var hand_side := i <= b
		var w: float = float(i) / maxi(b, 1) if hand_side else float(n_pts - 1 - i) / maxi(n_pts - 2 - b, 1)
		var s := -1.0 if hand_side else 1.0
		var lat := sin(w * 9.0 + (0.0 if hand_side else 2.0)) * 5.0 * w
		var lat2 := cos(w * 7.0) * 3.0 * w
		var v := u * s * recoil * w + n * lat + q * lat2
		o[i] = p[i] - v * h
	var at := p[b]
	for _k in 10:
		var vel := Vector3((rng.randf() - 0.5) * 6.0, (rng.randf() - 0.3) * 5.0, (rng.randf() - 0.5) * 6.0)
		fx.fibre_spawn(at, vel, 0.35 + rng.randf() * 0.25, 0.12 + rng.randf() * 0.2, 0.0008, 0.9, 0.04, rng.randf() * 10.0, 3.0, 3.0, 0.55, 0.3, 0.05)
	fx.sprite_spawn(at, Vector3.ZERO, 0.12, 0.08, 0.35, 0.8, 2, 1.0)
	if not silent:
		fx.emit_sound("sp_web_snap", at, 1.0)
		fx.emit_juice_set("snap")

## Reel the line back into the wrist (pull() does this after the yank).
func retract() -> void:
	if state == "dead":
		return
	state = "released"
	mode = "retract"
	state_age = 0.0
	retract_from = anchor
	fade = 0.16

func dispose() -> void:
	state = "dead"
	_free_tip()

func _free_tip() -> void:
	if tip_glob != null:
		fx.glob_free(tip_glob)
		tip_glob = null

func _polyline_length() -> float:
	var s := 0.0
	for i in n_pts - 1:
		s += p[i].distance_to(p[i + 1])
	return maxf(s, 0.1)

func update(dt: float) -> void:
	if state == "dead":
		return
	age += dt
	state_age += dt
	hand_prev = hand
	anchor_prev = anchor
	_resolve()
	if state == "flying":
		var d := maxf(hand.distance_to(anchor), 0.3)
		reach = minf(1.0, reach + travel_speed * dt / d)
		_lay_flying(d)
		if reach >= 1.0:
			_attach()
		return
	if state == "attached":
		if _creak_cool > 0.0:
			_creak_cool -= dt
		_sim(dt, true, true)
		_taut(dt)
		return
	# released
	if mode == "retract":
		var k := clampf(state_age / fade, 0.0, 1.0)
		anchor = retract_from.lerp(hand, k * k)
		_rest = maxf(0.05, hand.distance_to(anchor) * 1.01)
		_sim(dt, true, true)
		if k >= 1.0:
			dispose()
		return
	if snapped:
		seg_scale = lerpf(1.0, 0.72, smoothstep(0.0, 0.15, state_age))
	_sim(dt, snapped, pin_anchor)
	if state_age >= fade:
		dispose()

func _lay_flying(d: float) -> void:
	var u := (anchor - hand) / d
	var n := perp_of(u)
	var b := u.cross(n)
	var length := d * reach
	var amp := minf(0.07, 0.005 * length)
	var t := length / travel_speed
	for i in n_pts:
		var f := float(i) / (n_pts - 1)
		var env := sin(PI * f) * (1.0 - 0.4 * f)
		var w := sin(f * 9.0 - age * 55.0 + line_seed) * amp * env
		var w2 := cos(f * 6.0 - age * 41.0 + line_seed * 2.0) * amp * 0.6 * env
		var sag := 2.0 * t * t * sin(PI * f) * (1.0 - f) * 4.0
		var pos := hand + u * (f * length) + n * w + b * w2 - Vector3(0.0, sag, 0.0)
		p[i] = pos
		o[i] = pos
	if tip_glob != null:
		tip_glob.pos = p[n_pts - 1]
		tip_glob.vel = u * travel_speed
		tip_glob.age = age
		fx.glob_pose(tip_glob)

func _attach() -> void:
	state = "attached"
	state_age = 0.0
	reach = 1.0
	if not _rest_set:
		_rest = hand.distance_to(anchor)
	_free_tip()
	fx.on_line_attach(self)
	if on_attach.is_valid():
		on_attach.call(self)

func _sim(dt: float, pin0: bool, pin_n: bool) -> void:
	if dt <= 0.0:
		return
	var lk: Dictionary = fx.look
	var steps := maxi(1, ceili(dt * 120.0 - 1e-6))
	var h := dt / steps
	var g := Vector3(0.0, -float(lk["rope_gravity"]) * h * h, 0.0)
	var damp := pow(float(lk["rope_damp"]), h * 120.0)
	var seg := _rest / (n_pts - 1) * seg_scale
	var iters := int(lk["rope_iter"])
	var last := n_pts - 1
	var gy: float = fx.ground_y
	for s in range(1, steps + 1):
		var k := float(s) / steps
		for i in n_pts:
			var v := (p[i] - o[i]) * damp
			o[i] = p[i]
			p[i] += v + g
		if pin0:
			p[0] = hand_prev.lerp(hand, k)
		if pin_n:
			p[last] = anchor_prev.lerp(anchor, k)
		for it in iters:
			var fwd := (it & 1) == 0
			for c in last:
				var i := c if fwd else last - 1 - c
				if i == break_at:
					continue
				var dv := p[i + 1] - p[i]
				var d := dv.length()
				if d <= seg or d < 1e-9:
					continue       # a rope pulls, it never pushes
				var wa := 0.0 if (i == 0 and pin0) else 1.0
				var wb := 0.0 if (i + 1 == last and pin_n) else 1.0
				var w := wa + wb
				if w == 0.0:
					continue
				var corr := dv * ((d - seg) / d / w)
				p[i] += corr * wa
				p[i + 1] -= corr * wb
		if gy > -1e20:
			for i in n_pts:
				if p[i].y < gy:
					var q := p[i]
					q.y = gy
					p[i] = q
					var oo := o[i].lerp(q, 0.3)
					oo.y = gy
					o[i] = oo

## When the gap reaches the rope's length it carries load: dead straight, tension up.
func _taut(dt: float) -> void:
	var d := hand.distance_to(anchor)
	var ratio := d / maxf(_rest, 1e-3)
	var k := smoothstep(0.975, 1.0, ratio)
	if k > 0.0:
		for i in n_pts:
			var f := float(i) / (n_pts - 1)
			var s := hand.lerp(anchor, f)
			var q := hand_prev.lerp(anchor_prev, f)
			var vel := (p[i] - o[i]).lerp(s - q, k)
			p[i] = p[i].lerp(s, k)
			o[i] = p[i] - vel
	var raw := clampf((ratio - 0.965) / 0.035, 0.0, 1.0)
	var prev := tension
	tension = raw if raw > prev else maxf(raw, prev - dt * 5.0)
	if dt > 0.0 and tension - prev > 0.3:
		twang = maxf(twang, clampf((tension - prev) * 1.4, 0.0, 1.0))
	twang *= exp(-dt * 5.5)
	_low = 0.0 if tension < 0.5 else _low + dt
	if tension >= 0.8 and prev < 0.8 and _low < 0.25 and _creak_cool <= 0.0 and state_age > 0.12:
		_creak_cool = 0.4
		twang = maxf(twang, 0.8)
		if not silent:
			fx.emit_sound("sp_web_creak_%d" % (1 + fx.rng.randi_range(0, 1)), hand, 0.7)
			fx.emit_juice_set("creak")

# ---- drawing ------------------------------------------------------------------------------

func draw() -> void:
	if state == "dead":
		return
	var alpha := 1.0
	var spread := 1.0
	var drift := 0.0
	if state == "released" and mode != "retract":
		var k := clampf(state_age / fade, 0.0, 1.0)
		alpha = 1.0 - k
		spread = 1.0 + 3.5 * k * k
		drift = k
	if snapped:
		_draw_range(0, break_at, alpha, spread, drift, 0.0, 1.0)
		_draw_range(break_at + 1, n_pts - 1, alpha, spread, drift, 1.0, 0.0)
	else:
		_draw_range(0, n_pts - 1, alpha, spread, drift, 0.0, 1.0 if state == "flying" else 0.0)

## Draws sim points i0..i1; fray_a / fray_b fan the fibres out at that end.
func _draw_range(i0: int, i1: int, alpha: float, spread: float, drift: float, fray_a: float, fray_b: float) -> void:
	if i1 - i0 < 1:
		return
	var lk: Dictionary = fx.look
	var t: float = fx.time
	var length := 0.0
	for i in range(i0, i1):
		length += p[i].distance_to(p[i + 1])
	if length < 0.02:
		return
	var m := clampi(roundi(length / 0.3), 12, MAXS)
	var span := float(i1 - i0)
	# 1. Catmull-Rom samples
	for j in m:
		var f := i0 + float(j) / (m - 1) * span
		var k := mini(floori(f), i1 - 1)
		var u := f - k
		var pa := p[maxi(k - 1, i0)]
		var pb := p[k]
		var pc := p[mini(k + 1, i1)]
		var pd := p[mini(k + 2, i1)]
		var u2 := u * u
		var u3 := u2 * u
		_sp[j] = pa * (-0.5 * u3 + u2 - 0.5 * u) + pb * (1.5 * u3 - 2.5 * u2 + 1.0) + pc * (-1.5 * u3 + 2.0 * u2 + 0.5 * u) + pd * (0.5 * u3 - 0.5 * u2)
		_su[j] = f / (n_pts - 1)
	# 2. tension ripple (render only): standing waves, fast when under load
	var taut := state == "attached" or mode == "retract"
	if taut and not snapped:
		var amp := minf(0.09, length * (0.0010 * tension + 0.011 * twang) + thrum * (0.010 + 0.0015 * length))
		if amp > 1e-4:
			var f1 := 24.0 if thrum > 0.05 else clampf(60.0 / maxf(length, 1.0), 4.0, 16.0)
			var w1 := TAU * f1 * t
			var w2 := TAU * f1 * 1.93 * t
			var w3 := TAU * f1 * 3.1 * t
			var ax := (_sp[m - 1] - _sp[0]).normalized()
			var n := perp_of(ax)
			var b := ax.cross(n)
			for j in range(1, m - 1):
				var f := float(j) / (m - 1)
				var m1 := sin(PI * f) * sin(w1) + 0.45 * sin(TAU * f) * sin(w2 + 1.3) + 0.25 * sin(3.0 * PI * f) * sin(w3 + 2.1)
				var m2 := sin(PI * f) * cos(w1 * 1.07 + 0.4) + 0.4 * sin(TAU * f) * cos(w2 * 0.96)
				_sp[j] += (n * m1 + b * m2 * 0.6) * amp
	# 3. tangents, arc length, parallel-transport frame
	var arc := 0.0
	for j in m:
		var tv := (_sp[mini(j + 1, m - 1)] - _sp[maxi(j - 1, 0)]).normalized()
		_st[j] = tv
		if j > 0:
			arc += _sp[j].distance_to(_sp[j - 1])
		_arc[j] = arc
		var nv: Vector3
		if j == 0:
			nv = perp_of(tv)
		else:
			nv = _sn[j - 1]
			nv = (nv - tv * nv.dot(tv)).normalized()
		_sn[j] = nv
		_sb[j] = tv.cross(nv)
	var flying := state == "flying"
	var halo_hw := 0.0
	# 4a. halo — fixed-pixel additive sheath (readable against a bright sky, fades near camera)
	fx.strand_begin(0.0, 1.0, float(lk["min_px_halo"]), fmod(line_seed, 1.0))
	for j in m:
		fx.strand_pt(_sp[j], halo_hw, float(lk["halo_a"]) * alpha * (0.4 + 0.6 * smoothstep(0.0, 0.04, _arc[j])))
	fx.strand_end()
	# 4b. core
	var core_hw: Array = lk["core_hw"]
	var core_a := float(lk["core_a"])
	if state == "released":
		core_a *= maxf(0.0, 1.0 - state_age / (fade * 0.55))
	if core_a > 0.002:
		fx.strand_begin(1.0, float(lk["core_glow"]), float(lk["min_px_core"]), fmod(line_seed + 0.5, 1.0))
		for j in m:
			var jj := float(j) / (m - 1)
			var tip := 1.0 + 1.6 * smoothstep(0.82, 1.0, jj) if flying else 1.0
			fx.strand_pt(_sp[j], lerpf(core_hw[0], core_hw[1], _su[j]) * tip, core_a * alpha)
		fx.strand_end()
	# 4c. fibres — twisted, each with its own radius, wobble and (sometimes) a stray loop
	var nf := int(lk["fibres"])
	var braid: Array = lk["braid"]
	var fibre_hw: Array = lk["fibre_hw"]
	var pitch := maxf(0.55, 5.0 * length / (m - 1))
	var twist := TAU / pitch
	for f in nf:
		var ph := fib[f * 5]
		var rf := fib[f * 5 + 1]
		var loop_u := fib[f * 5 + 2]
		var loop_k := fib[f * 5 + 3]
		var dis := fib[f * 5 + 4]
		var fa := float(lk["fibre_a"]) * alpha
		if state == "released" and mode != "retract":
			fa *= 1.0 - smoothstep(dis, dis + 0.45, clampf(state_age / fade, 0.0, 1.0))
		if fa < 0.004:
			continue
		fx.strand_begin(float(lk["fibre_bright"]), float(lk["fibre_glow"]), float(lk["min_px_fibre"]), fmod(line_seed + f * 0.37, 1.0))
		var loop_arc := loop_u * length if loop_u >= 0.0 else -99.0
		for j in m:
			var u := _su[j]
			var jj := float(j) / (m - 1)
			var a := _arc[j]
			var conv := (0.15 + 0.85 * smoothstep(0.0, 0.05, a)) * (0.35 + 0.65 * (1.0 - smoothstep(length - 0.08, length, a)))
			var fray := fray_b * smoothstep(0.72, 1.0, jj) + fray_a * (1.0 - smoothstep(0.0, 0.28, jj))
			conv *= 1.0 + 3.2 * fray * fray
			var br := lerpf(braid[0], braid[1], u) * rf * (1.0 + 0.38 * noise1(a * 2.1 + f * 7.3 + line_seed)) * conv * spread
			if loop_arc > -1.0:
				var z := (a - loop_arc) / 0.2
				br += float(braid[0]) * loop_k * exp(-z * z)
			var ang := ph + a * twist + 0.55 * noise1(a * 1.3 + f * 3.1 + line_seed)
			var pos := _sp[j] + _sn[j] * (cos(ang) * br) + _sb[j] * (sin(ang) * br)
			if drift > 0.0:
				var dn := drift * drift * 0.25
				pos += Vector3(noise1(a * 0.9 + f * 11.0 + t * 0.7), noise1(a * 0.8 + f * 5.0 + 40.0) * 0.6, noise1(a * 0.7 + f * 13.0 + t * 0.6 + 80.0)) * dn
			var end_a := 0.35 + 0.65 * smoothstep(0.0, 0.03, a)
			fx.strand_pt(pos, lerpf(fibre_hw[0], fibre_hw[1], u), fa * end_a * (1.0 - 0.5 * fray))
		fx.strand_end()
	# 5. the flying tip: a soft glow + small star round the tip glob
	if flying:
		fx.sprite_quad(_sp[m - 1], 0.10, age * 3.0, 0.35, 2, 1.0)
		fx.sprite_quad(_sp[m - 1], 0.14, 0.0, 0.30, 0, 1.0)

# ---- small shared helpers ---------------------------------------------------------------

static func hash1(n: float) -> float:
	var s := sin(n * 127.1 + 311.7) * 43758.5453
	return s - floorf(s)

## Smooth 1D value noise, -1..1.
static func noise1(x: float) -> float:
	var i := floorf(x)
	var f := x - i
	var u := f * f * (3.0 - 2.0 * f)
	return lerpf(hash1(i), hash1(i + 1.0), u) * 2.0 - 1.0

## Any unit vector perpendicular to a unit vector.
static func perp_of(v: Vector3) -> Vector3:
	if absf(v.y) < 0.95:
		return Vector3(-v.z, 0.0, v.x).normalized()
	return Vector3(0.0, v.z, -v.y).normalized()
