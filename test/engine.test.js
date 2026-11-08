import test from 'node:test';
import assert from 'node:assert/strict';
import { Hand, Match, replay, restoreMatch } from '../js/engine.js';
import { analyze, bestDefense } from '../js/melds.js';
import { rngFromSeed } from '../js/rng.js';
import { encodeChallenge, decodeChallenge } from '../js/share.js';

// Card helper: c('7h') -> int
const S = { s: 0, h: 1, d: 2, c: 3 };
const R = { A: 0, J: 10, Q: 11, K: 12 };
const c = str => {
  const r = str.slice(0, -1), s = str.slice(-1);
  return S[s] * 13 + (R[r] ?? Number(r) - 1);
};
const cs = s => s.split(' ').map(c);

test('same seed deals the same cards; different seeds differ', () => {
  const a = new Hand('abc', 0), b = new Hand('abc', 0), d = new Hand('xyz', 0);
  assert.deepEqual(a.hands, b.hands);
  assert.deepEqual(a.stock, b.stock);
  assert.notDeepEqual(a.hands.player, d.hands.player);
  assert.equal(a.hands.player.length, 10);
  assert.equal(a.stock.length, 31);
});

test('analyze finds optimal melds', () => {
  // 4-5-6-7♥ run, three 7s using 7♥ would conflict: best uses run + set of 8s
  const hand = cs('4h 5h 6h 7h 8s 8d 8c Kc Qs 2d');
  const a = analyze(hand);
  assert.equal(a.deadwood, 10 + 10 + 2);
  const gin = cs('Ah 2h 3h 4s 4d 4c 9c 10c Jc Qc');
  assert.equal(analyze(gin).deadwood, 0);
  // overlapping: 7s 7d 7h + 5h 6h  vs 5h 6h 7h run
  const ov = cs('7s 7d 7h 5h 6h Kd Kc Ks 2c 3c');
  // 777 + KKK leaves 5+6+2+3 = 16; run 5-6-7♥ + KKK would leave 19
  assert.equal(analyze(ov).deadwood, 16);
});

test('lay-offs extend the knocker’s runs and sets', () => {
  const knockerMelds = [cs('4h 5h 6h'), cs('9s 9d 9c')];
  const def = bestDefense(cs('3h 7h 8h 9h Kc Ks 2d'), knockerMelds);
  assert.ok(def.laid.includes(c('3h')));
  // 7-8-9♥ all lay off onto 4-5-6♥ (or meld themselves); deadwood = K + K + 2
  assert.equal(def.deadwood, 22);
});

test('replay reproduces live games exactly (random player, many seeds)', () => {
  for (let g = 0; g < 40; g++) {
    const seed = 'seed' + g;
    const rng = rngFromSeed('player' + g);
    const m = new Match(seed, 3);
    while (!m.over) {
      const h = m.hand;
      while (h.phase !== 'over') {
        if (h.turn === 'bot') { h.botTurn(); continue; }
        h.draw(rng() < 0.3 ? 'discard' : 'stock');
        const options = h.hands.player.filter(x => h.canDiscard(x));
        // Mostly sensible: discard the card that minimises deadwood
        options.sort((a, b) => h.deadwoodAfterDiscard(a) - h.deadwoodAfterDiscard(b));
        const card = rng() < 0.7 ? options[0] : options[Math.floor(rng() * options.length)];
        h.discard(card, h.canKnockWith(card) && rng() < 0.8);
      }
      m.recordHand();
    }
    // Resuming from any prefix of the log reproduces the same state
    const log = m.moveLog;
    for (const cut of [1, 5, Math.floor(log.length / 2), log.length - 1]) {
      let prefix = log.slice(0, cut);
      if (prefix.endsWith('!')) continue;
      const restored = restoreMatch(seed, 3, prefix);
      assert.equal(restored.liveLog, prefix);
    }
    const r = replay(seed, 3, m.moveLog);
    assert.equal(r.total, m.total);
    assert.deepEqual(r.results.map(x => x.playerScore), m.results.map(x => x.playerScore));
  }
});

test('scoring sanity across many bot-vs-bot style games', () => {
  const types = {};
  for (let g = 0; g < 200; g++) {
    const h = new Hand('s' + g, g % 2);
    while (h.phase !== 'over') {
      if (h.turn === 'bot') { h.botTurn(); continue; }
      h.draw('stock');
      const opts = h.hands.player.filter(x => h.canDiscard(x))
        .sort((a, b) => h.deadwoodAfterDiscard(a) - h.deadwoodAfterDiscard(b));
      h.discard(opts[0], h.canKnockWith(opts[0]));
    }
    const r = h.result;
    types[r.type] = (types[r.type] || 0) + 1;
    assert.ok(r.points >= 0);
    if (r.type === 'gin') assert.ok(r.points >= 25);
    if (r.type === 'undercut') assert.ok(r.points >= 25);
    // card conservation
    const all = [...h.hands.player, ...h.hands.bot, ...h.stock, ...h.discardPile];
    assert.equal(new Set(all).size, 52);
  }
  assert.ok(types.knock > 0, JSON.stringify(types));
});

test('tampered move logs are rejected', () => {
  assert.throws(() => replay('abc', 1, '0Z9!'));
  assert.throws(() => replay('abc', 2, ''));
});

test('challenge codes round-trip', () => {
  const data = { seed: 'k3j', numHands: 3, players: [{ name: 'Ash ♥', moves: '0A_1B!_0C' }] };
  assert.deepEqual(decodeChallenge(encodeChallenge(data)), data);
});
