// Warm the asset cache while the world loads (the story's first seconds need these at once).
export function preload(MZ) {
  const hero = MZ.game?.hero;
  const list = hero === 'spiderman'
    ? ['assets/characters/peter/peter.glb', 'assets/anims/human_core_174.glb', 'assets/anims/spider_core.glb', 'assets/suits/ironspider/ironspider.glb', 'assets/bases/apartment/window_a.glb']
    : ['assets/characters/tony/tony.glb', 'assets/anims/human_core.glb', 'assets/bases/gantry/gantry.glb'];
  return Promise.all(list.map(u => MZ.assets.load(u).catch(() => null)));
}
