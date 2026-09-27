// The thrown web glob (and the flying tip of a line) — port of GLOB_VS/FS in web.three.js.
// Opaque, lit by the same key-light uniforms as the strands: wrap diffuse, cool "subsurface" in
// shadow, light bleeding through the thin rim, a tight wet highlight and a fresnel sheen.
// COLOR.r = cavity (0 in crevices between lumps, 1 on bumps).
shader_type spatial;
render_mode unshaded, cull_back, shadows_disabled;

uniform vec3 light_dir = vec3(-0.45, 0.8, -0.4);
uniform vec3 light_col = vec3(1.0, 0.97, 0.92);
uniform vec3 ambient = vec3(0.30, 0.33, 0.40);
uniform vec3 silk = vec3(0.93, 0.95, 1.0);

varying float v_cav;

void vertex() {
	v_cav = COLOR.r;
}

void fragment() {
	vec3 N = normalize(NORMAL);
	vec3 V = VIEW;
	vec3 L = normalize((VIEW_MATRIX * vec4(light_dir, 0.0)).xyz);
	float wrap = clamp((dot(N, L) + 0.55) / 1.55, 0.0, 1.0);
	float ndv = clamp(dot(N, V), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 3.0);
	vec3 H = normalize(L + V);
	float ndh = clamp(dot(N, H), 0.0, 1.0);
	float spec = pow(ndh, 140.0) * 3.0 + pow(ndh, 22.0) * 0.22;
	float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * (0.35 + 0.65 * fres);
	vec3 sss = mix(vec3(0.60, 0.68, 0.84), vec3(1.0), wrap);
	vec3 col = silk * sss * (ambient + light_col * wrap * 0.68) * (0.80 + 0.20 * v_cav);
	col += light_col * (trans * 0.45 + spec);
	col += vec3(0.88, 0.94, 1.0) * fres * 0.35;
	ALBEDO = col + 0.10;
}
