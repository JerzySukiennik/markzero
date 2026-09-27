// Impact web splat for WebFX (Godot 4.6) — port of SPLAT_VS/SPLAT_FS in web.three.js.
// ONE mesh, ONE draw call, four primitive kinds told apart by CUSTOM1.y:
//   0 strand (camera-facing, like the line; CUSTOM1.x < 0 = the strand's own soft shadow)
//   1 contact shadow   2 wet glob   3 web film (radial streaks)
// Mesh space: +Y = surface normal, baked at radius 1 (the node is scaled to the splat size).
//   NORMAL  = strand tangent (kind 0) or surface normal (kinds 1-3)
//   CUSTOM0 = (side|u, arc|v|cavity|lift, alpha, half width m)   CUSTOM1 = (bright, kind, r01, seed)
// Burst, membrane bounce, strand shadows, the bend round a body and the dissolve all happen here,
// driven by per-instance uniforms (no material per splat).
shader_type spatial;
render_mode unshaded, blend_premul_alpha, depth_draw_never, cull_disabled, skip_vertex_transform, shadows_disabled, fog_disabled;

uniform vec3 light_dir = vec3(-0.45, 0.8, -0.4);
uniform vec3 light_col = vec3(1.0, 0.97, 0.92);
uniform vec3 ambient = vec3(0.30, 0.33, 0.40);
uniform vec3 silk = vec3(0.93, 0.95, 1.0);

instance uniform float u_age = 0.0;     // seconds since the stamp
instance uniform float u_fade = 1.0;    // 1 → 0 over the last splatFadeTail seconds
instance uniform float u_curve = 0.0;   // bend radius in MESH units (0 = flat wall)
instance uniform float u_width = 1.0;   // strand width multiplier (tracks the splat size)

varying vec3 v_tan;
varying vec4 v_a;   // side|u, arc|v|cavity, alpha, width px
varying vec4 v_b;   // bright, kind, r01, seed

float wh11(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
float vn1c(float u, float k) {
	float x = u * k;
	float i = floor(x);
	float f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(wh11(mod(i, k)), wh11(mod(i + 1.0, k)), f);
}

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

vec3 glob_shade(vec3 N, vec3 V, vec3 L, float cavity) {
	float ndl = dot(N, L);
	float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
	float ndv = clamp(dot(N, V), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 3.0);
	vec3 H = normalize(L + V);
	float ndh = clamp(dot(N, H), 0.0, 1.0);
	float spec = pow(ndh, 140.0) * 3.0 + pow(ndh, 22.0) * 0.22;
	float trans = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * (0.35 + 0.65 * fres);
	vec3 sss = mix(vec3(0.60, 0.68, 0.84), vec3(1.0), wrap);
	vec3 col = silk * sss * (ambient + light_col * wrap * 0.68) * (0.80 + 0.20 * cavity);
	col += light_col * (trans * 0.45 + spec);
	col += vec3(0.88, 0.94, 1.0) * fres * 0.35;
	return col;
}

void vertex() {
	vec4 A = CUSTOM0;
	vec4 B = CUSTOM1;
	float kind = B.y;
	float t = max(u_age - B.z * 0.035, 0.0);
	float g = 1.0 - exp(-t * 24.0) * cos(t * 30.0);                 // burst: ~50 ms out, ~9 % overshoot
	float bounce = 1.0 + 0.9 * exp(-u_age * 7.0) * sin(u_age * 38.0 + B.w * 6.0);
	vec3 p = VERTEX;
	vec3 n = NORMAL;
	float alpha = A.z;
	if (kind < 0.5 && B.x < -0.5) {
		// the strand's shadow: slid along the surface away from the light by its lift (A.y)
		vec3 lo = normalize(transpose(mat3(MODEL_MATRIX)) * light_dir);
		if (lo.y > 0.08) {
			p.xz += clamp(-lo.xz / max(lo.y, 0.3), vec2(-3.0), vec2(3.0)) * 1.6 * A.y;
		} else {
			alpha = 0.0;
		}
	}
	p.xz *= g;
	p.y *= (kind > 1.5 && kind < 2.5) ? g * (1.0 + 0.35 * exp(-u_age * 9.0) * sin(u_age * 40.0)) : bounce * min(g, 1.0);
	if (u_curve > 0.0) {
		// wrap round a vertical cylinder (a body): x becomes an angle
		float th = p.x / u_curve;
		float cs = cos(th);
		float sn = sin(th);
		p = vec3(sn * (u_curve + p.y), cs * (u_curve + p.y) - u_curve, p.z);
		n = vec3(n.x * cs + n.y * sn, -n.x * sn + n.y * cs, n.z);
	}
	// dissolve: every strand has its own moment to vanish while the splat fades
	alpha *= smoothstep(B.w * 0.7, B.w * 0.7 + 0.3, u_fade);
	vec3 c = (MODELVIEW_MATRIX * vec4(p, 1.0)).xyz;
	vec3 tv = normalize((MODELVIEW_MATRIX * vec4(n, 0.0)).xyz);
	float dist = max(length(c), 1e-5);
	float pxw = 4.0;
	if (kind < 0.5) {
		vec3 sd = cross(tv, -c / dist);
		float sl = length(sd);
		sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
		bool ortho = PROJECTION_MATRIX[2][3] == 0.0;
		float px = 2.0 * (ortho ? 1.0 : max(-c.z, 1e-3)) / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y);
		float hw = A.w * u_width;
		float min_hw = 0.7 * px;           // 1.4 px minimum width
		float floor_a = B.x > 0.0 ? 0.25 + 0.4 * B.x : 0.0;
		if (hw < min_hw) {
			alpha *= max(hw / min_hw, floor_a);
			hw = min_hw;
		}
		alpha *= smoothstep(0.04, 0.18, dist);
		pxw = 2.0 * hw / px;
		c += sd * A.x * hw;
	} else if (kind > 2.5) {
		// far away the strands go sub-pixel: the film fills in so the splat still reads as a patch
		alpha *= mix(1.0, 2.2, smoothstep(5.0, 25.0, dist));
	}
	c *= 0.9985;     // depth bias toward the eye: same pixel, no z-fighting with the wall
	VERTEX = c;
	NORMAL = tv;
	v_tan = tv;
	v_a = vec4(A.x, A.y, alpha, pxw);
	v_b = B;
}

void fragment() {
	float kind = v_b.y;
	vec3 V = VIEW;
	vec3 L = normalize((VIEW_MATRIX * vec4(light_dir, 0.0)).xyz);
	float flash = 1.0 + 1.0 * exp(-u_age * 25.0);
	vec3 col = vec3(0.0);
	float a = 0.0;
	float glow = 0.0;
	float thin = smoothstep(1.6, 4.0, v_a.w);
	if (kind < 0.5 && v_b.x < -0.5) {
		float s = v_a.x;
		a = v_a.z * mix(0.7, clamp(1.0 - s * s, 0.0, 1.0), thin) * 0.42 * u_fade;
	} else if (kind < 0.5) {
		float s = v_a.x;
		float prof = clamp(1.0 - s * s, 0.0, 1.0);
		a = v_a.z * mix(0.75, prof * prof, thin);
		col = silk_shade(normalize(v_tan), V, L, s, v_b.x, v_a.y, v_b.w, TIME) * flash;
		glow = 0.10;
	} else if (kind < 1.5) {
		float r = length(v_a.xy);
		a = 0.5 * exp(-r * r * 3.4) * v_a.z * u_fade;
	} else if (kind < 2.5) {
		if (!FRONT_FACING) {
			discard;      // no depth write: cull the far side of the glob by hand
		}
		a = v_a.z * u_fade;
		col = glob_shade(normalize(v_tan), V, L, v_a.y) * flash + 0.08;
	} else {
		float r = length(v_a.xy);
		float ang = atan(v_a.y, v_a.x) / 6.2831 + 0.5;
		float st = vn1c(ang, 23.0) * 0.55 + vn1c(ang, 61.0) * 0.45;
		st = smoothstep(0.45, 0.95, st);
		a = v_a.z * smoothstep(1.0, 0.25, r) * (0.10 + 0.90 * st) * u_fade;
		float ndl = clamp(dot(normalize(v_tan), L) * 0.5 + 0.5, 0.0, 1.0);
		col = silk * (ambient + light_col * (0.35 + 0.65 * ndl)) * (0.85 + 0.5 * st) * flash;
	}
	if (a < 0.002) {
		discard;
	}
	ALBEDO = col * a;
	ALPHA = a * (1.0 - glow);
}
