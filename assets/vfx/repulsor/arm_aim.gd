class_name ArmAim
extends RefCounted
## Procedural repulsor aim layered AFTER the animation pose (port of showroom/js/aim.js).
##
## Why: the shipped game never raised the arm when shooting ("nie widać w ogóle podniesienia
## ręki i celowania"). This solves it the way shooters do: the clip animates the body, then a
## two-bone IK puts the wrist on the shoulder->target line (arm ~93% extended, elbow dropping
## towards a pole), the wrist turns so the palm emitter's -Y points exactly at the target with
## the fingers up, the fingers bend back, and `weight` blends the whole thing in and out
## (fast up, slower down). `recoil` (set to ~0.6 per shot, 1.0 for a charged blast) kicks the
## whole arm UP about the shoulder and pulls it in for a few frames.
##
## IMPORTANT (found in the showroom): this layer must start from the FRESH animated pose every
## frame. three.js skips channels whose sampled value did not change, so the look-at spun the
## torso round and round on a held pose. In Godot, run it after the AnimationTree has written
## the pose (AnimationMixer callback mode "manual" + advance() then ArmAim.update(), or
## process priority after the tree) and never feed last frame's result back in.
##
## Works on the v2 canonical skeleton (next/CONTRACT.md): Node3D pivots named piv_*, identity
## rest rotations, piv_palm{L,R} as the emitter child of piv_wrist{L,R}.
## Call update() every frame AFTER the AnimationPlayer/AnimationTree has posed the rig.

var side := "R"
var weight := 0.0
var want := 0.0
var target := Vector3(0, 1.5, -10)
var recoil := 0.0

var _sh: Node3D
var _el: Node3D
var _wr: Node3D
var _palm: Node3D
var _fingers: Array = []        # [[f1, f2], ...] index..pinky
var _la := 0.3
var _lb := 0.27
var _hand_axis := Vector3.DOWN
var _palm_out := Vector3.DOWN
var _curl_axis := Vector3.RIGHT
var ok := false

func _init(root: Node3D, which_side: String) -> void:
	side = which_side
	_sh = root.find_child("piv_shoulder" + side, true, false)
	_el = root.find_child("piv_elbow" + side, true, false)
	_wr = root.find_child("piv_wrist" + side, true, false)
	_palm = root.find_child("piv_palm" + side, true, false)
	for f in ["index", "middle", "ring", "pinky"]:
		_fingers.append([root.find_child("piv_f_%s1%s" % [f, side], true, false),
			root.find_child("piv_f_%s2%s" % [f, side], true, false)])
	ok = _sh != null and _el != null and _wr != null and _palm != null
	if not ok:
		return
	_la = _el.position.length()
	_lb = _wr.position.length()
	var mid: Node3D = _fingers[1][0]
	if mid != null:
		_hand_axis = mid.position.normalized()
	_palm_out = (_palm.quaternion * Vector3.DOWN).normalized()      # wrist-local
	_curl_axis = _hand_axis.cross(_palm_out).normalized()

## Local rotation for `node` that swings its rest child offset onto WORLD direction d.
func _aim_node(node: Node3D, child_rest: Vector3, d_world: Vector3) -> Quaternion:
	var parent := node.get_parent() as Node3D
	var pq := parent.global_basis.get_rotation_quaternion()
	var dl := (pq.inverse() * d_world).normalized()
	return Quaternion(child_rest.normalized(), dl)

func update(delta: float) -> void:
	if not ok:
		return
	var rate := 16.0 if want > weight else 7.0
	weight += (want - weight) * (1.0 - exp(-delta * rate))
	recoil = maxf(0.0, recoil - delta * 6.0)
	if weight < 0.002:
		return
	var w := weight
	var S := _sh.global_position
	var to_t := target - S
	var dir := to_t.normalized()
	var reach := (_la + _lb) * (0.93 - 0.10 * recoil)
	var W := S + dir * minf(reach, to_t.length() * 0.9)
	var D := W - S
	var dl := D.length()
	var cos_a := clampf((_la * _la + dl * dl - _lb * _lb) / (2.0 * _la * dl), -1.0, 1.0)
	var A := acos(cos_a)
	var out := -1.0 if side == "L" else 1.0            # anatomical L is -X
	var dn := D.normalized()
	var pole := Vector3(out * 0.35, -1.0, 0.15).normalized()
	pole = (pole - dn * pole.dot(dn)).normalized()
	var E := S + dn * cos(A) * _la + pole * sin(A) * _la
	# shoulder (+ recoil kick about the parent's X)
	var qs := _aim_node(_sh, _el.position, E - S)
	_sh.quaternion = _sh.quaternion.slerp(qs, w)
	# elbow
	var qe := _aim_node(_el, _wr.position, W - _el.global_position)
	_el.quaternion = _el.quaternion.slerp(qe, w)
	# wrist: emitter -Y at the target, fingers (emitter -Z) up
	var aim := (target - _wr.global_position).normalized()
	var y := -aim
	var z := -(Vector3.UP - y * Vector3.UP.dot(y)).normalized()
	if z.length_squared() < 1e-4:
		z = Vector3.BACK
	var x := y.cross(z).normalized()
	var emit_world := Basis(x, y, z).get_rotation_quaternion()
	var parent_q := _el.global_basis.get_rotation_quaternion()
	var qw := parent_q.inverse() * emit_world * _palm.quaternion.inverse()
	_wr.quaternion = _wr.quaternion.slerp(qw, w)
	# fingers bent back and splayed
	var back := -0.38 * w - 0.25 * recoil
	for i in _fingers.size():
		var f1: Node3D = _fingers[i][0]
		var f2: Node3D = _fingers[i][1]
		if f1 == null:
			continue
		var spread := (1.3 - i) * 0.09 * w * (1.0 if side == "L" else -1.0)
		var q1 := Quaternion(_palm_out, spread) * Quaternion(_curl_axis, back)
		f1.quaternion = f1.quaternion.slerp(q1, w)
		if f2 != null:
			f2.quaternion = f2.quaternion.slerp(Quaternion(_curl_axis, back * 0.4), w)
	# recoil LAST: the whole solved arm kicks UP (muzzle climb) about the shoulder, about
	# armDir x worldUp in the shoulder's parent frame. Applied before the elbow/wrist solve it
	# gets cancelled by them re-aiming at the old point (the arm dips instead of kicking).
	if recoil > 0.0:
		var axis_w := dir.cross(Vector3.UP)
		if axis_w.length_squared() > 1e-6:
			var pq := (_sh.get_parent() as Node3D).global_basis.get_rotation_quaternion()
			var axis_l := (pq.inverse() * axis_w).normalized()
			_sh.quaternion = Quaternion(axis_l, 0.30 * w * recoil * recoil) * _sh.quaternion
