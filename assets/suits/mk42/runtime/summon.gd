# summon.gd — Mark 42 prehensile summon / eject / shed runtime (Godot 4.6 port).
#
# Faithful, line-by-line port of summon.js (same states, same tuning, same mulberry32 RNG:
# the same seed gives the same summon in the showroom and in the game). Engine glue lives
# in summon_rig.gd (joint provider from a Skeleton3D / pivot nodes, mesh placement).
#
# Model: a PIECE (from mk42.pieces.json) flies as one rigid body; its socket is the live
# world transform of its lead joint. The host places meshes with frame(name) and blends
# meshes on other joints with sub(name). All targets are LIVE (a walking wearer works).
# Coordinates: Godot == glTF: +Y up, metres. The figure faces -Z.
class_name MK42Summon
extends RefCounted

const TUNE := {
	"wake": 0.30, "hop": 0.06,
	"approachDist": 0.30, "preLock": 0.03,
	"approach": 0.22, "hold": 0.05, "clamp": 0.07, "overshoot": 1.1,
	"orderGap": 0.24, "orderJitter": 0.12, "faceplateGap": 0.30,
	"flyBase": 0.52, "flyPerSqrtM": 0.22, "flyMin": 0.62, "flyMax": 2.5,
	"keepOutR": 0.40, "keepOutSoft": 0.12,
	"avoidK": 9.0, "avoidSpring": 14.0, "avoidDamp": 7.5,
	"reactK": 320.0, "reactZeta": 0.32, "reactKick": 1.3, "reactKickPerM": 2.2,
	"gravity": 9.81, "restitution": 0.30, "friction": 0.55, "settleTime": 0.40,
}
const UP := Vector3(0, 1, 0)

var table: Dictionary
var joint_fn: Callable            # func(name: String) -> Transform3D (world)
var ground_fn: Callable           # func(x: float, z: float) -> float
var time := 0.0
var events: Array = []
var react := {}                   # joint -> {"v": Vector3, "w": Vector3}
var pieces: Array = []            # of Dictionary (state per piece)
var by_name := {}
var _all_locked_sent := true
var _rng_state := 0


# ---------------------------------------------------------------- RNG (mulberry32)
static func _imul(a: int, b: int) -> int:
	a &= 0xFFFFFFFF
	b &= 0xFFFFFFFF
	var ah := (a >> 16) & 0xFFFF
	var al := a & 0xFFFF
	var bh := (b >> 16) & 0xFFFF
	var bl := b & 0xFFFF
	return ((al * bl) + ((((ah * bl) + (al * bh)) & 0xFFFF) << 16)) & 0xFFFFFFFF


func _rand() -> float:
	_rng_state = (_rng_state + 0x6D2B79F5) & 0xFFFFFFFF
	var t := _rng_state
	t = _imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


class Rng:
	var s := 0
	# own copy of _imul: an inner class must not name the outer class_name (that only
	# resolves inside a Godot project with the global class cache)
	static func _imul(a: int, b: int) -> int:
		a &= 0xFFFFFFFF
		b &= 0xFFFFFFFF
		var ah := (a >> 16) & 0xFFFF
		var al := a & 0xFFFF
		var bh := (b >> 16) & 0xFFFF
		var bl := b & 0xFFFF
		return ((al * bl) + ((((ah * bl) + (al * bh)) & 0xFFFF) << 16)) & 0xFFFFFFFF
	func _init(seed: int) -> void:
		s = seed & 0xFFFFFFFF
	func next() -> float:
		s = (s + 0x6D2B79F5) & 0xFFFFFFFF
		var t := s
		t = _imul(t ^ (t >> 15), t | 1)
		t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
		return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


# ---------------------------------------------------------------- helpers
static func _v(a) -> Vector3:
	return Vector3(a[0], a[1], a[2])


static func _smooth(a: float, b: float, x: float) -> float:
	var t := clampf((x - a) / (b - a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


static func _ease_out_back(u: float, c1: float) -> float:
	var c3 := c1 + 1.0
	return 1.0 + c3 * pow(u - 1.0, 3) + c1 * pow(u - 1.0, 2)


static func _axis_angle(axis: Vector3, ang: float) -> Quaternion:
	if axis.length() < 1e-9:
		return Quaternion.IDENTITY
	return Quaternion(axis.normalized(), ang)


static func _from_rotvec(v: Vector3) -> Quaternion:
	var a := v.length()
	return Quaternion.IDENTITY if a < 1e-9 else Quaternion(v / a, a)


static func _between(a: Vector3, b: Vector3) -> Quaternion:
	var d := a.dot(b)
	if d < -0.999999:
		var ax := Vector3(1, 0, 0).cross(a)
		if ax.length() < 1e-6:
			ax = Vector3(0, 1, 0).cross(a)
		return Quaternion(ax.normalized(), PI)
	var c := a.cross(b)
	return Quaternion(c.x, c.y, c.z, 1.0 + d).normalized()


static func _rand_dir(r: Callable) -> Vector3:
	return Vector3(r.call() - 0.5, r.call() - 0.5, r.call() - 0.5).normalized()


# ---------------------------------------------------------------- setup
func _init(piece_table: Dictionary, joint_provider: Callable, seed := 42, ground := Callable()) -> void:
	table = piece_table
	joint_fn = joint_provider
	ground_fn = ground if ground.is_valid() else func(_x, _z): return 0.0
	_rng_state = seed & 0xFFFFFFFF
	var i := 0
	for d in table["pieces"]:
		var hull: Array[Vector3] = []
		for h in d.get("hull", []):
			hull.append(_v(h))
		var s := {
			"i": i, "def": d, "name": d["name"],
			"c": _v(d["center"]), "n": _v(d["normal"]).normalized(),
			"hull": hull, "radius": float(d["radius"]),
			"mode": "locked", "t": 0.0, "p": Vector3.ZERO, "q": Quaternion.IDENTITY,
			"v": Vector3.ZERO, "w": Vector3.ZERO,
			"thrust": 0.0, "sub": 1.0, "avoid": Vector3.ZERO, "avoidV": Vector3.ZERO,
			"contact": 0.0, "still": 0.0,
		}
		pieces.append(s)
		by_name[s["name"]] = s
		i += 1


# ---------------------------------------------------------------- queries
func frame(name: String) -> Transform3D:
	var s: Dictionary = by_name[name]
	var q: Quaternion = s["q"]
	return Transform3D(Basis(q), s["p"] - q * s["c"])

func state(name: String) -> String: return by_name[name]["mode"]
func thrust(name: String) -> float: return by_name[name]["thrust"]
func sub(name: String) -> float: return by_name[name]["sub"]
func is_locked(name: String) -> bool: return by_name[name]["mode"] == "locked"

func all_locked() -> bool:
	for s in pieces:
		if s["mode"] != "locked" and s["mode"] != "hidden":
			return false
	return true

func reaction(joint: String) -> Vector3:
	return react[joint]["v"] if react.has(joint) else Vector3.ZERO

func reaction_joints() -> Array: return react.keys()

func drain_events() -> Array:
	var e := events
	events = []
	return e


# ---------------------------------------------------------------- sockets
func _joint(name: String) -> Dictionary:
	var t: Transform3D = joint_fn.call(name)
	return {"p": t.origin, "q": t.basis.get_rotation_quaternion().normalized()}

func _socket(s: Dictionary) -> Dictionary:
	var J := _joint(s["def"]["joint"])
	var q: Quaternion = J["q"]
	return {"c": J["p"] + q * s["c"], "q": q, "n": (q * s["n"]).normalized()}

func _emit(type: String, s, extra := {}) -> void:
	var e := {"type": type, "piece": s["name"] if s != null else null, "t": time,
		"pos": s["p"] if s != null else null}
	e.merge(extra, true)
	events.append(e)


# ---------------------------------------------------------------- state setters
func lock_all() -> void:
	for s in pieces:
		_lock(s, false)
	_all_locked_sent = true

func hide(names: Array) -> void:
	for n in names:
		by_name[n]["mode"] = "hidden"

func place(name: String, frame_xf: Transform3D, mode := "resting") -> void:
	var s: Dictionary = by_name[name]
	var q := frame_xf.basis.get_rotation_quaternion().normalized()
	s["q"] = q
	s["p"] = frame_xf.origin + q * s["c"]
	s["v"] = Vector3.ZERO; s["w"] = Vector3.ZERO; s["mode"] = mode; s["t"] = 0.0
	s["sub"] = 0.0; s["thrust"] = 0.0

func drop(name: String) -> void:
	var s: Dictionary = by_name[name]
	s["mode"] = "ballistic"; s["t"] = 0.0; s["contact"] = 0.0; s["still"] = 0.0

func _lock(s: Dictionary, with_event := true) -> void:
	var so := _socket(s)
	s["p"] = so["c"]; s["q"] = so["q"]; s["v"] = Vector3.ZERO; s["w"] = Vector3.ZERO
	s["mode"] = "locked"; s["sub"] = 1.0; s["thrust"] = 0.0
	s["avoid"] = Vector3.ZERO; s["avoidV"] = Vector3.ZERO
	if with_event:
		_emit("lock", s, {"size": s["radius"], "order": s["def"]["order"]})
		var rj = s["def"].get("react")
		if rj:
			var R := _joint(rj)
			var tq: Vector3 = (so["c"] - R["p"]).cross(-so["n"])
			if tq.length() > 1e-6:
				var kick: float = TUNE.reactKick + TUNE.reactKickPerM * s["radius"]
				if not react.has(rj):
					react[rj] = {"v": Vector3.ZERO, "w": Vector3.ZERO}
				react[rj]["w"] += tq.normalized() * kick * float(s["def"].get("reactScale", 1.0))

func eject(strength := 1.0, origin = null) -> void:
	var hub: Vector3 = origin if origin != null else _joint("piv_chest")["p"]
	_emit("eject", null, {"pos": hub, "strength": strength})
	for s in pieces:
		if s["mode"] != "locked":
			continue
		var so := _socket(s)
		s["p"] = so["c"]; s["q"] = so["q"]
		var out: Vector3 = so["c"] - hub
		out.y *= 0.3
		var lat := Vector3(_rand() - 0.5, 0, _rand() - 0.5) * 1.2
		s["v"] = so["n"] * ((2.0 + 1.6 * _rand()) * strength) \
			+ UP * ((1.3 + 1.5 * _rand()) * strength) \
			+ out.normalized() * (1.2 * strength) + lat
		s["w"] = Vector3(_rand() - 0.5, _rand() - 0.5, _rand() - 0.5).normalized() * ((3.0 + 6.0 * _rand()) * strength)
		s["mode"] = "ballistic"; s["t"] = -(so["c"] - hub).length() * 0.06
		s["sub"] = 0.0; s["thrust"] = 0.0; s["contact"] = 0.0; s["still"] = 0.0
		_emit("release", s)
	_all_locked_sent = false

func shed(name: String, push := 1.0) -> void:
	var s: Dictionary = by_name[name]
	if s["mode"] != "locked":
		return
	var so := _socket(s)
	s["p"] = so["c"]; s["q"] = so["q"]
	s["v"] = so["n"] * (1.2 * push) + UP * (0.6 * push)
	s["w"] = so["n"].cross(UP).normalized() * (2.5 * push)
	s["mode"] = "ballistic"; s["t"] = 0.0; s["sub"] = 0.0; s["contact"] = 0.0; s["still"] = 0.0
	_emit("shed", s)
	_all_locked_sent = false

func scatter(center := Vector3.ZERO, r_min := 1.2, r_max := 4.5, far_chance := 0.15, far_min := 7.0, far_max := 13.0, seed := -1) -> void:
	var R: Callable = _rand
	var g: Rng = null            # keep the seeded RNG alive for the whole loop (a Callable
	if seed >= 0:                # does not hold a strong reference to its RefCounted)
		g = Rng.new(seed)
		R = g.next
	for s in pieces:
		if s["mode"] == "hidden":
			continue
		var far: bool = R.call() < far_chance
		var a: float = R.call() * TAU
		var r: float = far_min + (far_max - far_min) * R.call() if far else r_min + (r_max - r_min) * sqrt(R.call())
		var yaw := Quaternion(UP, R.call() * TAU)
		var flip := -1.0 if R.call() < 0.35 else 1.0
		var q := (yaw * _between(s["n"] * flip, UP)).normalized()
		s["q"] = q
		var x := center.x + cos(a) * r
		var z := center.z + sin(a) * r
		s["p"] = Vector3(x, ground_fn.call(x, z) - _lowest(s, q) + 0.002, z)
		s["v"] = Vector3.ZERO; s["w"] = Vector3.ZERO; s["mode"] = "resting"; s["sub"] = 0.0; s["thrust"] = 0.0
	_all_locked_sent = false

func _lowest(s: Dictionary, q: Quaternion) -> float:
	var m := 0.0
	for h in s["hull"]:
		m = minf(m, (q * h).y)
	return m

func summon(names = null, delay := 0.0) -> int:
	var list: Array = []
	for s in pieces:
		if s["mode"] != "locked" and s["mode"] != "hidden" and (names == null or names.has(s["name"])):
			list.append(s)
	if list.is_empty():
		return 0
	var orders: Array = []
	for s in list:
		if not orders.has(s["def"]["order"]):
			orders.append(s["def"]["order"])
	orders.sort()
	var plan: Array = []
	var min_start := INF
	for s in list:
		var so := _socket(s)
		var dist: float = (so["c"] - s["p"]).length()
		var T := clampf(TUNE.flyBase + TUNE.flyPerSqrtM * sqrt(dist), TUNE.flyMin, TUNE.flyMax)
		var total: float = TUNE.wake + T + TUNE.approach + TUNE.hold + TUNE.clamp
		var rank := orders.find(s["def"]["order"])
		var lock_at: float = rank * TUNE.orderGap + (TUNE.faceplateGap if int(s["def"]["order"]) >= 9 else 0.0) + _rand() * TUNE.orderJitter
		plan.append({"s": s, "T": T, "total": total, "lockAt": lock_at, "dist": dist})
		min_start = minf(min_start, lock_at - total)
	var shift := time + delay - min_start
	for pl in plan:
		var s: Dictionary = pl["s"]
		s["mode"] = "queued"
		s["wakeAt"] = pl["lockAt"] - pl["total"] + shift
		s["T"] = pl["T"]; s["dist"] = pl["dist"]
		s["v"] = Vector3.ZERO; s["w"] = Vector3.ZERO
		s["lift"] = 0.30 + 0.30 * minf(pl["dist"], 5.0) / 5.0 + 0.10 * _rand()
		var side := Vector3(_rand() - 0.5, 0.2 * (_rand() - 0.5), _rand() - 0.5).normalized()
		s["swirl"] = side * (0.18 + 0.22 * _rand() + 0.05 * minf(pl["dist"], 6.0))
		s["tumbleAxis"] = Vector3(_rand() - 0.5, _rand() - 0.5, _rand() - 0.5).normalized()
		s["tumble"] = (0.35 + 0.5 * _rand()) * (1.0 if pl["dist"] > 0.6 else 0.3)
		s["clickAxis"] = Vector3(_rand() - 0.5, _rand() - 0.5, _rand() - 0.5).normalized()
		s["clickAng"] = deg_to_rad(5.0 + 5.0 * _rand())
		s["shakeAxis"] = Vector3(_rand() - 0.5, _rand() - 0.5, _rand() - 0.5).normalized()
	_all_locked_sent = false
	return plan.size()


# ---------------------------------------------------------------- simulation
func update(dt: float) -> void:
	var n := maxi(1, ceili(dt / (1.0 / 120.0)))
	for k in n:
		_step(dt / n)

func _step(dt: float) -> void:
	time += dt
	var c := 2.0 * TUNE.reactZeta * sqrt(TUNE.reactK)
	for j in react:
		var r: Dictionary = react[j]
		r["w"] += (r["v"] * -TUNE.reactK + r["w"] * -c) * dt
		r["v"] += r["w"] * dt
	var hips: Vector3 = _joint("piv_hips")["p"]
	var flying: Array = []
	for s in pieces:
		if s["mode"] == "fly":
			flying.append(s)
	var force := {}
	for s in flying:
		force[s["i"]] = Vector3.ZERO
	for a in flying.size():
		for b in range(a + 1, flying.size()):
			var A: Dictionary = flying[a]
			var B: Dictionary = flying[b]
			var d: Vector3 = A["p"] - B["p"]
			var L := d.length()
			var min_d := 0.8 * (minf(A["radius"], 0.28) + minf(B["radius"], 0.28))
			if L < min_d:
				var f := d.normalized() * (TUNE.avoidK * (min_d - L) / min_d)
				force[A["i"]] += f
				force[B["i"]] -= f
	for s in pieces:
		match s["mode"]:
			"locked":
				var so := _socket(s)
				s["p"] = so["c"]; s["q"] = so["q"]
			"queued":
				if time >= s["wakeAt"]:
					s["mode"] = "wake"; s["t"] = 0.0; s["S0"] = s["p"]; s["q0"] = s["q"]
					_emit("wake", s, {"size": s["radius"], "dist": s["dist"]})
			"wake": _wake(s, dt)
			"fly": _fly(s, dt, hips, force[s["i"]])
			"approach", "hold", "clamp": _final(s, dt)
			"ballistic": _ballistic(s, dt)
			"settle": _settle(s, dt)
	if not _all_locked_sent and all_locked():
		_all_locked_sent = true
		_emit("allLocked", null)

func _wake(s: Dictionary, dt: float) -> void:
	s["t"] += dt
	var u := clampf(s["t"] / TUNE.wake, 0.0, 1.0)
	var hop := _smooth(0.0, 0.22, u) * 1.25 if u < 0.22 else 1.25 - 0.25 * _smooth(0.22, 1.0, u)
	s["p"] = s["S0"] + UP * (TUNE.hop * hop)
	var shake := sin(u * PI * 5.0) * (1.0 - u) * 0.14
	s["q"] = (_axis_angle(s["shakeAxis"], shake) * s["q0"]).normalized()
	s["thrust"] = 1.0 if u < 0.15 else 1.0 - 0.6 * _smooth(0.15, 1.0, u)
	s["sub"] = 0.0
	if u >= 1.0:
		s["mode"] = "fly"; s["t"] = 0.0
		s["P0"] = s["p"]
		s["P1"] = s["P0"] + UP * s["lift"] + s["swirl"]
		s["qStart"] = s["q"]
		var so := _socket(s)
		s["qCruise"] = (s["qStart"].slerp(so["q"], 0.45) * _axis_angle(s["tumbleAxis"], s["tumble"])).normalized()
		_emit("fly", s, {"duration": s["T"], "dist": s["dist"], "size": s["radius"]})

func _fly(s: Dictionary, dt: float, hips: Vector3, f: Vector3) -> void:
	s["t"] += dt
	var tau := clampf(s["t"] / s["T"], 0.0, 1.0)
	var m1 := 0.8
	var sp := -2.0 * pow(tau, 3) + 3.0 * tau * tau + m1 * (pow(tau, 3) - tau * tau)
	var so := _socket(s)
	var A: Vector3 = so["c"] + so["n"] * TUNE.approachDist
	var k2 := clampf(0.25 + 0.12 * s["dist"], 0.25, 0.9)
	var P2: Vector3 = A + so["n"] * k2
	var u := sp
	var iu := 1.0 - u
	var p: Vector3 = s["P0"] * (iu * iu * iu) + s["P1"] * (3.0 * iu * iu * u) + P2 * (3.0 * iu * u * u) + A * (u * u * u)
	var wKO := 1.0 - _smooth(0.72, 1.0, u)
	if wKO > 0.0:
		var ay := clampf(p.y, hips.y - 0.95, hips.y + 0.80)
		var rad := Vector3(p.x - hips.x, p.y - ay, p.z - hips.z)
		var L := rad.length()
		var dir: Vector3 = rad / L if L > 1e-4 else so["n"]
		var R: float = TUNE.keepOutR
		var kk: float = TUNE.keepOutSoft
		var push := kk * log(1.0 + exp((R - L) / kk))
		p += dir * (push * wKO)
	s["avoidV"] += (f - s["avoid"] * TUNE.avoidSpring - s["avoidV"] * TUNE.avoidDamp) * dt
	s["avoid"] += s["avoidV"] * dt
	p += s["avoid"] * (1.0 - _smooth(0.7, 1.0, u))
	s["p"] = p
	var g: float = s["t"] / (s["T"] + TUNE.approach)
	var qa: Quaternion = s["qStart"].slerp(s["qCruise"], _smooth(0.0, 0.55, tau))
	var qT: Quaternion = (so["q"] * _axis_angle(s["clickAxis"], s["clickAng"])).normalized()
	s["q"] = qa.slerp(qT, _smooth(2.0 / 3.0, 1.0, g))
	s["qFly"] = qa
	s["thrust"] = 0.45 + 0.15 * sin(time * 37.0 + s["i"]) + 0.25 * (1.0 - _smooth(0.0, 0.3, tau))
	if tau >= 1.0:
		s["mode"] = "approach"; s["t"] = 0.0
		_emit("approach", s, {"size": s["radius"]})

func _final(s: Dictionary, dt: float) -> void:
	s["t"] += dt
	var so := _socket(s)
	var q_click: Quaternion = (so["q"] * _axis_angle(s["clickAxis"], s["clickAng"])).normalized()
	var d: float
	var q: Quaternion
	if s["mode"] == "approach":
		var u := clampf(s["t"] / TUNE.approach, 0.0, 1.0)
		var e := _ease_out_back(u, TUNE.overshoot)
		d = TUNE.preLock + (TUNE.approachDist - TUNE.preLock) * (1.0 - e)
		var g: float = (s["T"] + s["t"]) / (s["T"] + TUNE.approach)
		q = s["qFly"].slerp(q_click, _smooth(2.0 / 3.0, 1.0, g))
		s["thrust"] = 0.9 * (1.0 - u) + 0.3
		if u >= 1.0:
			s["mode"] = "hold"; s["t"] = 0.0
	elif s["mode"] == "hold":
		d = TUNE.preLock; q = q_click
		s["thrust"] = 0.3
		if s["t"] >= TUNE.hold:
			s["mode"] = "clamp"; s["t"] = 0.0
			_emit("clamp", s, {"size": s["radius"]})
	else:
		var u := clampf(s["t"] / TUNE.clamp, 0.0, 1.0)
		var e := u * u
		d = TUNE.preLock * (1.0 - e)
		q = q_click.slerp(so["q"], e)
		s["sub"] = e
		s["thrust"] = 0.0
		if u >= 1.0:
			_lock(s, true)
			return
	s["p"] = so["c"] + so["n"] * maxf(d, 0.0)
	s["q"] = q

func _ballistic(s: Dictionary, dt: float) -> void:
	s["t"] += dt
	if s["t"] < 0.0:
		return
	var v: Vector3 = s["v"]
	v.y -= TUNE.gravity * dt
	v *= (1.0 - 0.08 * dt)
	s["v"] = v
	s["p"] += v * dt
	s["q"] = (_from_rotvec(s["w"] * dt) * s["q"]).normalized()
	var low = null
	var low_y := INF
	for h in s["hull"]:
		var w: Vector3 = s["p"] + s["q"] * h
		var gy: float = ground_fn.call(w.x, w.z)
		if w.y - gy < low_y:
			low_y = w.y - gy
			low = w
	if low != null and low_y < 0.0:
		s["p"].y -= low_y
		if s["v"].y < 0.0:
			var vi: float = -s["v"].y
			s["v"].y = vi * TUNE.restitution if vi > 0.9 else 0.0
			s["v"].x *= TUNE.friction; s["v"].z *= TUNE.friction
			var r: Vector3 = low - s["p"]
			s["w"] = s["w"] * 0.55 + r.cross(UP) * (-vi * 2.2)
			if vi > 0.45:
				_emit("bounce", s, {"speed": vi, "size": s["radius"]})
		s["contact"] = 0.12
	if s["contact"] > 0.0:
		s["contact"] -= dt
		s["v"].x *= maxf(0.0, 1.0 - 5.0 * dt); s["v"].z *= maxf(0.0, 1.0 - 5.0 * dt)
		s["w"] *= maxf(0.0, 1.0 - 4.0 * dt)
		if s["v"].length() < 0.25 and s["w"].length() < 1.2:
			s["still"] += dt
		else:
			s["still"] = 0.0
		if s["still"] > 0.12:
			s["mode"] = "settle"; s["t"] = 0.0; s["qFrom"] = s["q"]; s["pFrom"] = s["p"]
			var nd: Vector3 = s["q"] * s["n"]
			var up := nd if nd.y >= 0.0 else -nd
			s["qRest"] = (_between(up.normalized(), UP) * s["q"]).normalized()

func _settle(s: Dictionary, dt: float) -> void:
	s["t"] += dt
	var u := _smooth(0.0, 1.0, s["t"] / TUNE.settleTime)
	s["q"] = s["qFrom"].slerp(s["qRest"], u)
	var pf: Vector3 = s["pFrom"]
	var y: float = ground_fn.call(pf.x, pf.z) - _lowest(s, s["q"]) + 0.002
	s["p"] = Vector3(pf.x, pf.y + (y - pf.y) * u, pf.z)
	if s["t"] >= TUNE.settleTime:
		s["mode"] = "resting"
		_emit("rest", s)
