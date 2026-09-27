// Transport choice (MZ.net keeps one API either way — see net/client.js and net/firebase.js):
//   online (default)  Firebase RTDB — the internet; the only option in the static browser build (no /net there)
//   ?net=local        the dev server's WebSocket room service (LAN, headless tests without the internet)
import { Net } from './client.js';
import { FirebaseNet } from './firebase.js';
import { STATIC } from '../core/env.js';

export function createNet(bus, params) {
  const want = params.get('net');
  const local = want === 'local' || want === 'ws';
  if (local && STATIC) console.warn('[net] ?net=local needs the dev server; the static build uses Firebase');
  const net = local && !STATIC ? new Net(bus) : new FirebaseNet(bus);
  net.transport ||= 'ws';
  return net;
}
