// Repulsor bolt: a camera-facing streak with a white-hot head, blue halo and a fading tail.
// Port of showroom/js/vfx.js BOLT_FS. Put it on a QuadMesh (size 1x1) that the script orients
// every frame: local X = direction of travel, the quad's normal towards the camera
// (see repulsor_vfx.gd::orient_bolt). UV.x runs tail(0) -> head(0.86) -> 1.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec3 core_color : source_color = vec3(1.0);
uniform vec3 halo_color : source_color = vec3(0.35, 0.70, 1.0);
uniform float intensity = 1.0;

void fragment() {
	float y = (UV.y - 0.5) * 2.0;
	float hx = 0.86, dx = UV.x - hx;
	float head = exp(-(dx * dx * 260.0 + y * y * 7.0));
	float halo = exp(-(dx * dx * 30.0 + y * y * 2.4));
	float along = smoothstep(0.0, hx, UV.x) * step(UV.x, hx + 0.04);
	float tail = exp(-y * y * 10.0) * along * along;
	float thread = exp(-y * y * 60.0) * along;
	float flick = 0.85 + 0.15 * sin(TIME * 90.0 + UV.x * 20.0);
	vec3 c = core_color * (head * 3.4 + thread * 1.2) + halo_color * (halo * 1.4 + tail * 1.1) * flick;
	ALBEDO = c * intensity;
	ALPHA = clamp(head + halo * 0.8 + tail * 0.7 + thread * 0.6, 0.0, 1.0);
}
