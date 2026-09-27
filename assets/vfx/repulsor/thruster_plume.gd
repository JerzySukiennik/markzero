class_name ThrusterPlume
extends Node3D
## Layered thruster plume on an emitter whose local -Y is the exhaust (piv_thruster{L,R},
## piv_palm{L,R}, back vents). Port of showroom/js/vfx.js Thruster: core (with Mach diamonds),
## sheath, outer; a nozzle glow sprite; a flickering OmniLight. set_level(0..1.4) every frame
## from the flight model (or from the clip driver drv_thrust).
## style: "repulsor" (white -> ice blue: Mk II..85) or "flame" (white -> amber: Mk I, Hulkbuster).

@export var style := "repulsor"
@export var size := 1.0

var level := 0.0
var _target := 0.0
var _layers: Array = []        # [MeshInstance3D, base_len, kind]
var _glow: MeshInstance3D
var _light: OmniLight3D
var _seed := randf() * 10.0

func _ready() -> void:
	var dir: String = get_script().resource_path.get_base_dir()
	var sh: Shader = load(dir + "/thruster_plume.gdshader")
	var flame := style == "flame"
	for spec in [[0.028, 0.006, 0.34, 0.0], [0.05, 0.012, 0.75, 1.0], [0.075, 0.03, 1.1, 1.0]]:
		var cm := CylinderMesh.new()
		cm.top_radius = spec[0]
		cm.bottom_radius = spec[1]
		cm.height = spec[2]
		cm.radial_segments = 24
		cm.rings = 12
		cm.cap_top = false
		cm.cap_bottom = false
		var mi := MeshInstance3D.new()
		mi.mesh = cm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var m := ShaderMaterial.new()
		m.shader = sh
		m.set_shader_parameter("seed", _seed)
		m.set_shader_parameter("layer", spec[3])
		if flame:
			m.set_shader_parameter("mid", Color(1.0, 0.55, 0.12))
			m.set_shader_parameter("cool", Color(0.5, 0.12, 0.02))
		mi.material_override = m
		add_child(mi)
		_layers.append([mi, float(spec[2])])
	_glow = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.22, 0.22)
	_glow.mesh = q
	var gm := StandardMaterial3D.new()
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	gm.albedo_color = Color(1.0, 0.76, 0.48) if flame else Color(0.81, 0.91, 1.0)
	var g := GradientTexture2D.new()
	g.fill = GradientTexture2D.FILL_RADIAL
	g.fill_from = Vector2(0.5, 0.5)
	g.fill_to = Vector2(1.0, 0.5)
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 1))
	grad.set_color(1, Color(1, 1, 1, 0))
	g.gradient = grad
	gm.albedo_texture = g
	_glow.material_override = gm
	_glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_glow)
	_light = OmniLight3D.new()
	_light.light_color = Color(1.0, 0.63, 0.31) if flame else Color(0.62, 0.82, 1.0)
	_light.omni_range = 5.0
	_light.light_energy = 0.0
	_light.shadow_enabled = false
	_light.position = Vector3(0, -0.12, 0)
	add_child(_light)
	scale = Vector3.ONE * size

func set_level(v: float) -> void:
	_target = v

func _process(delta: float) -> void:
	level += (_target - level) * minf(1.0, delta * 14.0)
	var t := Time.get_ticks_msec() / 1000.0
	var flick := 0.9 + 0.1 * sin(t * 60.0 + _seed) + 0.06 * (randf() - 0.5)
	var L := maxf(0.0, level) * flick
	visible = L > 0.01
	var lens := [0.4 + 0.75 * L, 0.3 + 0.9 * L, 0.2 + 1.0 * L]
	for i in _layers.size():
		var mi: MeshInstance3D = _layers[i][0]
		var base: float = _layers[i][1]
		(mi.material_override as ShaderMaterial).set_shader_parameter("thrust", minf(1.4, L))
		# the cylinder is centred on its origin: stretch it and keep its top on the nozzle
		var s: float = lens[i]
		var wide := 1.0 + (0.3 * L if i == 2 else 0.0)
		mi.scale = Vector3(wide, s, wide)
		mi.position = Vector3(0, -base * s * 0.5, 0)
	(_glow.material_override as StandardMaterial3D).albedo_color.a = minf(1.0, L * 1.4)
	_glow.scale = Vector3.ONE * ((0.16 + 0.12 * L) * flick / 0.22)
	_light.light_energy = 6.0 * L * size
