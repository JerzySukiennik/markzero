class_name WebFX
extends Node3D
## Spider-Man web VFX for Godot 4.6 — port of `WebFX` in web.three.js (the visual reference;
## play it in the showroom's "Web range" exhibit). Owns every web effect of one player:
##   shoot()  thrown glob with spiral strands, muzzle fibres, tracer; splats where it hits
##   splat()  radial impact web (spokes, sagging scallops, tangle, wet centre, contact shadow)
##   line()   tether (WebFXLine, web_line.gd): flies out, attaches, sags / goes taut, releases
##   zip()    both hands to one point + speed rings;   pull()  yank an enemy on a line
##   cue()    the animation clip events (web_shot, web_line, web_zip, web_release, web_splat)
## Rendering: ONE ImmediateMesh for every strand of the frame (web_line.gdshader), ONE MultiMesh
## for flares/puffs (web_sprite.gdshader), a pool of glob meshes (web_glob.gdshader) and a pool of
## splat meshes (web_splat.gdshader, burst/dissolve/body-bend done in the shader).
## Collision: physics ray against everything; a collider in group "web_body" (or with meta
## is_body = true) is a body (small splat that sticks to it and bends round it, hitstop);
## group "no_web" is ignored. Sounds/juice go out through the signals — wire them to your audio
## player and camera (NOTES.md has the recommended curves).

signal sound(id: String, position: Vector3, gain: float)
signal juice(kind: String, amount: Variant)   # "fov_kick" deg | "hitstop" s | "shake" 0..1 | "rumble" {low,high,duration}

const LineScript := preload("web_line.gd")
const SH_LINE := preload("web_line.gdshader")
const SH_SPRITE := preload("web_sprite.gdshader")
const SH_GLOB := preload("web_glob.gdshader")
const SH_SPLAT := preload("web_splat.gdshader")

var look := {
	"core_hw": [0.0034, 0.0017], "fibre_hw": [0.0015, 0.0009], "braid": [0.0095, 0.005], "fibres": 7,
	"core_a": 1.0, "fibre_a": 0.92, "halo_a": 0.07, "core_glow": 0.22, "fibre_glow": 0.12, "fibre_bright": 0.62,
	"min_px_core": 1.8, "min_px_fibre": 1.0, "min_px_halo": 7.0,
	"rope_points": 28, "rope_gravity": 9.0, "rope_damp": 0.985, "rope_iter": 12,
	"release_fade": 0.6, "snap_fade": 0.65, "glob_radius": 0.05,
	"splat_size": 0.68, "splat_life": 20.0, "splat_fade_tail": 2.5,
}
const JUICE := {
	"shoot": {"fov": 1.5, "rumble": {"low": 0.08, "high": 0.35, "duration": 0.06}},
	"line_fire": {"fov": 2.0, "rumble": {"low": 0.05, "high": 0.25, "duration": 0.05}},
	"attach": {"shake": 0.10, "rumble": {"low": 0.32, "high": 0.12, "duration": 0.10}},
	"splat_body": {"hitstop": 0.05, "shake": 0.22, "rumble": {"low": 0.50, "high": 0.55, "duration": 0.10}},
	"splat_wall": {"rumble": {"low": 0.0, "high": 0.12, "duration": 0.03}},
	"zip_start": {"fov": 7.0, "shake": 0.18, "rumble": {"low": 0.55, "high": 0.35, "duration": 0.22}},
	"pull": {"hitstop": 0.06, "shake": 0.30, "fov": -1.5, "rumble": {"low": 0.80, "high": 0.45, "duration": 0.16}},
	"snap": {"shake": 0.28, "rumble": {"low": 0.30, "high": 0.80, "duration": 0.10}},
	"creak": {"rumble": {"low": 0.0, "high": 0.18, "duration": 0.05}},
	"release": {"rumble": {"low": 0.0, "high": 0.10, "duration": 0.03}},
}

## Optional ground height ropes rest on (NAN = none). WebFXLine reads it.
var ground_y: float = NAN
var time := 0.0
var rng := RandomNumberGenerator.new()
var lines: Array = []
var zips: Array = []
var pulls: Array = []
## physics layers thrown globs collide with
var collision_mask: int = 0xFFFFFFFF

var _strand_mesh := ImmediateMesh.new()
var _strand_mi := MeshInstance3D.new()
var _strand_mat := ShaderMaterial.new()
var _strand_open := false
var _arc := 0.0
var _last := Vector3.ZERO
var _first := true
var _cur_b := Color()
var _cur_minpx := 1.0
var _pts := PackedVector3Array()
var _pts_a := PackedVector4Array()     # (arc, alpha, hw, -)

var _sprite_mm := MultiMesh.new()
var _sprite_mi := MultiMeshInstance3D.new()
var _sprite_parts: Array = []
var _sprite_n := 0
const SPRITE_MAX := 384
const FIBRE_MAX := 512
var _fibres: Array = []
var _rings: Array = []
var _globs: Array = []
var _glob_meshes: Array = []
var _glob_mat := ShaderMaterial.new()
var _splats: Array = []
var _splat_mat := ShaderMaterial.new()
var _born := 0
var _last_thwip := 0


class Glob:
	var mi: MeshInstance3D
	var live := false
	var kind := "shot"
	var pos := Vector3.ZERO
	var prev := Vector3.ZERO
	var vel := Vector3.ZERO
	var origin := Vector3.ZERO
	var emitter: Node3D = null
	var age := 0.0
	var life := 2.2
	var gravity := 3.0
	var hand := "R"
	var on_hit := Callable()
	var spin := 0.0
	var spin_rate := 30.0
	var seed := 0.0
	var strands := 4
	var radius := 0.05
	var born := 0
	var handle: Dictionary = {}


func _ready() -> void:
	top_level = true
	global_transform = Transform3D.IDENTITY


## Pools are built at construction, so the API works before the node enters the tree.
func _init(p_seed: int = 1337) -> void:
	rng.seed = p_seed
	_strand_mat.shader = SH_LINE
	_strand_mi.mesh = _strand_mesh
	_strand_mi.material_override = _strand_mat
	_strand_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_strand_mi.extra_cull_margin = 16384.0
	add_child(_strand_mi)
	var q := QuadMesh.new()
	q.size = Vector2(2, 2)
	var sm := ShaderMaterial.new()
	sm.shader = SH_SPRITE
	q.material = sm
	_sprite_mm.transform_format = MultiMesh.TRANSFORM_3D
	_sprite_mm.use_colors = true
	_sprite_mm.use_custom_data = true
	_sprite_mm.mesh = q
	_sprite_mm.instance_count = SPRITE_MAX
	_sprite_mm.visible_instance_count = 0
	_sprite_mi.multimesh = _sprite_mm
	_sprite_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_sprite_mi.extra_cull_margin = 16384.0
	add_child(_sprite_mi)
	for i in SPRITE_MAX:
		_sprite_parts.append({"live": false, "p": Vector3.ZERO, "v": Vector3.ZERO, "age": 0.0, "life": 1.0, "s0": 0.1, "s1": 0.2,
			"a0": 1.0, "kind": 0, "add": 1.0, "col": Color(1, 1, 1), "rot": 0.0, "rv": 0.0, "drag": 0.0})
	for i in FIBRE_MAX:
		_fibres.append({"live": false, "p": Vector3.ZERO, "v": Vector3.ZERO, "d": Vector3.UP, "age": 0.0, "life": 0.2, "len": 0.2,
			"hw": 0.001, "a0": 1.0, "curl": 0.0, "seed": 0.0, "drag": 0.0, "grav": 0.0, "bright": 0.5, "glow": 0.3, "grow": 0.05})
	for i in 8:
		_rings.append({"live": false, "c": Vector3.ZERO, "n": Vector3.UP, "age": 0.0, "life": 0.3, "r0": 0.1, "r1": 1.0, "hw": 0.006, "a0": 0.5})
	_glob_mat.shader = SH_GLOB
	for s in [11, 23, 37, 51]:
		_glob_meshes.append(_lumpy_mesh(2, 0.42, s))
	for i in 24:
		var g := Glob.new()
		g.mi = MeshInstance3D.new()
		g.mi.mesh = _glob_meshes[i % 4]
		g.mi.material_override = _glob_mat
		g.mi.visible = false
		g.mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(g.mi)
		_globs.append(g)
	_splat_mat.shader = SH_SPLAT
	for i in 32:
		var mi := MeshInstance3D.new()
		mi.material_override = _splat_mat
		mi.visible = false
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		_splats.append({"mi": mi, "live": false, "age": 0.0, "life": 20.0, "born": 0, "attach": null})
	set_light(Vector3(-0.45, 0.8, -0.4))


## Match the scene's key light (direction TOWARD the light, world space).
func set_light(dir: Vector3, color := Color(1.0, 0.97, 0.92), ambient := Color(0.30, 0.33, 0.40)) -> void:
	for m in [_strand_mat, _glob_mat, _splat_mat, _sprite_mm.mesh.material]:
		m.set_shader_parameter("light_dir", dir.normalized())
		m.set_shader_parameter("light_col", Vector3(color.r, color.g, color.b))
		m.set_shader_parameter("ambient", Vector3(ambient.r, ambient.g, ambient.b))


# ------------------------------------------------------------------------------ public API
## Thrown web glob. Returns a handle {state: "flying"|"hit"|"dead", hit: {point, normal, collider}}.
func shoot(from: Variant, dir: Vector3, speed := 70.0, gravity := 3.0, hand := "R", on_hit := Callable()) -> Dictionary:
	var g := glob_take("shot")
	if from is Node3D:
		g.pos = from.global_position
		g.emitter = from
	else:
		g.pos = from
	g.origin = g.pos
	g.prev = g.pos
	g.vel = dir.normalized() * speed
	g.gravity = gravity
	g.hand = hand
	g.on_hit = on_hit
	g.life = 2.2
	g.handle = {"state": "flying", "hand": hand, "hit": {}}
	glob_pose(g)
	var d := g.vel.normalized()
	var n := _perp(d)
	var b := d.cross(n)
	for k in 9:
		var a := rng.randf() * TAU
		var cone := 0.35 + rng.randf() * 0.55
		var sp := 3.0 + rng.randf() * 5.0
		var v := (d * cos(cone) + n * sin(cone) * cos(a) + b * sin(cone) * sin(a)) * sp
		fibre_spawn(g.pos, v, 0.10 + rng.randf() * 0.08, 0.06 + rng.randf() * 0.08, 0.0007, 0.9, 0.015, rng.randf() * 10.0, 9.0, 1.0, 0.55, 0.3, 0.03)
	sprite_spawn(g.pos, d * 1.5, 0.16, 0.035, 0.13, 0.55, 1, 0.15, Color(1, 1, 1), rng.randf() * TAU, 0.0, 6.0)
	sprite_spawn(g.pos, Vector3.ZERO, 0.06, 0.10, 0.16, 0.9, 2, 1.0, Color(1, 1, 1), rng.randf() * TAU)
	_thwip(g.pos)
	emit_juice_set("shoot")
	return g.handle


## Stamp an impact splat. attach_to: a Node3D it sticks to. curve: bend radius (m) for bodies.
func splat(point: Vector3, normal: Vector3, size: float = -1.0, attach_to: Node3D = null, life: float = -1.0, curve := 0.0) -> Dictionary:
	if size <= 0.0:
		size = float(look["splat_size"])
	if life <= 0.0:
		life = float(look["splat_life"])
	var s: Dictionary = _splats[0]
	for c in _splats:
		if not c.live:
			s = c
			break
		if c.born < s.born:
			s = c
	_kill_splat(s)
	s.born = _born
	_born += 1
	var n := normal.normalized()
	var x := (Vector3.UP.cross(n) if absf(n.y) < 0.95 else Vector3.RIGHT.cross(n)).normalized()
	var z := x.cross(n).normalized()
	var basis := Basis(x, n, z) * Basis(Vector3.UP, rng.randf() * TAU)
	var mi: MeshInstance3D = s.mi
	mi.mesh = _build_splat(size)
	mi.global_transform = Transform3D(basis.scaled_local(Vector3.ONE * size), point)
	mi.set_instance_shader_parameter("u_age", 0.0)
	mi.set_instance_shader_parameter("u_fade", 1.0)
	mi.set_instance_shader_parameter("u_curve", curve / size if curve > 0.0 else 0.0)
	mi.set_instance_shader_parameter("u_width", clampf(size / 0.55, 0.6, 1.35))
	mi.visible = true
	if attach_to != null and is_instance_valid(attach_to):
		mi.reparent(attach_to, true)
	s.live = true
	s.age = 0.0
	s.life = life
	s.attach = attach_to
	sprite_spawn(point, n * 0.6, 0.30, size * 0.25, size * 0.75, 0.45, 1, 0.1, Color(1, 1, 1), rng.randf() * TAU, 0.5, 5.0)
	sprite_spawn(point, Vector3.ZERO, 0.07, size * 0.35, size * 0.6, 0.9, 2, 1.0, Color(1, 1, 1), rng.randf() * TAU)
	for k in 8:
		var a := rng.randf() * TAU
		var v := (x * cos(a) + z * sin(a)) * (4.0 + rng.randf() * 5.0) + n * (0.8 + rng.randf() * 1.5)
		fibre_spawn(point + n * 0.01, v, 0.14 + rng.randf() * 0.12, 0.08 + rng.randf() * 0.12, 0.0008, 0.85, 0.02, rng.randf() * 10.0, 10.0, 2.0, 0.55, 0.3, 0.03)
	return s


## A tether from `from` (Node3D, re-read every frame, or Vector3) to `to` (Vector3 | Node3D | {object, local}).
func line(from: Variant, to: Variant, travel_speed := 320.0, kind := "swing", known_normal := Vector3.ZERO, silent := false) -> RefCounted:
	var l = LineScript.new()
	l.known_normal = known_normal
	l.setup(self, from, to, travel_speed, kind, silent)
	lines.append(l)
	if not silent:
		emit_sound("sp_thwip_swing", l.hand, 1.0)
		emit_juice_set("line_fire")
	return l


## Web-zip: both hands to one point, taut and thrumming, released after `duration`.
func zip(from_l: Variant, from_r: Variant, to: Vector3, duration := 0.45) -> Dictionary:
	var L = line(from_l, to, 420.0, "zip", Vector3.ZERO, true)
	var R = line(from_r, to, 440.0, "zip", Vector3.ZERO, true)
	emit_sound("sp_thwip_double", (L.hand + R.hand) * 0.5, 1.0)
	emit_juice_set("line_fire")
	var z := {"lines": [L, R], "state": "flying", "t": 0.0, "duration": duration, "started": false}
	zips.append(z)
	return z


func zip_release(z: Dictionary) -> void:
	if z.state == "dead":
		return
	for l in z.lines:
		l.release()
	z.state = "released"


## Yank: the line flies to the target, snaps taut, on_yank(info) fires on the tension spike, then reels in.
func pull(from: Variant, target: Node3D, on_yank := Callable(), local := Vector3.INF) -> Dictionary:
	var loc := local
	if loc == Vector3.INF:
		loc = Vector3(0, 1.0, 0)      # ~chest of a standing enemy (its origin at the feet)
	var l = line(from, {"object": target, "local": loc}, 360.0, "pull")
	var h := {"line": l, "target": target, "state": "flying", "t": 0.0, "yanked": false, "on_yank": on_yank}
	pulls.append(h)
	return h


## Animation clip events ({"vfx": ..., "at": node name, ...} from the .clips.json). `rig` resolves "at".
func cue(name: String, o: Dictionary = {}) -> Variant:
	match name:
		"web_shot":
			var at: Node3D = o.get("at", null)
			if at == null:
				return null
			var dir: Vector3 = o.get("dir", -at.global_transform.basis.y)       # piv_web*: local -Y = the shot
			var hand: String = o.get("hand", "L" if str(at.name).ends_with("L") else "R")
			return shoot(at, dir, float(o.get("speed", 70.0)), float(o.get("gravity", 3.0)), hand, o.get("on_hit", Callable()))
		"web_line":
			if o.has("at") and o.has("to"):
				return line(o.at, o.to, 320.0, str(o.get("kind", "swing")))
		"web_zip":
			if o.has("at_l") and o.has("at_r") and o.has("to"):
				return zip(o.at_l, o.at_r, o.to, float(o.get("duration", 0.45)))
		"web_release":
			for l in lines:
				if l.kind != "zip" and (l.state == "attached" or l.state == "flying"):
					l.release()
		"web_pull":
			for l in lines:
				if l.state == "attached":
					l.retract()
		"web_splat", "web_impact":
			if o.has("point"):
				return splat(o.point, o.get("normal", Vector3.UP), float(o.get("size", look["splat_size"])), o.get("attach_to", null))
	return null


func clear() -> void:
	for l in lines:
		l.dispose()
	lines.clear()
	zips.clear()
	pulls.clear()
	for g in _globs:
		glob_free(g)
	for s in _splats:
		_kill_splat(s)
	for q in _sprite_parts:
		q.live = false
	for q in _fibres:
		q.live = false
	for q in _rings:
		q.live = false
	_strand_mesh.clear_surfaces()
	_sprite_mm.visible_instance_count = 0


# ------------------------------------------------------------------------------ frame
func _process(dt: float) -> void:
	step(dt)


func step(dt: float) -> void:
	dt = clampf(dt, 0.0, 0.1)
	time += dt
	_step_globs(dt)
	for l in lines:
		l.update(dt)
	_update_zips(dt)
	_update_pulls(dt)
	for i in range(lines.size() - 1, -1, -1):
		if lines[i].state == "dead":
			lines.remove_at(i)
	_update_fibres(dt)
	_update_splats(dt)
	for q in _rings:
		if q.live:
			q.age += dt
			if q.age >= q.life:
				q.live = false
	# draw
	_strand_mesh.clear_surfaces()
	_sprite_n = 0
	_update_sprites(dt)
	for l in lines:
		l.draw()
	_draw_globs()
	_draw_fibres()
	_draw_rings()
	_sprite_mm.visible_instance_count = _sprite_n


# ------------------------------------------------------------------------------ helpers used by WebFXLine
func emit_sound(id: String, pos: Vector3, gain := 1.0) -> void:
	sound.emit(id, pos, gain)


func emit_juice_set(key: String) -> void:
	var j: Dictionary = JUICE.get(key, {})
	if j.has("fov"):
		juice.emit("fov_kick", j.fov)
	if j.has("hitstop"):
		juice.emit("hitstop", j.hitstop)
	if j.has("shake"):
		juice.emit("shake", j.shake)
	if j.has("rumble"):
		juice.emit("rumble", j.rumble)


## Begin one camera-facing strand (bright 0..1, glow 0..1 [1 = the fixed-pixel halo], min width px, seed 0..1).
func strand_begin(bright: float, glow: float, min_px: float, seed: float) -> void:
	_pts.clear()
	_pts_a.clear()
	_arc = 0.0
	_first = true
	_cur_b = Color(0.0, bright, glow, seed)
	_cur_minpx = min_px


func strand_pt(pos: Vector3, hw: float, alpha: float) -> void:
	if not _first:
		_arc += pos.distance_to(_last)
	_first = false
	_last = pos
	_pts.append(pos)
	_pts_a.append(Vector4(_arc, alpha, hw, 0.0))


func strand_end() -> void:
	var n := _pts.size()
	if n < 2:
		return
	_strand_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP, _strand_mat)
	for j in n:
		var t := _pts[mini(j + 1, n - 1)] - _pts[maxi(j - 1, 0)]
		t = t.normalized() if t.length_squared() > 1e-18 else Vector3.UP
		var a: Vector4 = _pts_a[j]
		for k in 2:
			_strand_mesh.surface_set_normal(t)
			_strand_mesh.surface_set_uv(Vector2(1.0 if k == 1 else -1.0, a.x))
			_strand_mesh.surface_set_uv2(Vector2(a.z, _cur_minpx))
			_strand_mesh.surface_set_color(Color(a.y, _cur_b.g, _cur_b.b, _cur_b.a))
			_strand_mesh.surface_add_vertex(_pts[j])
	_strand_mesh.surface_end()


## Simulated sprite (kind 0 glow | 1 puff | 2 star).
func sprite_spawn(p: Vector3, v: Vector3, life: float, s0: float, s1: float, a0: float, kind: int, add: float,
		col := Color(1, 1, 1), rot := 0.0, rv := 0.0, drag := 0.0) -> void:
	var q: Dictionary = {}
	for c in _sprite_parts:
		if not c.live:
			q = c
			break
	if q.is_empty():
		q = _sprite_parts[rng.randi_range(0, SPRITE_MAX - 1)]
	q.live = true; q.p = p; q.v = v; q.age = 0.0; q.life = life; q.s0 = s0; q.s1 = s1; q.a0 = a0
	q.kind = kind; q.add = add; q.col = col; q.rot = rot; q.rv = rv; q.drag = drag


## One-frame sprite.
func sprite_quad(p: Vector3, size: float, rot: float, alpha: float, kind: int, add: float, col := Color(1, 1, 1)) -> void:
	if _sprite_n >= SPRITE_MAX:
		return
	_sprite_mm.set_instance_transform(_sprite_n, Transform3D(Basis.IDENTITY, p))
	_sprite_mm.set_instance_color(_sprite_n, Color(col.r, col.g, col.b, alpha))
	_sprite_mm.set_instance_custom_data(_sprite_n, Color(size, rot, float(kind), add))
	_sprite_n += 1


func fibre_spawn(p: Vector3, v: Vector3, life: float, length: float, hw: float, a0: float, curl := 0.02, seed := 0.0,
		drag := 4.0, grav := 2.0, bright := 0.55, glow := 0.3, grow := 0.05) -> void:
	var q: Dictionary = {}
	for c in _fibres:
		if not c.live:
			q = c
			break
	if q.is_empty():
		q = _fibres[rng.randi_range(0, FIBRE_MAX - 1)]
	q.live = true; q.p = p; q.v = v; q.age = 0.0; q.life = life; q.len = length; q.hw = hw; q.a0 = a0
	q.curl = curl; q.seed = seed; q.drag = drag; q.grav = grav; q.bright = bright; q.glow = glow; q.grow = grow
	if v.length() > 1e-4:
		q.d = v.normalized()


func glob_take(kind: String) -> Glob:
	var g: Glob = null
	for c in _globs:
		if not c.live:
			g = c
			break
	if g == null:
		g = _globs[0]
		for c in _globs:
			if c.born < g.born:
				g = c
		if not g.handle.is_empty():
			g.handle.state = "dead"
	g.live = true; g.kind = kind; g.age = 0.0; g.born = _born; _born += 1
	g.spin = rng.randf() * TAU; g.spin_rate = 25.0 + rng.randf() * 20.0; g.seed = rng.randf() * 50.0
	g.strands = 3 + rng.randi_range(0, 2); g.on_hit = Callable(); g.emitter = null; g.handle = {}
	var r0 := float(look["glob_radius"])
	g.radius = r0 * 0.7 if kind == "tip" else r0 * (0.9 + rng.randf() * 0.25)
	g.mi.visible = true
	return g


func glob_free(g) -> void:
	if g == null:
		return
	g.live = false
	g.mi.visible = false


## Squash & stretch along travel, spin about it.
func glob_pose(g) -> void:
	var s: float = g.vel.length()
	var d: Vector3 = g.vel / s if s > 1e-3 else Vector3(0, 0, -1)
	var q := Quaternion(Vector3(0, 0, 1), d) * Quaternion(Vector3(0, 0, 1), g.spin + g.age * g.spin_rate)
	var st: float = 1.7 if g.kind == "tip" else 1.25 + 0.12 * sin(g.age * 60.0)
	var sc := Vector3(g.radius * (0.86 + 0.1 * sin(g.age * 47.0)), g.radius * (0.84 + 0.08 * cos(g.age * 53.0)), g.radius * st)
	g.mi.global_transform = Transform3D(Basis(q).scaled_local(sc), g.pos)


# WebFXLine calls this when a line lands.
func on_line_attach(l) -> void:
	emit_sound("sp_web_attach_%d" % (1 + rng.randi_range(0, 1)), l.anchor, 0.7 if l.kind == "zip" else 1.0)
	if l.kind != "zip":
		emit_juice_set("attach")
	var point: Vector3 = l.anchor
	var normal: Vector3 = l.known_normal
	var obj: Node3D = l.to_node
	var dir: Vector3 = l.anchor - l.hand
	if normal == Vector3.ZERO and dir.length() > 1e-3 and is_inside_tree():
		dir = dir.normalized()
		var back := 1.2 if obj != null else 0.6
		var hit := _ray(l.anchor - dir * back, l.anchor + dir * 0.6)
		if not hit.is_empty():
			normal = hit.normal
			if normal.dot(dir) > 0.0:
				normal = -normal
			point = hit.position
			if obj != null and hit.collider is Node3D:
				l.to_node = hit.collider
				l.to_local = hit.collider.global_transform.affine_inverse() * hit.position
				l.anchor = hit.position
				obj = hit.collider
			elif obj == null:
				l.to_point = hit.position
				l.anchor = hit.position
	if normal == Vector3.ZERO:
		normal = (l.hand - l.anchor).normalized()
	var body: bool = obj != null and (_is_body(obj) or l.kind == "pull")
	splat(point, normal, 0.2 if l.kind == "zip" else (0.26 if body else 0.3), obj, -1.0, 0.25 if body else 0.0)


# ------------------------------------------------------------------------------ internals
func _step_globs(dt: float) -> void:
	var steps := maxi(1, ceili(dt * 120.0 - 1e-6))
	var h := dt / steps
	for g in _globs:
		if not g.live:
			continue
		if g.kind != "shot":
			glob_pose(g)
			continue
		for s in steps:
			if not g.live:
				break
			g.age += h
			g.prev = g.pos
			g.vel.y -= g.gravity * h
			g.pos += g.vel * h
			if _glob_ray(g):
				break
			if g.age >= g.life:
				glob_free(g)
				g.handle.state = "dead"
		if g.live:
			glob_pose(g)


func _ray(a: Vector3, b: Vector3) -> Dictionary:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(a, b, collision_mask)
	q.collide_with_areas = false
	var ex: Array[RID] = []
	for i in 4:
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			return {}
		var c: Object = hit.collider
		if c is Node and (c as Node).is_in_group("no_web"):
			ex.append(hit.rid)
			q.exclude = ex
			continue
		return hit
	return {}


func _is_body(n: Node) -> bool:
	var o: Node = n
	while o != null:
		if o.is_in_group("web_body") or o.get_meta("is_body", false):
			return true
		o = o.get_parent()
	return false


func _glob_ray(g) -> bool:
	if not is_inside_tree():
		return false
	var d: Vector3 = g.pos - g.prev
	if d.length() < 1e-6:
		return false
	var hit := _ray(g.prev, g.pos + d.normalized() * g.radius * 0.5)
	if hit.is_empty():
		return false
	var n: Vector3 = hit.normal
	if n.dot(g.vel) > 0.0:
		n = -n
	var point: Vector3 = hit.position
	var col: Object = hit.collider
	if col is Node3D and _is_body(col):
		splat(point, n, 0.4, col, -1.0, 0.25)
		emit_sound("sp_web_hit_body", point, 1.0)
		emit_juice_set("splat_body")
	else:
		splat(point, n, float(look["splat_size"]) * (0.8 + 0.3 * rng.randf()))
		emit_sound("sp_web_splat_%d" % (1 + rng.randi_range(0, 2)), point, 1.0)
		emit_juice_set("splat_wall")
	g.handle.state = "hit"
	g.handle.hit = {"point": point, "normal": n, "collider": col}
	glob_free(g)
	if g.on_hit.is_valid():
		g.on_hit.call(g.handle.hit)
	return true


func _draw_globs() -> void:
	var r := float(look["glob_radius"])
	for g in _globs:
		if not g.live or g.kind != "shot":
			continue
		var sp: float = g.vel.length()
		if sp < 1e-3:
			continue
		var d: Vector3 = g.vel / sp
		var n := _perp(d)
		var b := d.cross(n)
		var streak := clampf(sp * 0.016, 0.3, 1.3)
		var trail := streak * 0.6
		var grow := smoothstep(0.0, 0.05, g.age)
		strand_begin(1.0, 0.25, 1.4, fmod(g.seed + 7.0, 1.0))
		for k in 8:
			var u := k / 7.0
			strand_pt(g.pos - d * (u * streak * grow), lerpf(r * 0.35, 0.0008, u), 0.85 * pow(1.0 - u, 1.6))
		strand_end()
		for s in g.strands:
			var ph: float = g.seed + s * TAU / g.strands
			strand_begin(0.6, 0.2, 1.0, fmod(g.seed + s, 1.0))
			for k in 18:
				var u := k / 17.0
				var dd := u * trail * grow
				var ang: float = ph + g.age * 30.0 + dd * 5.5
				var rad: float = r * (0.7 + 0.3 * u) + dd * 0.045 + sin(dd * 11.0 - g.age * 50.0 + s * 2.0) * 0.012 * u
				strand_pt(g.pos - d * dd + n * cos(ang) * rad + b * sin(ang) * rad, lerpf(0.0013, 0.0005, u), 0.9 * pow(1.0 - u, 1.4))
			strand_end()
		if g.age < 0.08:
			var a := pow(1.0 - g.age / 0.08, 2.0) * 0.9
			var w: Vector3 = g.emitter.global_position if g.emitter != null and is_instance_valid(g.emitter) else g.origin
			strand_begin(1.0, 0.3, 1.2, fmod(g.seed + 9.0, 1.0))
			for k in 6:
				var u := k / 5.0
				strand_pt(w.lerp(g.pos, u) - Vector3(0, 0.02 * sin(PI * u), 0), lerpf(0.0018, 0.0012, u), a * (0.5 + 0.5 * u))
			strand_end()
		sprite_quad(g.pos, r * 2.4, 0.0, 0.22, 0, 1.0)


func _update_sprites(dt: float) -> void:
	for q in _sprite_parts:
		if not q.live:
			continue
		q.age += dt
		if q.age >= q.life:
			q.live = false
			continue
		if q.drag > 0.0:
			q.v *= exp(-q.drag * dt)
		q.p += q.v * dt
		q.rot += q.rv * dt
		var k: float = q.age / q.life
		var e := 1.0 - (1.0 - k) * (1.0 - k)
		sprite_quad(q.p, lerpf(q.s0, q.s1, e), q.rot, q.a0 * (1.0 - k) * (1.0 - k), q.kind, q.add, q.col)


func _update_fibres(dt: float) -> void:
	for q in _fibres:
		if not q.live:
			continue
		q.age += dt
		if q.age >= q.life:
			q.live = false
			continue
		q.v *= exp(-q.drag * dt)
		q.v.y -= q.grav * dt
		q.p += q.v * dt
		var l: float = q.v.length()
		if l > 0.3:
			q.d = q.d.lerp(q.v / l, clampf(dt * 20.0, 0.0, 1.0)).normalized()


func _draw_fibres() -> void:
	for q in _fibres:
		if not q.live:
			continue
		var k: float = q.age / q.life
		var a: float = q.a0 * (1.0 - k) * (1.0 - k * 0.5)
		var ln: float = q.len * smoothstep(0.0, q.grow, q.age + 1e-4)
		var px := _perp(q.d)
		strand_begin(q.bright, q.glow, 1.0, fmod(q.seed, 1.0))
		for j in 5:
			var u := j / 4.0
			var c: float = sin(u * PI * 1.5 + q.seed * 7.0) * q.curl * u
			strand_pt(q.p - q.d * ln * u + px * c, q.hw * (1.0 - 0.6 * u), a * (1.0 - u * 0.7))
		strand_end()


func _draw_rings() -> void:
	for q in _rings:
		if not q.live:
			continue
		var k: float = q.age / q.life
		var e := 1.0 - pow(1.0 - k, 3.0)
		var rad: float = lerpf(q.r0, q.r1, e)
		var a: float = q.a0 * (1.0 - k) * (1.0 - k)
		var u := _perp(q.n)
		var w: Vector3 = q.n.cross(u)
		strand_begin(0.2, 0.85, 2.0, 0.3)
		for j in 33:
			var t := j / 32.0 * TAU
			strand_pt(q.c + u * cos(t) * rad + w * sin(t) * rad, q.hw * (1.0 - 0.5 * k), a)
		strand_end()


func _ring(c: Vector3, n: Vector3, life: float, r0: float, r1: float, hw: float, a0: float) -> void:
	var q: Dictionary = _rings[0]
	for x in _rings:
		if not x.live:
			q = x
			break
	q.live = true; q.c = c; q.n = n.normalized(); q.age = 0.0; q.life = life; q.r0 = r0; q.r1 = r1; q.hw = hw; q.a0 = a0


func _update_zips(dt: float) -> void:
	for i in range(zips.size() - 1, -1, -1):
		var z: Dictionary = zips[i]
		var L = z.lines[0]
		var R = z.lines[1]
		if not z.started and (L.state == "attached" or R.state == "attached"):
			z.started = true
			z.t = 0.0
			z.state = "attached"
			var mid: Vector3 = (L.hand + R.hand) * 0.5
			var dir: Vector3 = (L.anchor - mid).normalized()
			emit_sound("sp_zip_whoosh", mid, 1.0)
			emit_juice_set("zip_start")
			_ring(mid, dir, 0.30, 0.15, 1.6, 0.012, 0.75)
			_ring(mid - dir * 0.5, dir, 0.40, 0.10, 1.0, 0.008, 0.45)
			var n := _perp(dir)
			var b := dir.cross(n)
			for k in 16:
				var a := rng.randf() * TAU
				var rad := 0.25 + rng.randf() * 0.9
				var p := mid + n * cos(a) * rad + b * sin(a) * rad + dir * (rng.randf() - 0.5) * 0.6
				fibre_spawn(p, dir * (3.0 + rng.randf() * 5.0), 0.22 + rng.randf() * 0.12, 0.7 + rng.randf() * 0.9, 0.0022, 0.6, 0.0, rng.randf() * 10.0, 1.0, 0.0, 0.3, 0.8, 0.06)
		if z.started and z.state == "attached":
			z.t += dt
			for l in z.lines:
				if l.state != "attached":
					continue
				l.thrum = maxf(0.35, 1.0 - z.t * 1.4)
				l._rest = minf(l._rest, l.hand.distance_to(l.anchor) * 0.985)
			if z.t >= z.duration:
				zip_release(z)
		if L.state == "dead" and R.state == "dead":
			z.state = "dead"
			zips.remove_at(i)


func _update_pulls(dt: float) -> void:
	for i in range(pulls.size() - 1, -1, -1):
		var h: Dictionary = pulls[i]
		var l = h.line
		if l.state == "attached":
			h.t += dt
			if not h.yanked and h.t >= 0.07:
				h.yanked = true
				h.t = 0.0
				h.state = "yanking"
				l._rest = l.hand.distance_to(l.anchor) * 0.9
				l.tension = 1.0
				l.twang = 1.0
				emit_sound("sp_web_pull", l.anchor, 1.0)
				emit_juice_set("pull")
				if h.on_yank.is_valid():
					h.on_yank.call({"target": h.target, "line": l, "dir": (l.hand - l.anchor).normalized(), "point": l.anchor})
			elif h.yanked:
				l._rest = minf(l._rest, l.hand.distance_to(l.anchor) * 0.97)
				if h.t >= 0.32:
					l.retract()
					h.state = "retracting"
		if l.state == "dead":
			h.state = "dead"
			pulls.remove_at(i)


func _update_splats(dt: float) -> void:
	var tail := float(look["splat_fade_tail"])
	for s in _splats:
		if not s.live:
			continue
		s.age += dt
		if s.age >= s.life or (s.attach != null and not is_instance_valid(s.attach)):
			_kill_splat(s)
			continue
		s.mi.set_instance_shader_parameter("u_age", s.age)
		s.mi.set_instance_shader_parameter("u_fade", clampf((s.life - s.age) / tail, 0.0, 1.0))


func _kill_splat(s: Dictionary) -> void:
	s.live = false
	var mi: MeshInstance3D = s.mi
	if not is_instance_valid(mi):
		mi = MeshInstance3D.new()
		mi.material_override = _splat_mat
		add_child(mi)
		s.mi = mi
	mi.visible = false
	if mi.get_parent() != self:
		mi.reparent(self, false)
	s.attach = null


func _thwip(pos: Vector3) -> void:
	var k := 1 + rng.randi_range(0, 3)
	if k == _last_thwip:
		k = (k % 4) + 1
	_last_thwip = k
	emit_sound("sp_thwip_%d" % k, pos, 1.0)


static func _perp(d: Vector3) -> Vector3:
	var a := Vector3.UP if absf(d.y) < 0.9 else Vector3.RIGHT
	return d.cross(a).normalized()


# ------------------------------------------------------------------------------ geometry
func _lump_field(seed: int) -> Array:
	var r := RandomNumberGenerator.new()
	r.seed = seed
	var w: Array = []
	for i in 6:
		var z := r.randf() * 2.0 - 1.0
		var a := r.randf() * TAU
		var s := sqrt(1.0 - z * z)
		w.append([Vector3(cos(a) * s, sin(a) * s, z), 1.3 + r.randf() * 2.6, r.randf() * TAU, (0.55 + r.randf() * 0.45) / (1.0 + i * 0.35)])
	return w


static func _lump(w: Array, p: Vector3) -> float:
	var v := 0.0
	var n := 0.0
	for e in w:
		v += e[3] * sin(e[0].dot(p) * e[1] + e[2])
		n += e[3]
	return v / n


static func _icosphere(detail: int) -> Array:
	var t := (1.0 + sqrt(5.0)) / 2.0
	var verts: Array = [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
		Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	for i in verts.size():
		verts[i] = verts[i].normalized()
	var faces: Array = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
	for d in detail:
		var cache := {}
		var nf: Array = []
		for f in faces:
			var m: Array = []
			for e in 3:
				var a: int = f[e]
				var b: int = f[(e + 1) % 3]
				var key := Vector2i(mini(a, b), maxi(a, b))
				if not cache.has(key):
					verts.append(((verts[a] + verts[b]) * 0.5).normalized())
					cache[key] = verts.size() - 1
				m.append(cache[key])
			nf.append([f[0], m[0], m[2]]); nf.append([f[1], m[1], m[0]]); nf.append([f[2], m[2], m[1]]); nf.append([m[0], m[1], m[2]])
		faces = nf
	return [verts, faces]


func _lumpy_mesh(detail: int, amp: float, seed: int) -> ArrayMesh:
	var ico := _icosphere(detail)
	var w := _lump_field(seed)
	var P := PackedVector3Array()
	var C := PackedColorArray()
	for v in ico[0]:
		var l := _lump(w, v)
		P.append(v * (1.0 + amp * l))
		C.append(Color(clampf(0.5 + l * 1.4, 0.0, 1.0), 0, 0, 1))
	var N := PackedVector3Array()
	N.resize(P.size())
	var I := PackedInt32Array()
	for f in ico[1]:
		var nn: Vector3 = (P[f[2]] - P[f[0]]).cross(P[f[1]] - P[f[0]])
		for k in 3:
			N[f[k]] += nn
		I.append(f[0]); I.append(f[2]); I.append(f[1])      # Godot: clockwise front faces
	for i in N.size():
		N[i] = N[i].normalized()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = P
	arr[Mesh.ARRAY_NORMAL] = N
	arr[Mesh.ARRAY_COLOR] = C
	arr[Mesh.ARRAY_INDEX] = I
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


## One procedural splat at radius 1 (mesh space +Y = normal; the node is scaled by `size`).
## Same recipe as buildSplat() in web.three.js; bend, burst and strand shadows are in the shader.
func _build_splat(size: float) -> ArrayMesh:
	var R := 1.0
	var hs := clampf(size / 0.55, 0.6, 1.5)
	var inv := 1.0 / size
	var P := PackedVector3Array()
	var N := PackedVector3Array()
	var A := PackedFloat32Array()
	var B := PackedFloat32Array()
	var I := PackedInt32Array()
	var strands: Array = []
	var lift := func(rr: float) -> float:
		return (0.002 + 0.013 * hs * pow(maxf(0.0, 1.0 - rr / 1.05), 2.0)) * inv
	var add := func(pts: PackedVector3Array, hw0: float, hw1: float, a0: float, a1: float, bright: float, seed: float, shadow: bool) -> void:
		strands.append([pts, hw0, hw1, a0, a1, bright, seed, shadow])
	var emit_strand := func(e: Array, as_shadow: bool) -> void:
		var pts: PackedVector3Array = e[0]
		var n := pts.size()
		var base := P.size()
		var arc := 0.0
		for j in n:
			var q := pts[j]
			var lift_y := q.y
			if as_shadow:
				q = Vector3(q.x, 0.0009 * inv, q.z)
			var t := pts[mini(j + 1, n - 1)] - pts[maxi(j - 1, 0)]
			t = t.normalized() if t.length_squared() > 1e-18 else Vector3.RIGHT
			if j > 0:
				arc += pts[j].distance_to(pts[j - 1]) * size
			var u := float(j) / (n - 1)
			var rr := Vector2(pts[j].x, pts[j].z).length()
			for k in 2:
				P.append(q)
				N.append(t)
				A.append_array([1.0 if k == 1 else -1.0, lift_y if as_shadow else arc, lerpf(e[3], e[4], u) * (0.8 if as_shadow else 1.0),
					lerpf(e[1], e[2], u) * (2.2 if as_shadow else 1.0)])
				B.append_array([-1.0 if as_shadow else e[5], 0.0, clampf(rr, 0.0, 1.5), e[6]])
		for j in n - 1:
			var v := base + 2 * j
			I.append_array([v, v + 2, v + 1, v + 1, v + 2, v + 3])
	var grid := func(h: float, y: float, kind: float, alpha: float, seed: float) -> void:
		var G := 6
		var base := P.size()
		for iz in G:
			for ix in G:
				var u := float(ix) / (G - 1) * 2.0 - 1.0
				var w := float(iz) / (G - 1) * 2.0 - 1.0
				P.append(Vector3(u * h, y * inv, w * h))
				N.append(Vector3.UP)
				A.append_array([u, w, alpha, 0.0])
				B.append_array([0.0, kind, minf(1.0, Vector2(u, w).length() * h), seed])
		for iz in G - 1:
			for ix in G - 1:
				var a := base + iz * G + ix
				I.append_array([a, a + 1, a + G, a + 1, a + G + 1, a + G])
	var ico_hi := _icosphere(2)
	var ico_lo := _icosphere(1)
	var glob := func(ico: Array, c: Vector3, rad: Vector3, seed: float, amp: float, fingers: int) -> void:
		var w := _lump_field(int(seed * 1000.0) + 7)
		var base := P.size()
		var pp: Array = []
		var cav: Array = []
		for v in ico[0]:
			var l := _lump(w, v)
			var k := 1.0 + amp * l
			var fx := 1.0
			var fy := 1.0
			if fingers > 0:
				var an := atan2(v.z, v.x)
				var ww := 0.65 * sin(an * fingers + seed * 20.0) + 0.45 * sin(an * (fingers + 2) - seed * 13.0) + 0.25 * sin(an * 2.0 + seed * 7.0)
				var lobe := pow(maxf(0.0, ww), 2.2) * (1.0 - absf(v.y))
				fx = 1.0 + 0.7 * lobe
				fy = 1.0 - 0.4 * clampf(lobe, 0.0, 1.0)
			pp.append(Vector3(c.x + v.x * rad.x * k * fx, maxf(0.0, c.y + v.y * rad.y * k * fy), c.z + v.z * rad.z * k * fx))
			cav.append(clampf(0.5 + l * 1.4, 0.0, 1.0))
		var nrm: Array = []
		nrm.resize(pp.size())
		nrm.fill(Vector3.ZERO)
		for f in ico[1]:
			var nn: Vector3 = (pp[f[1]] - pp[f[0]]).cross(pp[f[2]] - pp[f[0]])
			for k in 3:
				nrm[f[k]] += nn
			I.append_array([base + f[0], base + f[2], base + f[1]])
		for i in pp.size():
			P.append(pp[i])
			N.append(nrm[i].normalized())
			A.append_array([0.0, cav[i], 1.0, 0.0])
			B.append_array([1.0, 2.0, 0.0, seed])
	var r := rng
	# spokes
	var nS := 8 + r.randi_range(0, 4)
	var rot0 := r.randf() * TAU
	var ang: Array = []
	var L: Array = []
	var bk: Array = []
	for j in nS:
		ang.append(rot0 + (j + (r.randf() - 0.5) * 0.55) * TAU / nS)
		var l := R * (0.62 + 0.38 * r.randf())
		if r.randf() < 0.12:
			l *= 1.22
		L.append(l)
		bk.append((r.randf() - 0.5) * 0.18)
	var r0 := 0.02 * R
	var spoke_at := func(j: int, rr: float) -> Vector3:
		var u := clampf((rr - r0) / (L[j] - r0), 0.0, 1.0)
		var c := cos(ang[j])
		var s := sin(ang[j])
		var off: float = bk[j] * L[j] * 4.0 * u * (1.0 - u)
		return Vector3(c * rr - s * off, lift.call(rr), s * rr + c * off)
	for j in nS:
		var pts := PackedVector3Array()
		for k in 12:
			pts.append(spoke_at.call(j, lerpf(r0, L[j], pow(k / 11.0, 1.15))))
		add.call(pts, 0.0042, 0.0011, 1.0, 0.8, 0.8, r.randf(), true)
		for q in 2:
			var off := (0.004 + 0.006 * r.randf()) * (-1.0 if q == 1 else 1.0) * inv
			var ph := r.randf() * 3.0
			var c := cos(ang[j])
			var s := sin(ang[j])
			var end := 0.55 + 0.4 * r.randf()
			var pc := PackedVector3Array()
			for k in 12:
				var u := k / 11.0
				var sp: Vector3 = spoke_at.call(j, lerpf(r0 * 2.0, L[j] * end, u))
				var o := off * cos(u * 5.0 + ph) * (0.4 + u)
				pc.append(Vector3(sp.x - s * o, sp.y + 0.001 * inv, sp.z + c * o))
			add.call(pc, 0.0011, 0.0007, 0.85, 0.35, 0.45, r.randf(), false)
	# sagging rings
	var nR := 3 + r.randi_range(0, 2)
	for k in nR:
		var fk := lerpf(0.26, 0.86, float(k) / (nR - 1))
		var rad: Array = []
		for j in nS:
			rad.append(fk * R * (1.0 + (r.randf() - 0.5) * 0.16))
		for j in nS:
			var j2 := (j + 1) % nS
			if rad[j] > L[j] * 0.95 or rad[j2] > L[j2] * 0.95 or r.randf() < 0.1:
				continue
			var a: Vector3 = spoke_at.call(j, rad[j])
			var b: Vector3 = spoke_at.call(j2, rad[j2])
			var sag := 0.08 + r.randf() * 0.16
			var cx := (a.x + b.x) * 0.5 * (1.0 - 2.0 * sag)
			var cz := (a.z + b.z) * 0.5 * (1.0 - 2.0 * sag)
			var pts := PackedVector3Array()
			for q in 9:
				var u := q / 8.0
				var w0 := (1.0 - u) * (1.0 - u)
				var w1 := 2.0 * u * (1.0 - u)
				var w2 := u * u
				var x := a.x * w0 + cx * w1 + b.x * w2
				var z := a.z * w0 + cz * w1 + b.z * w2
				pts.append(Vector3(x, lift.call(Vector2(x, z).length()) + 0.0006 * inv, z))
			var al := 0.95 - 0.3 * k / nR
			add.call(pts, 0.0015, 0.0015, al, al, 0.45, r.randf(), true)
	# strays past the rim
	for q in 3 + r.randi_range(0, 2):
		var a := r.randf() * TAU
		var ln := R * (1.05 + 0.45 * r.randf())
		var ph := r.randf() * TAU
		var pts := PackedVector3Array()
		for k in 14:
			var u := k / 13.0
			var rr := lerpf(R * 0.1, ln, u)
			var o := sin(u * PI * 2.5 + ph) * 0.045 * R * u
			pts.append(Vector3(cos(a) * rr - sin(a) * o, lift.call(rr), sin(a) * rr + cos(a) * o))
		add.call(pts, 0.0009, 0.0006, 0.75, 0.15, 0.4, r.randf(), false)
	# tangle round the centre
	for q in 18 + r.randi_range(0, 7):
		var a1 := r.randf() * TAU
		var a2 := a1 + PI * (0.5 + r.randf())
		var r1 := R * 0.24 * sqrt(r.randf())
		var r2 := R * 0.24 * sqrt(r.randf())
		var p1 := Vector2(cos(a1) * r1, sin(a1) * r1)
		var p2 := Vector2(cos(a2) * r2, sin(a2) * r2)
		var bo := (r.randf() - 0.5) * 1.1
		var pts := PackedVector3Array()
		for k in 8:
			var u := k / 7.0
			var x := lerpf(p1.x, p2.x, u) - (p2.y - p1.y) * bo * u * (1.0 - u)
			var z := lerpf(p1.y, p2.y, u) + (p2.x - p1.x) * bo * u * (1.0 - u)
			pts.append(Vector3(x, lift.call(Vector2(x, z).length()) + (0.002 + 0.004 * sin(u * PI)) * inv, z))
		add.call(pts, 0.0013, 0.0010, 0.9, 0.9, 0.6, r.randf(), q % 2 == 0)
	# painter's order: contact shadow, film, strand shadows, strands, globs
	grid.call(R * 1.15, 0.0012, 1.0, 1.0, 0.1)
	grid.call(R * 0.38, 0.0035, 3.0, 0.5, 0.2)
	for e in strands:
		if e[7]:
			emit_strand.call(e, true)
	for e in strands:
		emit_strand.call(e, false)
	var rg := 0.10 * R * (0.9 + 0.25 * r.randf())
	glob.call(ico_hi, Vector3.ZERO, Vector3(rg, rg * 0.34, rg * (0.85 + 0.3 * r.randf())), r.randf(), 0.22, 5 + r.randi_range(0, 2))
	for q in 1 + r.randi_range(0, 1):
		var a := r.randf() * TAU
		var d := rg * (1.25 + 0.4 * r.randf())
		var sr := rg * (0.16 + 0.1 * r.randf())
		glob.call(ico_lo, Vector3(cos(a) * d, 0.0, sin(a) * d), Vector3(sr * 1.4, sr * 0.45, sr), r.randf(), 0.2, 0)
	var C0 := PackedFloat32Array(A)
	var C1 := PackedFloat32Array(B)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = P
	arr[Mesh.ARRAY_NORMAL] = N
	arr[Mesh.ARRAY_CUSTOM0] = C0
	arr[Mesh.ARRAY_CUSTOM1] = C1
	arr[Mesh.ARRAY_INDEX] = I
	var fmt := (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT) | (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT)
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, fmt)
	m.custom_aabb = AABB(Vector3(-2, -1, -2), Vector3(4, 2, 4))
	return m
