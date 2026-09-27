class_name NanoApply
extends RefCounted
## Swaps every glTF StandardMaterial3D on a mesh that has UV2 (NanoUV) for a ShaderMaterial
## running nano.gdshader, copying the PBR inputs across, and feeds the drivers each frame.
##
##   var nano := NanoApply.new()
##   nano.install(suit_root, preload("res://<path>/nano.gdshader"))
##   # every frame (after the AnimationPlayer has advanced):
##   nano.update(suit_root)
##
## Driver routing: a mesh node whose glTF extras (node meta "extras") contain
## "nano_driver": "drv_nano_blade" (and optionally "nano_paint") is driven by those Empties;
## otherwise drv_nano / drv_paint. A missing driver node counts as 1.0 (fully formed).
## A missing paint driver makes paint follow nano with PAINT_LAG delay.

const PAINT_LAG := 0.16

var groups := {}   # driver name -> { paint = String, mats = Array[ShaderMaterial] }
var overrides := {}  # driver name -> float (manual control, e.g. debug slider)

func install(root: Node, shader: Shader) -> void:
	var cache := {}
	var stack: Array = [root]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		for c in n.get_children():
			stack.push_back(c)
		if not (n is MeshInstance3D):
			continue
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		var dn := _extra(mi, "nano_driver", "drv_nano")
		var pn := _extra(mi, "nano_paint", "drv_paint" if dn == "drv_nano" else dn.replace("drv_nano", "drv_paint"))
		for s in mi.mesh.get_surface_count():
			if (mi.mesh.surface_get_format(s) & Mesh.ARRAY_FORMAT_TEX_UV2) == 0:
				continue
			var src := mi.get_active_material(s)
			var key := str(src.get_instance_id() if src else 0) + "|" + dn
			if not cache.has(key):
				cache[key] = _convert(src, shader)
				if not groups.has(dn):
					groups[dn] = { paint = pn, mats = [] }
				groups[dn].mats.append(cache[key])
			mi.set_surface_override_material(s, cache[key])

func update(root: Node) -> void:
	for dn in groups:
		var g: Dictionary = groups[dn]
		var nano := clampf(_value(root, dn, 1.0), 0.0, 1.0)
		var paint: float
		if overrides.has(g.paint) or root.find_child(g.paint, true, false) != null:
			paint = _value(root, g.paint, 1.0)
		else:
			paint = clampf((nano - PAINT_LAG) / (1.0 - PAINT_LAG), 0.0, 1.0)
			if nano >= 0.9999:
				paint = 1.0
		paint = minf(clampf(paint, 0.0, 1.0), nano)
		for m: ShaderMaterial in g.mats:
			m.set_shader_parameter("nano", nano)
			m.set_shader_parameter("paint", paint)

func _value(root: Node, name: String, fallback: float) -> float:
	if overrides.has(name):
		return overrides[name]
	var d := root.find_child(name, true, false) as Node3D
	return d.position.x if d != null else fallback

static func _extra(n: Node, key: String, fallback: String) -> String:
	var p: Node = n
	while p != null:
		if p.has_meta("extras"):
			var ex = p.get_meta("extras")
			if ex is Dictionary and ex.has(key):
				return String(ex[key])
		p = p.get_parent()
	return fallback

static func _convert(src: Material, shader: Shader) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = shader
	var sm := src as BaseMaterial3D
	if sm == null:
		return m
	m.set_shader_parameter("albedo_color", sm.albedo_color)
	if sm.albedo_texture:
		m.set_shader_parameter("albedo_texture", sm.albedo_texture)
	m.set_shader_parameter("metallic", sm.metallic)
	m.set_shader_parameter("roughness", sm.roughness)
	# glTF packs roughness (G) and metallic (B) in one image; Godot keeps it on both slots.
	var mr: Texture2D = sm.roughness_texture if sm.roughness_texture else sm.metallic_texture
	if mr:
		m.set_shader_parameter("metallic_roughness_texture", mr)
	if sm.normal_enabled and sm.normal_texture:
		m.set_shader_parameter("has_normal_texture", true)
		m.set_shader_parameter("normal_texture", sm.normal_texture)
		m.set_shader_parameter("normal_scale", sm.normal_scale)
	if sm.emission_enabled:
		m.set_shader_parameter("emission_color", sm.emission)
		m.set_shader_parameter("emission_energy", sm.emission_energy_multiplier)
		if sm.emission_texture:
			m.set_shader_parameter("emission_texture", sm.emission_texture)
	if sm.ao_enabled and sm.ao_texture:
		m.set_shader_parameter("has_occlusion_texture", true)
		m.set_shader_parameter("occlusion_texture", sm.ao_texture)
	return m
