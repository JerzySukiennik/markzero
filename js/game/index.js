// Gameplay entry point for the platform (docs/CORE-API.md §createPlayer): the world session calls
// createPlayer(MZ, world, {id, name, hero, suit, local}) for every player in the room.
// A player exposes: update(dt, t) · updateCamera(dt, camera) · fov · hud() · state() / applyState(s)
// · snapshot() · dispose() — plus hero-specific extras (suitUp, …).
import { IronMan } from './ironman.js';
import { SpiderMan } from './spider.js';

export async function createPlayer(MZ, world, opts) {
  const P = opts.hero === 'spiderman' ? SpiderMan : IronMan;
  const p = new P(MZ, world, opts);
  await p.init();
  return p;
}
export { IronMan, SpiderMan };
