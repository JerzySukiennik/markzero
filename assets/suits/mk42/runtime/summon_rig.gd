# summon_rig.gd — Godot 4.6 glue for the Mark 42 summon runtime (port of summon-three.js).
#
#   var rig := MK42SummonRig.new()
#   add_child(rig)
#   rig.setup(suit_scene_root, JSON.parse_string(pieces_json_text), wearer_root, 7)
#   rig.lock_all()                 # suit on
#   rig.eject()                    # blow it off      | rig.shed("pauldronL")
#   rig.scatter()                  # lay pieces around (debug / showcase)
#   rig.summon()                   # fly back from wherever they lie, lock onto the LIVE wearer
#   rig.event.connect(func(e): ...)   # "wake" "fly" "approach" "clamp" "lock" "eject" "bounce" "shed" "allLocked"
#
# Call order per frame: the wearer's AnimationPlayer / AnimationTree first, then rig.step(dt)
# (or leave process_priority high so _process runs after the animation). step() adds the
# body reactions on top of the animated pose, advances MK42Summon and places every plate.
#
# The WEARER is anything with canonical piv_* joints: Tony / Peter (a Skeleton3D whose bones
# are named piv_*) or a node hierarchy (the suit's own pivots). Joints the wearer lacks
# (piv_faceplateL/R, piv_flap_*) are VIRTUAL: parent joint * rest offset from the pieces table,
# optionally rotated through `virtual_rot[name]` (e.g. faceplates pre-opened, then closed).
#
# Plates are never re-parented: each suit MeshInstance3D becomes top_level and gets its
# global_transform written every frame (locked = live joint * rest local; flying = runtime frame).
class_name MK42SummonRig
extends Node3D

signal event(e: Dictionary)

const SummonCore := preload("summon.gd")

var core
var table: Dictionary
var suit: Node3D
var wearer: Node3D
var skel: Skeleton3D = null
var lift := 0.015                  # the armour's soles: the wearer stands 1.5 cm higher when booted
var lift_now := 0.0
var virtual_rot := {}              # joint -> Quaternion (local extra rotation of a virtual joint)
var virtual_pos := {}              # joint -> Vector3 (local extra offset of a virtual joint)

var _joint_node := {}              # name -> Node3D (node-hierarchy wearer)
var _bone := {}                    # name -> bone index (skeleton wearer)
var _virtual := {}                 # name -> true
var _wearer_rest := {}             # name -> Vector3 rest position relative to piv_root
var _meshes := {}                  # mesh name -> rec
var _piece_meshes := {}            # piece -> [rec]
var _jets := {}                    # piece -> MeshInstance3D
var _root_base_y := 0.0


func setup(suit_root: Node3D, piece_table: Dictionary, wearer_root: Node3D, seed := 42, with_jets := true) -> void:
	suit = suit_root
	table = piece_table
	wearer = wearer_root
	skel = _find_skeleton(wearer)
	var J: Dictionary = table["joints"]
	var PAR: Dictionary = table["parents"]
	for n in J.keys():
		if skel != null and skel.find_bone(n) >= 0:
			_bone[n] = skel.find_bone(n)
		else:
			var o := wearer.find_child(n, true, false)
			if o != null and o is Node3D:
				_joint_node[n] = o
			else:
				_virtual[n] = true
	if _bone.has("piv_root"):
		_root_base_y = skel.get_bone_pose_position(_bone["piv_root"]).y
	elif _joint_node.has("piv_root"):
		_root_base_y = _joint_node["piv_root"].position.y
	# rest positions of the wearer relative to its root (for the reactor-style corrections)
	var root_w := joint_world("piv_root").origin
	for n in J.keys():
		if not _virtual.has(n):
			_wearer_rest[n] = joint_world(n).origin - root_w
	for p in table["pieces"]:
		var list: Array = []
		for m in p["meshes"]:
			var obj := suit.find_child(m["name"], true, false) as Node3D
			if obj == null:
				continue
			var sr: Array = J[m["joint"]]
			var fix := Vector3.ZERO
			if _wearer_rest.has(m["joint"]):
				var wr: Vector3 = _wearer_rest[m["joint"]]
				fix = Vector3(sr[0] - wr.x, sr[1] - lift - wr.y, sr[2] - wr.z)
				if fix.length() < 0.002:
					fix = Vector3.ZERO
			var rec := {"obj": obj, "joint": m["joint"], "piece": p["name"], "lead": p["joint"],
				"rest": obj.transform, "fix": fix, "off": null}
			obj.top_level = true
			_meshes[m["name"]] = rec
			list.append(rec)
		_piece_meshes[p["name"]] = list
	core = SummonCore.new(table, Callable(self, "joint_world"), seed)
	if with_jets:
		_make_jets()


# ---------------------------------------------------------------- joints
func _find_skeleton(n: Node) -> Skeleton3D:
	if n is Skeleton3D:
		return n
	for c in n.get_children():
		var s := _find_skeleton(c)
		if s != null:
			return s
	return null


func joint_world(name: String) -> Transform3D:
	if _bone.has(name):
		return skel.global_transform * skel.get_bone_global_pose(_bone[name])
	if _joint_node.has(name):
		return (_joint_node[name] as Node3D).global_transform
	# virtual joint: parent * (rest offset [+ extra offset], extra rotation)
	var J: Dictionary = table["joints"]
	var par: String = table["parents"][name]
	var a: Array = J[name]
	var b: Array = J[par]
	var off: Vector3 = Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + (virtual_pos.get(name, Vector3.ZERO) as Vector3)
	var rq: Quaternion = virtual_rot.get(name, Quaternion.IDENTITY)
	return joint_world(par) * Transform3D(Basis(rq), off)


func _rotate_joint_global(name: String, R: Quaternion) -> void:
	# premultiply the joint's local rotation by R expressed in the parent's frame
	if _bone.has(name):
		var b: int = _bone[name]
		var pb := skel.get_bone_parent(b)
		var P := (skel.global_transform.basis * (skel.get_bone_global_pose(pb).basis if pb >= 0 else Basis())).get_rotation_quaternion()
		var q := skel.get_bone_pose_rotation(b)
		skel.set_bone_pose_rotation(b, (P.inverse() * R * P) * q)
	elif _joint_node.has(name):
		var o: Node3D = _joint_node[name]
		var P2 := o.get_parent_node_3d().global_transform.basis.get_rotation_quaternion()
		o.quaternion = (P2.inverse() * R * P2) * o.quaternion


func _apply_lift() -> void:
	if _bone.has("piv_root"):
		var p := skel.get_bone_pose_position(_bone["piv_root"])
		skel.set_bone_pose_position(_bone["piv_root"], Vector3(p.x, _root_base_y + lift_now, p.z))
	elif _joint_node.has("piv_root"):
		var o: Node3D = _joint_node["piv_root"]
		o.position.y = _root_base_y + lift_now


# ---------------------------------------------------------------- commands
func lock_all() -> void:
	core.lock_all()
	lift_now = lift
	_apply_lift()
	_place()


func eject(strength := 1.0) -> void:
	var locked: Array = []
	for p in table["pieces"]:
		if core.is_locked(p["name"]):
			locked.append(p["name"])
	core.eject(strength)
	for n in locked:
		_capture(n)
	_drain()


func shed(name: String, push := 1.0) -> void:
	if not core.is_locked(name):
		return
	core.shed(name, push)
	_capture(name)
	_drain()


func scatter(center := Vector3.ZERO, r_min := 1.2, r_max := 4.5, far_chance := 0.15, seed := -1) -> void:
	for p in table["pieces"]:
		for rec in _piece_meshes[p["name"]]:
			rec["off"] = _rest_offset(rec)
	core.scatter(center, r_min, r_max, far_chance, 7.0, 13.0, seed)
	lift_now = 0.0
	_apply_lift()
	_place()


func summon(names = null, delay := 0.0) -> int:
	var n: int = core.summon(names, delay)
	_drain()
	return n


func hide_pieces(names: Array) -> void:
	core.hide(names)
	for n in names:
		for rec in _piece_meshes[n]:
			rec["obj"].visible = false


# ---------------------------------------------------------------- per frame
func step(dt: float) -> void:
	for j in core.reaction_joints():
		var v: Vector3 = core.reaction(j)
		var ang := v.length()
		if ang > 1e-5 and not _virtual.has(j):
			_rotate_joint_global(j, Quaternion(v / ang, ang))
	var boots_on := true
	for n in ["bootL", "bootR"]:
		if core.by_name.has(n) and not core.is_locked(n):
			boots_on = false
	var want := lift if boots_on else 0.0
	lift_now += (want - lift_now) * minf(1.0, dt * 18.0)
	_apply_lift()
	core.update(dt)
	_place()
	_drain()


func _capture(piece: String) -> void:
	var Fi: Transform3D = core.frame(piece).affine_inverse()
	for rec in _piece_meshes[piece]:
		rec["off"] = Fi * (rec["obj"] as Node3D).global_transform


func _rest_offset(rec: Dictionary) -> Transform3D:
	# mesh relative to its piece's lead joint at REST (a flying glove is straight)
	var J: Dictionary = table["joints"]
	var a: Array = J[rec["joint"]]
	var b: Array = J[rec["lead"]]
	var r: Transform3D = rec["rest"]
	return Transform3D(r.basis, Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + r.origin)


func _locked_xf(rec: Dictionary) -> Transform3D:
	var r: Transform3D = rec["rest"]
	return joint_world(rec["joint"]) * Transform3D(r.basis, r.origin + rec["fix"])


func _place() -> void:
	for p in table["pieces"]:
		var name: String = p["name"]
		var st: String = core.state(name)
		var jet = _jets.get(name)
		if st == "locked" or st == "hidden":
			if st == "locked":
				for rec in _piece_meshes[name]:
					rec["obj"].global_transform = _locked_xf(rec)
			if jet:
				jet.visible = false
			continue
		var F: Transform3D = core.frame(name)
		var sub: float = core.sub(name)
		for rec in _piece_meshes[name]:
			if rec["off"] == null:
				rec["off"] = _rest_offset(rec)
			var M: Transform3D = F * rec["off"]
			if sub > 0.0:
				M = M.interpolate_with(_locked_xf(rec), sub)
			rec["obj"].global_transform = M
		if jet:
			var th: float = core.thrust(name)
			jet.visible = th > 0.02
			jet.global_transform = F.scaled_local(Vector3.ONE * (0.6 + 0.6 * th))
			(jet.material_override as StandardMaterial3D).albedo_color.a = minf(1.0, th) * (0.55 + 0.25 * randf())


func _drain() -> void:
	for e in core.drain_events():
		if e["type"] == "lock":
			for rec in _piece_meshes[e["piece"]]:
				rec["off"] = null
		event.emit(e)


func _make_jets() -> void:
	for p in table["pieces"]:
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.018
		cone.height = 0.12
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		mat.albedo_color = Color(0.75, 0.89, 1.0, 0.0)
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		var holder := MeshInstance3D.new()          # piece frame; child = the cone aimed along -n
		holder.top_level = true
		holder.visible = false
		holder.material_override = mat
		var c := MeshInstance3D.new()
		c.mesh = cone
		c.material_override = mat
		var n := SummonCore._v(p["normal"]).normalized()
		var ctr := SummonCore._v(p["center"])
		# cone tip is +Y: point the exhaust into the shell side (-n), like summon-three.js
		c.transform = Transform3D(Basis(SummonCore._between(Vector3.DOWN, -n)), ctr - n * 0.07)
		holder.add_child(c)
		add_child(holder)
		_jets[p["name"]] = holder
