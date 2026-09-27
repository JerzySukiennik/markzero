// Mark Zero NEXT — nanotech reveal shader, Godot 4.x spatial.
// Same inputs and the same look as nano.three.js (the reference is that file + NOTES.md).
//
// Replaces a glTF-imported StandardMaterial3D on any mesh that has UV2 (= glTF TEXCOORD_1,
// Blender UV map "NanoUV"): UV2.x = arrival time 0..1, UV2.y = per-plate seed.
//   nano  : 0..1  fragment exists when UV2.x < nano       (feed from drv_nano.position.x)
//   paint : 0..1  fragment is painted when UV2.x < paint   (feed from drv_paint.position.x)
// Use nano_apply.gd to swap materials and feed the drivers automatically.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// ---- the original PBR material (copied from the imported StandardMaterial3D) ----------
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float metallic : hint_range(0.0, 1.0) = 1.0;
uniform float roughness : hint_range(0.0, 1.0) = 1.0;
// glTF metallicRoughness packing: G = roughness, B = metallic (Godot imports it as one image)
uniform sampler2D metallic_roughness_texture : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_normal_texture = false;
uniform sampler2D normal_texture : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float normal_scale = 1.0;
uniform vec4 emission_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform sampler2D emission_texture : source_color, hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float emission_energy = 1.0;
uniform bool has_occlusion_texture = false;
uniform sampler2D occlusion_texture : hint_default_white, filter_linear_mipmap, repeat_enable;

// ---- nano ---------------------------------------------------------------------------
uniform float nano : hint_range(0.0, 1.0) = 1.0;
uniform float paint : hint_range(0.0, 1.0) = 1.0;
uniform float nano_edge = 0.045;          // width of the glowing band (u units)
uniform float paint_edge = 0.06;          // softness of the paint front (u units)
uniform float cell_scale = 55.0;          // cells per metre, object space
uniform float thickness = 0.018;          // metres the shell is pulled towards the skin at the front
uniform float grow_width = 0.07;          // u-distance to full thickness
uniform vec3 edge_color : source_color = vec3(0.498, 0.902, 1.0);   // 0x7fe6ff
uniform vec3 edge_color2 : source_color = vec3(1.0, 0.702, 0.278);  // 0xffb347
uniform vec3 liquid_color : source_color = vec3(0.553, 0.580, 0.612); // 0x8d949c
uniform float nano_emissive = 6.0;
uniform float ripple = 0.0025;

varying vec3 v_local;
varying vec2 v_nano;

vec3 nano_hash3(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}

vec2 nano_cells(vec3 p, out float cid) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	float d1 = 8.0;
	float d2 = 8.0;
	cid = 0.0;
	for (int z = -1; z <= 1; z++) {
		for (int y = -1; y <= 1; y++) {
			for (int x = -1; x <= 1; x++) {
				vec3 g = vec3(float(x), float(y), float(z));
				vec3 h = nano_hash3(i + g);
				vec3 r = g + 0.18 + h * 0.64 - f;
				float d = dot(r, r);
				if (d < d1) {
					d2 = d1;
					d1 = d;
					cid = h.x + h.y * 7.13 + h.z * 3.71;
				} else if (d < d2) {
					d2 = d;
				}
			}
		}
	}
	return vec2(sqrt(d1), sqrt(d2));
}

void vertex() {
	v_nano = UV2;
	v_local = VERTEX;
	float lead = nano - UV2.x;
	float grow = (1.0 - smoothstep(0.0, grow_width, lead)) * step(nano, 0.9999);
	float rip = sin(TIME * 17.0 + UV2.y * 43.0 + VERTEX.y * 60.0) * ripple;
	VERTEX += NORMAL * (-thickness * grow + rip * grow);
}

void fragment() {
	float cid;
	vec2 F = nano_cells(v_local * cell_scale + v_nano.y * 17.0, cid);
	float cr = fract(cid * 13.37);
	float lead = nano - v_nano.x + (cr - 0.5) * nano_edge * 0.9;
	if ((nano < 0.9999 && lead < 0.0) || nano <= 0.0001) {
		discard;
	}
	float band = (1.0 - smoothstep(0.0, nano_edge, lead)) * step(nano, 0.9999);
	float line = 1.0 - smoothstep(0.02, 0.10, F.y - F.x);
	float pl = paint - v_nano.x + (cr - 0.5) * paint_edge * 0.7;
	float painted = paint >= 0.9999 ? 1.0 : smoothstep(0.0, paint_edge, pl);
	float pband = (1.0 - smoothstep(0.0, paint_edge, abs(pl))) * step(paint, 0.9999) * step(0.0001, paint);

	vec4 alb = texture(albedo_texture, UV) * albedo_color;
	vec4 mr = texture(metallic_roughness_texture, UV);
	ALBEDO = mix(liquid_color * (1.0 - 0.35 * line), alb.rgb, painted);
	METALLIC = mix(1.0, metallic * mr.b, painted);
	ROUGHNESS = mix(0.14 + 0.18 * line, roughness * mr.g, painted);
	if (has_normal_texture) {
		NORMAL_MAP = texture(normal_texture, UV).rgb;
		NORMAL_MAP_DEPTH = normal_scale;
	}
	if (has_occlusion_texture) {
		AO = texture(occlusion_texture, UV).r;
		AO_LIGHT_AFFECT = 0.0;
	}
	vec3 emit = emission_color.rgb * texture(emission_texture, UV).rgb * emission_energy;
	emit *= mix(0.25, 1.0, painted);
	vec3 hot = mix(edge_color, edge_color2, smoothstep(0.35, 1.0, 1.0 - band));
	emit += hot * band * (0.25 + 0.95 * line) * nano_emissive;
	emit += edge_color2 * pband * (0.15 + 0.6 * line) * nano_emissive * 0.35;
	EMISSION = emit;
}
