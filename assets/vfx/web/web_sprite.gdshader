// Camera-facing flares and puffs for WebFX — port of SPRITE_VS/FS in web.three.js.
// Drawn from one MultiMesh (QuadMesh 2x2): instance COLOR = rgb + alpha,
// INSTANCE_CUSTOM = (size m, rotation rad, kind 0 glow | 1 puff | 2 star, additive 0..1).
shader_type spatial;
render_mode unshaded, blend_premul_alpha, depth_draw_never, cull_disabled, skip_vertex_transform, shadows_disabled, fog_disabled;

varying vec2 v_uv;
varying vec4 v_col;
varying vec2 v_k;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float cs = cos(INSTANCE_CUSTOM.y);
	float sn = sin(INSTANCE_CUSTOM.y);
	v_uv = VERTEX.xy;
	vec2 q = vec2(cs * VERTEX.x - sn * VERTEX.y, sn * VERTEX.x + cs * VERTEX.y);
	VERTEX = c + vec3(q * INSTANCE_CUSTOM.x, 0.0);
	v_col = COLOR;
	v_k = INSTANCE_CUSTOM.zw;
}

void fragment() {
	float r2 = dot(v_uv, v_uv);
	float a;
	if (v_k.x < 0.5) {
		a = exp(-r2 * 7.0) + 0.35 * exp(-r2 * 45.0);
	} else if (v_k.x < 1.5) {
		float ang = atan(v_uv.y, v_uv.x);
		float lump = 0.75 + 0.25 * sin(ang * 5.0 + v_col.a * 9.0) * sin(ang * 3.0 - 1.7);
		a = smoothstep(1.0, 0.25, sqrt(r2) / lump) * 0.8;
	} else {
		vec2 u = abs(v_uv);
		a = exp(-r2 * 10.0) + 0.8 * exp(-u.x * 28.0) * exp(-u.y * 2.2) + 0.8 * exp(-u.y * 28.0) * exp(-u.x * 2.2);
	}
	a *= clamp(v_col.a, 0.0, 1.0) * step(r2, 1.0);
	if (a < 0.002) {
		discard;
	}
	ALBEDO = v_col.rgb * a;
	ALPHA = a * (1.0 - v_k.y);
}
