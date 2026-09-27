// Thruster plume layer (boots, palms, back vents). Port of showroom/js/vfx.js PLUME_FS.
// Use on an open CylinderMesh whose top is at the nozzle and which extends along the emitter's
// -Y (translate the mesh so y in [-len, 0]). Stack three: core (layer 0, narrow, short),
// sheath and outer (layer 1). Drive `thrust` 0..1.4 from the flight model every frame and
// scale the mesh length with it (see thruster_plume.gd).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

uniform float thrust = 0.0;
uniform float seed = 0.0;
uniform float layer = 0.0;          // 0 = core (with Mach diamonds), 1 = sheath/outer
uniform vec3 hot : source_color = vec3(1.0);
uniform vec3 mid : source_color = vec3(0.55, 0.82, 1.0);   // flame style: (1.0, 0.55, 0.12)
uniform vec3 cool : source_color = vec3(0.12, 0.32, 1.0);  // flame style: (0.5, 0.12, 0.02)

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

void fragment() {
	float v = UV.y;                              // Godot cylinder: UV.y 0 at top (nozzle) -> 1 at bottom (tip)
	float rim = abs(dot(NORMAL, VIEW));
	float soft = pow(rim, layer < 0.5 ? 1.2 : 2.2);
	float n = fbm(vec2(UV.x * 6.0 + seed, v * 4.0 - TIME * 9.0));
	float n2 = fbm(vec2(UV.x * 11.0 - seed, v * 9.0 - TIME * 15.0));
	float len = smoothstep(1.0, 0.15 + 0.35 * n, v);
	float diamonds = pow(0.5 + 0.5 * cos(v * 38.0 - TIME * 2.0), 10.0) * smoothstep(0.65, 0.05, v) * step(layer, 0.5);
	float a = soft * len * (0.55 + 0.6 * n2) * thrust;
	vec3 col = mix(hot, mid, smoothstep(0.0, 0.35, v));
	col = mix(col, cool, smoothstep(0.3, 0.95, v));
	col += hot * diamonds * 1.8;
	a *= layer < 0.5 ? 1.25 : 0.55;
	ALBEDO = col * a * 2.2;
	ALPHA = clamp(a, 0.0, 1.0);
}
