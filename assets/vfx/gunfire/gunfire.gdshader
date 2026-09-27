// Gunfire sprite shader (Godot 4.x): camera-facing (or axis-aligned) textured quad, additive or alpha.
// Additive by default; used by gunfire.gd for muzzle flashes, smoke, fire, sparks, tracers, shockwave rings and scorch decals.
shader_type spatial;
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;
// gunfire.gd derives the smoke variant by replacing blend_add with blend_mix

uniform sampler2D tex : source_color, filter_linear_mipmap;
uniform vec4 tint : source_color = vec4(1.0);
uniform float opacity = 1.0;
uniform int billboard = 1;          // 0 = none (world quad), 1 = full billboard, 2 = axis billboard along local X
uniform float rotation = 0.0;

void vertex() {
	if (billboard == 1) {
		float c = cos(rotation), s = sin(rotation);
		vec2 v = mat2(vec2(c, s), vec2(-s, c)) * VERTEX.xy;
		vec3 scale = vec3(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz), 1.0);
		MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
		VERTEX = vec3(v * scale.xy, 0.0);
	} else if (billboard == 2) {
		vec3 axis = normalize(MODEL_MATRIX[0].xyz);
		vec3 origin = MODEL_MATRIX[3].xyz;
		vec3 to_cam = normalize(INV_VIEW_MATRIX[3].xyz - origin);
		vec3 side = normalize(cross(axis, to_cam));
		vec3 world = origin + axis * VERTEX.x * length(MODEL_MATRIX[0].xyz) + side * VERTEX.y * length(MODEL_MATRIX[1].xyz);
		MODELVIEW_MATRIX = VIEW_MATRIX;
		VERTEX = world;
	}
}

void fragment() {
	vec4 t = texture(tex, UV) * tint;
	ALBEDO = t.rgb;
	ALPHA = clamp(t.a * opacity, 0.0, 1.0);
}
