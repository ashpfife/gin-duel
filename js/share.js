// Challenge links. Everything lives in the URL hash, so no server is needed:
//   #c=<base64url JSON {v, s: seed, n: hands, p: [[name, moveLog], ...]}>
// Scores are never trusted from the link: each player's move log is re-played
// against the same deck to recompute their score.
import { replay } from './engine.js';

function toB64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
}

export function encodeChallenge({ seed, numHands, players }) {
  return toB64Url(JSON.stringify({
    v: 1, s: seed, n: numHands, p: players.map(p => [p.name, p.moves]),
  }));
}

export function decodeChallenge(code) {
  const d = JSON.parse(fromB64Url(code));
  if (d.v !== 1 || typeof d.s !== 'string' || !Number.isInteger(d.n) || d.n < 1 || d.n > 9) {
    throw new Error('Unrecognised challenge link');
  }
  const players = (Array.isArray(d.p) ? d.p : [])
    .filter(x => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string')
    .map(([name, moves]) => ({ name: name.slice(0, 24), moves }));
  return { seed: d.s, numHands: d.n, players };
}

// Re-play every player's moves; attaches verified results (or marks invalid).
export function verifyPlayers(seed, numHands, players) {
  return players.map(p => {
    try {
      const r = replay(seed, numHands, p.moves);
      return { ...p, valid: true, results: r.results, total: r.total };
    } catch {
      return { ...p, valid: false, results: [], total: -Infinity };
    }
  });
}

// Add or replace a player (matched by move log, then by name).
export function mergePlayers(list, entry) {
  const out = list.filter(p => p.moves !== entry.moves && p.name !== entry.name);
  out.push(entry);
  return out;
}

export function challengeUrl(data) {
  const base = location.href.split('#')[0];
  return `${base}#c=${encodeChallenge(data)}`;
}
