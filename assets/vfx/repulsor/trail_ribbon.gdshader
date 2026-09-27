// Contrail ribbon (boots: condensation; palms: thin additive vortex lines).
// Vertex COLOR.a carries AGE 0..1 along the ribbon (0 = at the emitter); UV.y across the width.
// Port of showroom/js/vfx.js TRAIL_FS. Mesh is rebuilt each frame by ribbon_trail.gd.
shader_type spatial;
render_mode unshaded, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec3 color : source_color = vec3(0.95, 0.965, 1.0);
uniform vec3 hot : source_color = vec3(0.84, 0.92, 1.0);
uniform float opacity = 1.0;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

void fragment() {
	float age = COLOR.a;
	float edge = smoothstep(0.0, 0.9, 1.0 - abs(UV.y * 2.0 - 1.0));
	float n = fbm(vec2(UV.x * 3.0 - TIME * 0.3, UV.y * 2.5 + UV.x));
	float fade = (1.0 - age) * (1.0 - age);
	ALBEDO = mix(hot, color, smoothstep(0.0, 0.12, age));
	ALPHA = clamp(edge * fade * (0.45 + 0.75 * n) * smoothstep(0.0, 0.04, age) * opacity, 0.0, 1.0);
}
