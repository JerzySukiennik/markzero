// Firebase web config of the shared gzowos-games project. NOT a secret: it ships in every page that uses
// Firebase; security is the rules block `markzero` (docs/net/markzero.rules.json, deployed only through
// Projects/tools/rtdb-rules.sh — the RTDB has ONE ruleset for all of Jurek's games).
export const firebaseConfig = {
  apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
  authDomain: 'gzowos-games.firebaseapp.com',
  databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'gzowos-games',
  storageBucket: 'gzowos-games.firebasestorage.app',
  messagingSenderId: '658227201482',
  appId: '1:658227201482:web:627b44e3c4c2988bc4bb33',
};
export const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
export const ROOT = 'markzero';
