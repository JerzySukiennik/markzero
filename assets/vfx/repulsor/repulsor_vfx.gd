class_name RepulsorVFX
extends Node3D
## Visual half of the repulsor (port of showroom/js/vfx.js Repulsors). Gameplay stays in the
## game's scripts/combat/repulsor.gd (pool, cooldown, magazine, magnetism, hits); this node
## replaces what a bolt LOOKS like and adds the muzzle, the charge glow and the impact.
##
## Put ONE instance in the world at the origin (like Repulsors). Then:
##   var vis := vfx.make_bolt()            # once per pooled bolt; parent it to the bolt node
##   vfx.orient_bolt(vis, dir, cam, grown) # every frame: streak along dir, facing the camera
##   vfx.muzzle(palm_pos, dir, big)        # on fire
##   vfx.impact(pos, normal, big)          # on hit
##   vfx.charge(palm_node, level)          # while charging (0..1); 0 hides it
## Bolt speed 260 m/s -> streak length clamp(speed*0.024, 1.4, 5) m (x1.5 when charged).

const HALO := Color(0.35, 0.70, 1.0)
var _dir: String
var _bolt_shader: Shader
var _glow_tex: GradientTexture2D
var _ring_tex: GradientTexture2D
var _live: Array = []        # [node, age, life, kind, data]
var _charges: Dictionary = {}

func _ready() -> void:
	name = "RepulsorVFX"
	_dir = get_script().resource_path.get_base_dir()
	_bolt_shader = load(_dir + "/repulsor_bolt.gdshader")
	_glow_tex = _radial([[0.0, Color(1, 1, 1, 1)], [0.18, Color(1, 1, 1, 0.85)], [0.45, Color(1, 1, 1, 0.22)], [1.0, Color(1, 1, 1, 0)]])
	_ring_tex = _radial([[0.0, Color(1, 1, 1, 0)], [0.30, Color(1, 1, 1, 0)], [0.69, Color(1, 1, 1, 1)], [0.79, Color(1, 1, 1, 0.35)], [1.0, Color(1, 1, 1, 0)]])

static func _radial(stops: Array) -> GradientTexture2D:
	var g := Gradient.new()
	g.offsets = PackedFloat32Array(stops.map(func(s): return s[0]))
	g.colors = PackedColorArray(stops.map(func(s): return s[1]))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 128
	t.height = 128
	return t

func _add_mat(tex: Texture2D, col: Color, billboard := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.no_depth_test = false
	m.albedo_texture = tex
	m.albedo_color = col
	if billboard:
		m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	return m

## The streak quad + its light. Parent it to a pooled bolt node.
func make_bolt(big := false) -> Node3D:
	var root := Node3D.new()
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	mi.mesh = q
	var m := ShaderMaterial.new()
	m.shader = _bolt_shader
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.name = "Streak"
	root.add_child(mi)
	var l := OmniLight3D.new()
	l.light_color = Color(0.66, 0.85, 1.0)
	l.light_energy = 14.0 if big else 7.0
	l.omni_range = 9.0 if big else 6.0
	root.add_child(l)
	root.set_meta("big", big)
	return root

## Every frame: X along the travel direction, the quad's face towards the camera; the head sits
## on the bolt's position. `grown` 0..1 lets the streak grow out of the palm over its first metres.
func orient_bolt(vis: Node3D, dir: Vector3, cam: Camera3D, speed := 260.0, grown := 1.0) -> void:
	var streak: MeshInstance3D = vis.get_node("Streak")
	var big: bool = vis.get_meta("big", false)
	var length := clampf(speed * 0.024, 1.4, 5.0) * (1.5 if big else 1.0) * maxf(0.15, grown)
	var width := 0.7 if big else 0.34
	var p := vis.global_position
	var to_cam := (cam.global_position - p).normalized()
	var side := dir.cross(to_cam).normalized()
	var nrm := dir.cross(side).normalized()
	streak.global_basis = Basis(dir * length, side * width, nrm)
	streak.global_position = p - dir * length * 0.36

func charge(palm: Node3D, level: float) -> void:
	var c: Node3D = _charges.get(palm)
	if c == null or not is_instance_valid(c):
		c = Node3D.new()
		var s := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2.ONE
		s.mesh = q
		s.material_override = _add_mat(_glow_tex, Color(0.75, 0.89, 1.0))
		s.name = "Glow"
		c.add_child(s)
		var l := OmniLight3D.new()
		l.light_color = Color(0.62, 0.82, 1.0)
		l.omni_range = 4.0
		l.name = "Light"
		c.add_child(l)
		c.position = Vector3(0, -0.02, 0)
		palm.add_child(c)
		_charges[palm] = c
	var fl := 0.85 + 0.15 * sin(Time.get_ticks_msec() * 0.043)
	c.visible = level > 0.01
	(c.get_node("Glow") as Node3D).scale = Vector3.ONE * (0.12 + 0.3 * level) * fl
	((c.get_node("Glow") as MeshInstance3D).material_override as StandardMaterial3D).albedo_color.a = minf(1.0, level * 1.2)
	(c.get_node("Light") as OmniLight3D).light_energy = 5.0 * level * fl

func _sprite(at: Vector3, tex: Texture2D, col: Color, size: float, grow: float, life: float, normal := Vector3.ZERO) -> void:
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE
	mi.mesh = q
	var bill := normal == Vector3.ZERO
	mi.material_override = _add_mat(tex, col, bill)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	mi.global_position = at
	if not bill:
		mi.global_basis = Basis(Quaternion(Vector3.BACK, normal.normalized()))
	mi.scale = Vector3.ONE * size
	_live.append([mi, 0.0, life, "sprite", [size, grow, col.a]])

func _flash_light(at: Vector3, energy: float, life: float) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(0.75, 0.88, 1.0)
	l.omni_range = 8.0
	l.light_energy = energy
	add_child(l)
	l.global_position = at
	_live.append([l, 0.0, life, "light", [energy]])

func _sparks(at: Vector3, normal: Vector3, amount: int, speed: float, col: Color) -> void:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = 0.7
	p.one_shot = true
	p.explosiveness = 0.95
	p.local_coords = false
	var pm := ParticleProcessMaterial.new()
	pm.direction = normal
	pm.spread = 55.0
	pm.initial_velocity_min = speed * 0.35
	pm.initial_velocity_max = speed * 1.3
	pm.gravity = Vector3(0, -9.8, 0)
	pm.damping_min = 1.0
	pm.damping_max = 2.0
	pm.color = col
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.03, 0.12)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.vertex_color_use_as_albedo = true
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.albedo_color = Color(3, 2.4, 1.6)
	q.material = m
	p.draw_pass_1 = q
	p.transform_align = GPUParticles3D.TRANSFORM_ALIGN_Z_BILLBOARD_Y_TO_VELOCITY
	add_child(p)
	p.global_position = at
	p.emitting = true
	_live.append([p, 0.0, 1.2, "free", []])

func muzzle(at: Vector3, dir: Vector3, big := false) -> void:
	_sprite(at, _glow_tex, Color(0.85, 0.94, 1.0, 1.0), 1.1 if big else 0.55, 0.5, 0.09)
	_sprite(at + dir * 0.1, _ring_tex, Color(0.62, 0.83, 1.0, 0.75), 0.28 if big else 0.16, 3.2 if big else 1.8, 0.16, dir)
	_flash_light(at, 26.0 if big else 12.0, 0.08)
	_sparks(at, dir, 14 if big else 6, 6.0, Color(0.7, 0.85, 1.0))

func impact(at: Vector3, normal: Vector3, big := false) -> void:
	_sprite(at, _glow_tex, Color(0.9, 0.96, 1.0, 1.0), 3.0 if big else 1.6, 0.8, 0.16)
	_sprite(at + normal * 0.02, _ring_tex, Color(0.62, 0.83, 1.0, 0.8), 0.2, 6.0 if big else 3.0, 0.24, normal)
	_flash_light(at, 40.0 if big else 18.0, 0.12)
	_sparks(at, normal, 60 if big else 32, 13.0 if big else 9.0, Color(1.0, 0.85, 0.55))
	var d := Decal.new()                      # scorch
	d.texture_albedo = _glow_tex
	d.modulate = Color(0, 0, 0, 0.55)
	d.size = Vector3.ONE * (0.9 if big else 0.5)
	add_child(d)
	d.global_position = at
	d.global_basis = Basis(Quaternion(Vector3.UP, normal.normalized()))
	_live.append([d, 0.0, 20.0, "decal", []])

func _process(delta: float) -> void:
	for i in range(_live.size() - 1, -1, -1):
		var e: Array = _live[i]
		e[1] += delta
		var k: float = e[1] / e[2]
		var n: Node = e[0]
		if k >= 1.0 or not is_instance_valid(n):
			if is_instance_valid(n):
				n.queue_free()
			_live.remove_at(i)
			continue
		match e[3]:
			"sprite":
				var d: Array = e[4]
				var s: float = d[0] * (1.0 + d[1] * (1.0 - pow(1.0 - k, 3.0)))
				(n as Node3D).scale = Vector3.ONE * s
				((n as MeshInstance3D).material_override as StandardMaterial3D).albedo_color.a = d[2] * (1.0 - k) * (1.0 - k)
			"light":
				(n as OmniLight3D).light_energy = e[4][0] * (1.0 - k) * (1.0 - k)
			"decal":
				(n as Decal).modulate.a = 0.55 * (1.0 - maxf(0.0, k - 0.7) / 0.3)
