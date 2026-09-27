class_name RibbonTrail
extends MeshInstance3D
## Camera-facing contrail ribbon from one emitter (port of showroom/js/vfx.js Trail).
## Add it to the WORLD (not the suit), call emit_from(node) once, then update(delta, camera)
## every frame. Boots: width 0.10, grow 2.6, life 1.8 s. Palms (vortex lines, additive):
## width 0.025, grow 1.2, life 0.9, min_speed 60 m/s.

@export var max_points := 110
@export var life := 1.8
@export var width := 0.10
@export var grow := 2.6
@export var min_speed := 8.0
@export var additive := false
## Drift of each condensation point (m/s): turbulence across the path + a slow rise, so the
## ribbon billows and breaks up with age instead of hanging as a ruler-straight line.
@export var turbulence := 0.9

var _src: Node3D
var _pts: Array = []           # [Vector3 position, float birth_time, Vector3 drift]
var _last := Vector3.ZERO
var _have_last := false
var _t := 0.0
var _mesh := ImmediateMesh.new()
var _seed := randf() * 100.0

func emit_from(node: Node3D) -> void:
	_src = node
	mesh = _mesh
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := ShaderMaterial.new()
	var dir: String = get_script().resource_path.get_base_dir()
	m.shader = load(dir + ("/trail_ribbon_add.gdshader" if additive else "/trail_ribbon.gdshader"))
	material_override = m

func clear() -> void:
	_pts.clear()
	_have_last = false

func update(delta: float, cam: Camera3D) -> void:
	if _src == null or cam == null:
		return
	_t += delta
	var p := _src.global_position
	var speed := p.distance_to(_last) / maxf(delta, 1e-4) if _have_last else 0.0
	_last = p
	_have_last = true
	if speed > min_speed:
		# smooth in birth time: neighbouring points drift together (billows, not jitter)
		var k := _seed + _t
		var drift := Vector3(sin(k * 1.7) + 0.5 * sin(k * 4.3), sin(k * 2.3 + 1.1) + 0.5 * sin(k * 5.1),
			sin(k * 1.3 + 2.2) + 0.5 * sin(k * 3.7)) * turbulence * 0.5
		drift.y += turbulence * 0.35
		_pts.push_front([p, _t, drift])
	for q in _pts:
		q[0] = (q[0] as Vector3) + (q[2] as Vector3) * delta
	while _pts.size() > max_points or (_pts.size() > 0 and _t - float(_pts[-1][1]) > life):
		_pts.pop_back()
	_mesh.clear_surfaces()
	var n := _pts.size()
	if n < 2:
		return
	_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLE_STRIP)
	var cam_p := cam.global_position
	for i in n:
		var cur: Vector3 = _pts[i][0]
		var prev: Vector3 = _pts[maxi(i - 1, 0)][0]
		var nxt: Vector3 = _pts[mini(i + 1, n - 1)][0]
		var tang := prev - nxt
		if tang.length_squared() < 1e-8:
			tang = Vector3.FORWARD
		var side := tang.cross(cam_p - cur).normalized()
		var age := clampf((_t - float(_pts[i][1])) / life, 0.0, 1.0)
		var w := width * (0.35 + grow * age)
		var u := float(i) / float(max_points)
		_mesh.surface_set_color(Color(1, 1, 1, age))
		_mesh.surface_set_uv(Vector2(u, 0))
		_mesh.surface_add_vertex(cur + side * w)
		_mesh.surface_set_color(Color(1, 1, 1, age))
		_mesh.surface_set_uv(Vector2(u, 1))
		_mesh.surface_add_vertex(cur - side * w)
	_mesh.surface_end()
