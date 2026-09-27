class_name Gunfire
extends Node3D
## Gunfire VFX for Godot 4.6 — the port of gunfire.three.js (same calls, same textures).
##
##   var gf := Gunfire.new(); add_child(gf)                 # once, anywhere in the level
##   gf.muzzle(muzzle_node, "rifle")                        # muzzle node: local -Z = barrel
##   gf.tracer(from, dir, 320.0, 60.0)
##   gf.shell(ejector_node, "rifle")
##   gf.impact(point, normal, "concrete")                   # "concrete" | "metal" | "flesh"
##   gf.rocket_fire(muzzle_node, target_or_null, 52.0)      # + gf.backblast(rear_node); emits `exploded(pos)`
##   gf.explosion(pos, 7.0)
## Sprites are plain MeshInstance3D quads with gunfire.gdshader (additive) or its blend_mix twin
## (smoke); a small list is simulated in _process (no GPUParticles, so it behaves the same on every
## renderer and costs nothing when idle).

signal exploded(position: Vector3)
signal sound(id: String, position: Vector3)          # hook your audio here (en_rpg_flight, en_explosion, en_shell_drop)

const TEX_DIR := "res://assets/vfx/gunfire/textures/"
const WEAPON := {
	"pistol": {"flash": 0.16, "side": 0.26, "light": 6.0, "smoke": 0.12, "shell": Vector2(0.0045, 0.019), "tracer": false},
	"rifle": {"flash": 0.26, "side": 0.46, "light": 10.0, "smoke": 0.2, "shell": Vector2(0.005, 0.039), "tracer": true},
	"rpg": {"flash": 0.5, "side": 0.9, "light": 30.0, "smoke": 0.6, "shell": Vector2.ZERO, "tracer": false},
}

@export var floor_y := 0.0
@export var rocket_scene: PackedScene                 # rpg_rocket.glb
@export var blast_radius := 7.0

var _tex := {}
var _add: Shader
var _mix: Shader
var _quad := QuadMesh.new()
var _parts: Array = []        # {node, t, life, size, grow, opacity, vel, drag, rise, gravity, fade_in, kind}
var _lights: Array = []
var _rockets: Array = []
var _decals: Array = []


func _ready() -> void:
	_add = load("res://assets/vfx/gunfire/gunfire.gdshader")
	_mix = Shader.new()
	_mix.code = _add.code.replace("blend_add", "blend_mix")
	for n in ["flash_front", "flash_side", "smoke", "fire", "spark", "glow", "tracer", "shockwave", "scorch"]:
		_tex[n] = load(TEX_DIR + n + ".png")
	_quad.size = Vector2.ONE


func _mat(tex: String, additive := true, billboard := 1, tint := Color.WHITE) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = _add if additive else _mix
	m.set_shader_parameter("tex", _tex[tex])
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("billboard", billboard)
	m.set_shader_parameter("rotation", randf() * TAU)
	return m


func _sprite(tex: String, pos: Vector3, o := {}) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = _quad
	mi.material_override = _mat(tex, o.get("add", true), 1, o.get("tint", Color.WHITE))
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	mi.global_position = pos
	var size: float = o.get("size", 1.0)
	mi.scale = Vector3.ONE * size
	_parts.append({"node": mi, "t": 0.0, "life": o.get("life", 0.3), "size": size, "grow": o.get("grow", 0.0),
		"opacity": o.get("opacity", 1.0), "vel": o.get("vel", Vector3.ZERO), "drag": o.get("drag", 0.0),
		"rise": o.get("rise", 0.0), "gravity": o.get("gravity", 0.0), "fade_in": o.get("fade_in", 0.0), "kind": "sprite"})
	return mi


func _light(pos: Vector3, energy: float, life: float, col := Color(1.0, 0.75, 0.45)) -> void:
	var l := OmniLight3D.new()
	l.light_color = col
	l.light_energy = energy * 0.25
	l.omni_range = 10.0
	add_child(l)
	l.global_position = pos
	_lights.append({"node": l, "t": 0.0, "life": life, "e0": l.light_energy})


static func _fwd(n: Node3D) -> Vector3:
	return -n.global_transform.basis.z.normalized()


# ---------------------------------------------------------------- muzzle
func muzzle(node: Node3D, kind := "pistol") -> void:
	var W: Dictionary = WEAPON.get(kind, WEAPON.pistol)
	var p := node.global_position
	var f := _fwd(node)
	_sprite("flash_front", p + f * W.flash * 0.25, {"size": W.flash * 2.0, "life": 0.05, "grow": 1.0})
	for i in 2:
		var mi := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(W.side, W.side * 0.5)
		q.center_offset = Vector3(W.side * 0.5, 0, 0)
		mi.mesh = q
		mi.material_override = _mat("flash_side", true, 0)
		add_child(mi)
		mi.global_position = p
		mi.look_at(p + f.cross(Vector3.UP).normalized() if absf(f.y) < 0.95 else p + Vector3.RIGHT, f)
		mi.global_basis = Basis(f, (Vector3.UP - f * f.dot(Vector3.UP)).normalized(), f.cross((Vector3.UP - f * f.dot(Vector3.UP)).normalized()))
		mi.rotate(f, i * PI * 0.5 + randf() * 0.6)
		_parts.append({"node": mi, "t": 0.0, "life": 0.045, "size": 1.0, "grow": 0.0, "opacity": 1.0, "vel": Vector3.ZERO,
			"drag": 0.0, "rise": 0.0, "gravity": 0.0, "fade_in": 0.0, "kind": "mesh"})
	_light(p, W.light, 0.06)
	for i in (10 if kind == "rpg" else 3):
		_sprite("smoke", p + f * (0.05 + randf() * 0.1), {"size": W.smoke, "grow": 3.5, "life": 1.1 + randf(), "add": false,
			"opacity": 0.22, "tint": Color(0.72, 0.72, 0.72), "vel": f * (1.2 + randf()), "drag": 3.0, "rise": 0.25, "fade_in": 0.05})
	if W.tracer:
		tracer(p, f, 320.0 if kind == "rifle" else 250.0)


# ---------------------------------------------------------------- tracers
func tracer(from: Vector3, dir: Vector3, speed := 300.0, max_range := 70.0, width := 0.035, length := 2.2) -> void:
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.center_offset = Vector3(-0.5, 0, 0)
	mi.mesh = q
	mi.material_override = _mat("tracer", true, 2, Color(1.0, 0.88, 0.63))
	add_child(mi)
	var d := dir.normalized()
	_parts.append({"node": mi, "t": 0.0, "life": max_range / speed, "size": 1.0, "grow": 0.0, "opacity": 1.0,
		"vel": Vector3.ZERO, "drag": 0.0, "rise": 0.0, "gravity": 0.0, "fade_in": 0.0, "kind": "tracer",
		"from": from, "dir": d, "speed": speed, "width": width, "length": length, "max": max_range})


# ---------------------------------------------------------------- shells
func shell(node: Node3D, kind := "pistol") -> void:
	var W: Dictionary = WEAPON.get(kind, WEAPON.pistol)
	if W.shell == Vector2.ZERO:
		return
	var mi := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = W.shell.x
	c.bottom_radius = W.shell.x
	c.height = W.shell.y
	c.radial_segments = 8
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.78, 0.59, 0.24)
	m.metallic = 1.0
	m.roughness = 0.3
	c.material = m
	mi.mesh = c
	add_child(mi)
	var b := node.global_basis
	mi.global_position = node.global_position
	mi.global_basis = b
	var v: Vector3 = b.x * (2.2 + randf()) + b.y * (1.4 + randf() * 0.8) + b.z * (0.4 * randf())
	_parts.append({"node": mi, "t": 0.0, "life": 2.5, "size": 1.0, "grow": 0.0, "opacity": 1.0, "vel": v, "drag": 0.0,
		"rise": 0.0, "gravity": 9.8, "fade_in": 0.0, "kind": "shell", "spin": Vector3(randf_range(-15, 15), randf_range(-15, 15), randf_range(-20, 20)),
		"bounces": 0})


# ---------------------------------------------------------------- impacts
func impact(point: Vector3, normal: Vector3, material := "concrete") -> void:
	var n := normal.normalized()
	match material:
		"metal":
			for i in 12:
				_sprite("spark", point, {"size": 0.05, "life": 0.25 + randf() * 0.25, "gravity": 9.8, "drag": 1.0,
					"vel": n * (2.0 + randf() * 3.0) + _rand_dir() * 3.0})
			_light(point, 3.0, 0.05)
		"flesh":
			for i in 5:
				_sprite("smoke", point, {"size": 0.08, "grow": 2.0, "life": 0.35, "add": false, "opacity": 0.5,
					"tint": Color(0.35, 0.04, 0.03), "vel": n * (1.0 + randf()) + _rand_dir() * 0.6, "gravity": 4.0})
		_:
			for i in 4:
				_sprite("smoke", point + n * 0.03, {"size": 0.12, "grow": 4.0, "life": 0.9 + randf() * 0.5, "add": false,
					"opacity": 0.45, "tint": Color(0.6, 0.58, 0.54), "vel": n * (1.2 + randf()) + _rand_dir() * 0.5, "drag": 3.0})
			for i in 6:
				_sprite("spark", point, {"size": 0.03, "life": 0.18, "gravity": 9.8, "vel": n * 3.0 + _rand_dir() * 3.0})
	_decal(point, n, 0.05 if material == "flesh" else 0.12, 0.6)


func _decal(p: Vector3, n: Vector3, size: float, opacity: float) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = _quad
	var m := _mat("scorch", false, 0)
	m.set_shader_parameter("opacity", opacity)
	mi.material_override = m
	add_child(mi)
	mi.global_position = p + n * 0.004
	var up := Vector3.UP if absf(n.y) < 0.95 else Vector3.FORWARD
	mi.global_basis = Basis.looking_at(-n, up).scaled(Vector3.ONE * size)
	_decals.append(mi)
	if _decals.size() > 60:
		_decals.pop_front().queue_free()


static func _rand_dir() -> Vector3:
	return Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized()


# ---------------------------------------------------------------- RPG
func backblast(node: Node3D) -> void:
	var p := node.global_position
	var back := node.global_basis.z.normalized()
	_sprite("fire", p, {"size": 0.5, "grow": 3.0, "life": 0.12})
	for i in 16:
		_sprite("smoke", p, {"size": 0.3, "grow": 5.0, "life": 1.4 + randf(), "add": false, "opacity": 0.45,
			"tint": Color(0.64, 0.62, 0.57), "vel": back * (4.0 + randf() * 6.0) + _rand_dir() * 1.5, "drag": 2.5, "rise": 0.3})


func rocket_fire(node: Node3D, target = null, speed := 52.0, max_range := 90.0) -> void:
	muzzle(node, "rpg")
	var r: Node3D = rocket_scene.instantiate() if rocket_scene else MeshInstance3D.new()
	add_child(r)
	r.global_transform = node.global_transform
	var flame := _sprite("fire", r.global_position, {"size": 0.35, "life": 999.0})
	_rockets.append({"node": r, "flame": flame, "dir": _fwd(node), "speed": speed, "v": 0.0, "t": 0.0, "dist": 0.0,
		"target": target, "range": max_range, "trail": 0.0})
	sound.emit("en_rpg_flight", r.global_position)


func explosion(p: Vector3, size := 7.0) -> void:
	var s := size / 7.0
	_light(p + Vector3.UP, 140.0 * s, 0.5, Color(1.0, 0.63, 0.31))
	_sprite("glow", p, {"size": 6.0 * s, "grow": 1.0, "life": 0.12, "tint": Color(1.0, 0.9, 0.7)})
	for i in 14:
		var v := _rand_dir()
		v.y = absf(v.y) * 0.8 + 0.2
		v *= (2.0 + randf() * 6.0) * s
		_sprite("fire", p + v * 0.05, {"size": (0.8 + randf()) * s, "grow": 2.5, "life": 0.35 + randf() * 0.35, "vel": v, "drag": 4.0, "rise": 1.2})
	for i in 22:
		var v := _rand_dir()
		v.y = absf(v.y) * 0.6 + 0.1
		v *= (1.0 + randf() * 5.0) * s
		_sprite("smoke", p, {"size": (1.0 + randf()) * s, "grow": 3.0, "life": 2.2 + randf() * 1.8, "add": false, "opacity": 0.55,
			"tint": Color(0.25, 0.23, 0.21), "vel": v, "drag": 1.6, "rise": 0.9 * s, "fade_in": 0.15})
	for i in 40:
		var v := _rand_dir()
		v.y = absf(v.y) + 0.2
		_sprite("spark", p, {"size": 0.08, "life": 0.5 + randf() * 0.8, "vel": v * (6.0 + randf() * 10.0) * s, "gravity": 9.8, "drag": 0.5})
	var ring := MeshInstance3D.new()
	ring.mesh = _quad
	ring.material_override = _mat("shockwave", true, 0, Color(1.0, 0.85, 0.66))
	add_child(ring)
	ring.global_position = Vector3(p.x, floor_y + 0.05, p.z)
	ring.global_basis = Basis(Vector3.RIGHT, -PI * 0.5)
	_parts.append({"node": ring, "t": 0.0, "life": 0.45, "size": 1.0, "grow": 0.0, "opacity": 1.0, "vel": Vector3.ZERO,
		"drag": 0.0, "rise": 0.0, "gravity": 0.0, "fade_in": 0.0, "kind": "ring", "ring": size * 1.6})
	_decal(Vector3(p.x, floor_y, p.z), Vector3.UP, size * 0.7, 0.85)
	sound.emit("en_explosion", p)


# ---------------------------------------------------------------- frame
func _process(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	for i in range(_parts.size() - 1, -1, -1):
		var P: Dictionary = _parts[i]
		P.t += dt
		var k: float = P.t / P.life
		var node: Node3D = P.node
		if k >= 1.0:
			node.queue_free()
			_parts.remove_at(i)
			continue
		var m = node.material_override
		match P.kind:
			"sprite":
				var v: Vector3 = P.vel
				v *= exp(-P.drag * dt)
				v.y -= P.gravity * dt
				P.vel = v
				node.global_position += v * dt + Vector3.UP * P.rise * dt
				node.scale = Vector3.ONE * P.size * (1.0 + P.grow * k)
				var fin := minf(1.0, P.t / P.fade_in) if P.fade_in > 0.0 else 1.0
				m.set_shader_parameter("opacity", P.opacity * fin * (1.0 - k) * (1.0 - k * 0.3))
			"mesh":
				m.set_shader_parameter("opacity", 1.0 - k)
			"ring":
				var s: float = P.ring * (0.2 + k)
				node.scale = Vector3(s, s, s)
				m.set_shader_parameter("opacity", 1.0 - k)
			"tracer":
				var head: float = minf(P.max, P.t * P.speed)
				var hp: Vector3 = P.from + P.dir * head
				node.global_position = hp
				var x: Vector3 = P.dir
				var y := x.cross(Vector3.UP if absf(x.y) < 0.95 else Vector3.RIGHT).normalized()
				node.global_basis = Basis(x * minf(P.length, head), y * P.width, x.cross(y))
				if head >= P.max:
					P.t = P.life
			"shell":
				var v: Vector3 = P.vel
				v.y -= 9.8 * dt
				node.global_position += v * dt
				node.rotation += P.spin * dt
				if node.global_position.y < floor_y + 0.005 and v.y < 0.0:
					var gp := node.global_position
					gp.y = floor_y + 0.005
					node.global_position = gp
					v = Vector3(v.x * 0.5, -v.y * 0.35, v.z * 0.5)
					P.spin *= 0.5
					P.bounces += 1
					if P.bounces <= 2:
						sound.emit("en_shell_drop", gp)
				P.vel = v
	for i in range(_lights.size() - 1, -1, -1):
		var L: Dictionary = _lights[i]
		L.t += dt
		var k: float = L.t / L.life
		if k >= 1.0:
			L.node.queue_free()
			_lights.remove_at(i)
		else:
			L.node.light_energy = L.e0 * (1.0 - k) * (1.0 - k)
	for i in range(_rockets.size() - 1, -1, -1):
		var R: Dictionary = _rockets[i]
		R.t += dt
		R.v = minf(R.speed, R.v + (60.0 if R.t < 0.12 else 180.0) * dt)
		var step: float = R.v * dt
		R.dist += step
		var r: Node3D = R.node
		r.global_position += R.dir * step
		var tail: Vector3 = r.global_position - R.dir * 0.35
		R.flame.global_position = tail
		R.trail += dt
		while R.trail > 0.012:
			R.trail -= 0.012
			_sprite("smoke", tail + _rand_dir() * 0.03, {"size": 0.18, "grow": 5.0, "life": 2.2 + randf(), "add": false,
				"opacity": 0.35, "tint": Color(0.81, 0.79, 0.76), "rise": 0.15, "fade_in": 0.05})
		var boom: bool = R.dist > R.range or r.global_position.y < floor_y
		if R.target != null and r.global_position.distance_to(R.target) < maxf(0.6, step * 1.2):
			boom = true
		if boom:
			var p := r.global_position
			p.y = maxf(p.y, floor_y)
			r.queue_free()
			for j in _parts.size():
				if _parts[j].node == R.flame:
					_parts[j].t = _parts[j].life
			_rockets.remove_at(i)
			explosion(p, blast_radius)
			exploded.emit(p)
