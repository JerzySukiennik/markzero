// GLB loading (cached, cloned per use) + clip libraries. NEXT assets are served at /assets/* by the
// dev server (read live from next/assets, or next-slim when next/ is absent).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ClipPlayer } from '../gfx/player.js';

export const LIBS = {
  ironman: 'assets/anims/ironman_core.glb',
  spiderman: 'assets/anims/spider_core.glb',
  human: 'assets/anims/human_core.glb',
  human174: 'assets/anims/human_core_174.glb',
  hulkbuster: 'assets/anims/hulkbuster_core.glb',
};

export class Assets {
  constructor() { this.loader = new GLTFLoader(); this.cache = new Map(); }
  url(rel) { return rel.startsWith('/') || rel.startsWith('http') ? rel : '/' + rel; }
  async _raw(rel) {
    const url = this.url(rel);
    if (!this.cache.has(url)) {
      this.cache.set(url, Promise.all([
        this.loader.loadAsync(url),
        fetch(url + '.clips.json').then(r => r.ok ? r.json() : null).catch(() => null),
      ]));
    }
    return this.cache.get(url);
  }
  /** {scene (fresh clone), animations, clips, gltf} */
  async load(rel) {
    const [g, clips] = await this._raw(rel);
    return { scene: SkeletonUtils.clone(g.scene), animations: g.animations, clips, gltf: g };
  }
  /** ClipPlayer on `root` with its own clips plus the named libraries' clips. ctx gives cues sound/vfx. */
  async player(root, own, libs = [], ctx = null) {
    const L = await Promise.all(libs.map(k => this._raw(LIBS[k] || k).catch(() => null)));
    const anims = [...(own?.animations || []), ...L.filter(Boolean).flatMap(([g]) => g.animations)];
    const meta = [own?.clips, ...L.filter(Boolean).map(([, c]) => c)];
    return new ClipPlayer(root, anims, meta, ctx);
  }
  shadows(root, cast = true, receive = true) { root.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } }); return root; }
}
export function libsFor(suitId) {
  if (suitId === 'hulkbuster') return ['hulkbuster'];
  if (suitId === 'ironspider') return ['spiderman'];
  if (suitId === 'peter') return ['spiderman', 'human174'];
  return ['ironman'];
}
export { THREE };
