// Silk strands for WebFX (Godot 4.6) — port of STRAND_VS/STRAND_FS in web.three.js.
// Every camera-facing strand of the frame (lines, glob trails, tracers, fibre bursts, rings) is in
// ONE ImmediateMesh drawn with this shader. Vertex layout (TRIANGLE_STRIP, 2 vertices per point
// sharing the strand centre; the shader pushes them apart toward the camera):
//   VERTEX = strand centre (world, the MeshInstance is top_level)   NORMAL = strand tangent
//   UV     = (side -1|+1, arc length in m)                          UV2    = (half width m, min width px)
//   COLOR  = (alpha, bright 0..1, glow 0..1, seed 0..1)
// glow = 1 marks the halo: a fixed-pixel additive sheath that keeps far webs readable.
shader_type spatial;
render_mode unshaded, blend_premul_alpha, depth_draw_never, cull_disabled, skip_vertex_transform, shadows_disabled, fog_disabled;

// Direction TOWARD the key light (world), its colour, the ambient, the silk albedo. WebFX sets these.
uniform vec3 light_dir = vec3(-0.45, 0.8, -0.4);
uniform vec3 light_col = vec3(1.0, 0.97, 0.92);
uniform vec3 ambient = vec3(0.30, 0.33, 0.40);
uniform vec3 silk = vec3(0.93, 0.95, 1.0);

varying vec3 v_tan;
varying vec4 v_a;   // side, arc, alpha, width in px
varying vec4 v_b;   // bright, glow, seed

float wh11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }

// Kajiya-Kay silk: tangent-lit diffuse + specular, pearly thin-film tint, glints that flare
// when the view runs along the fibre. Kept just under a ~0.9 bloom threshold except highlights.
vec3 silk_shade(vec3 T, vec3 V, vec3 L, float s, float bright, float arc, float seed, float time) {
	float TL = dot(T, L);
	vec3 H = normalize(L + V);
	float TH = dot(T, H);
	float sinTL = sqrt(max(0.0, 1.0 - TL * TL));
	float sinTH = sqrt(max(0.0, 1.0 - TH * TH));
	float cyl = sqrt(max(0.0, 1.0 - s * s));
	vec3 base = silk * (ambient + light_col * (0.20 + 0.46 * sinTL));
	base *= (0.74 + 0.26 * cyl) * (1.0 + bright * cyl * cyl * 0.18);
	float spec = pow(sinTH, 110.0) * 1.2 + pow(sinTH, 14.0) * 0.10;
	vec3 irid = 0.5 + 0.5 * cos(6.2831 * (TH * 1.4 + seed * 0.37 + vec3(0.0, 0.33, 0.67)));
	vec3 hi = mix(vec3(1.0), irid, 0.5) * spec * light_col;
	float along = abs(dot(T, V));
	float cell = floor(arc * 34.0 + seed * 97.0);
	float g = step(0.955, wh11(cell)) * pow(sinTH, 30.0) * step(bright, 0.9) * step(0.0, bright);
	float tw = 0.55 + 0.45 * sin(time * 21.0 + cell * 1.93);
	vec3 glint = vec3(1.0, 0.98, 0.95) * g * tw * (0.3 + 1.1 * smoothstep(0.5, 0.97, along)) * cyl;
	vec3 col = base + hi + glint;
	col *= 1.0 + 0.30 * smoothstep(0.75, 1.0, along);
	return col;
}

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 t = normalize((MODELVIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	float side = UV.x;
	float hw = UV2.x;
	float alpha = COLOR.r;
	float bright = COLOR.g;
	float glow = COLOR.b;
	float dist = max(length(c), 1e-5);
	vec3 sd = cross(t, -c / dist);
	float sl = length(sd);
	sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
	// size of one pixel at this depth: below min width the ribbon is held at min width and its
	// alpha drops by the coverage it lost (never below a floor) — a far web stays a crisp line
	bool ortho = PROJECTION_MATRIX[2][3] == 0.0;
	float px = 2.0 * (ortho ? 1.0 : max(-c.z, 1e-3)) / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y);
	float min_hw = 0.5 * UV2.y * px;
	if (glow > 0.99) {
		hw = min_hw;
		alpha *= smoothstep(1.5, 7.0, dist);
	} else if (hw < min_hw) {
		alpha *= max(hw / min_hw, bright * bright * 0.7);
		hw = min_hw;
	}
	alpha *= smoothstep(0.04, 0.18, dist);
	VERTEX = c + sd * side * hw;
	NORMAL = -c / dist;
	v_tan = t;
	v_a = vec4(side, UV.y, alpha, 2.0 * hw / px);
	v_b = vec4(bright, glow, COLOR.a, 0.0);
}

void fragment() {
	float s = v_a.x;
	float prof = clamp(1.0 - s * s, 0.0, 1.0);
	prof = v_b.y > 0.99 ? prof * prof * prof : prof * prof;
	// a ribbon only 1-2 px wide cannot show a profile (it would dash along its length)
	prof = mix(0.75, prof, smoothstep(1.6, 4.0, v_a.w));
	float a = v_a.z * prof;
	if (a < 0.002) {
		discard;
	}
	vec3 L = normalize((VIEW_MATRIX * vec4(light_dir, 0.0)).xyz);
	vec3 col = silk_shade(normalize(v_tan), VIEW, L, s, v_b.x, v_a.y, v_b.z, TIME);
	// premultiplied: glow 0 = ordinary "over", glow 1 = purely additive
	ALBEDO = col * a;
	ALPHA = a * (1.0 - v_b.y);
}
