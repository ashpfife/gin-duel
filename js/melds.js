// Meld finding, deadwood calculation and lay-offs.
import { rank, suit, value } from './cards.js';

// Every set (3 or 4 of a rank) and run (3+ consecutive, same suit, ace low) in `cards`.
export function candidateMelds(cards) {
  const melds = [];
  const byRank = new Map();
  for (const c of cards) {
    if (!byRank.has(rank(c))) byRank.set(rank(c), []);
    byRank.get(rank(c)).push(c);
  }
  for (const group of byRank.values()) {
    if (group.length === 3) melds.push(group.slice());
    if (group.length === 4) {
      melds.push(group.slice());
      for (let skip = 0; skip < 4; skip++) melds.push(group.filter((_, j) => j !== skip));
    }
  }
  for (let s = 0; s < 4; s++) {
    const have = new Set(cards.filter(c => suit(c) === s).map(rank));
    for (let start = 0; start < 13; start++) {
      for (let len = 1; start + len - 1 < 13 && have.has(start + len - 1); len++) {
        if (len >= 3) melds.push(Array.from({ length: len }, (_, k) => s * 13 + start + k));
      }
    }
  }
  return melds;
}

// Best arrangement: the melds that leave the least deadwood.
export function analyze(cards) {
  const melds = candidateMelds(cards);
  const pos = new Map(cards.map((c, i) => [c, i]));
  const masks = melds.map(m => m.reduce((acc, c) => acc | (1 << pos.get(c)), 0));
  const memo = new Map();

  function solve(mask) {
    if (mask === 0) return { dw: 0, melds: [] };
    if (memo.has(mask)) return memo.get(mask);
    let i = 0;
    while (!(mask & (1 << i))) i++;
    const bit = 1 << i;
    const skip = solve(mask & ~bit);
    let best = { dw: skip.dw + value(cards[i]), melds: skip.melds };
    for (let k = 0; k < melds.length; k++) {
      if ((masks[k] & bit) && (masks[k] & mask) === masks[k]) {
        const r = solve(mask & ~masks[k]);
        if (r.dw < best.dw) best = { dw: r.dw, melds: [melds[k], ...r.melds] };
      }
    }
    memo.set(mask, best);
    return best;
  }

  const r = solve((1 << cards.length) - 1);
  const inMeld = new Set(r.melds.flat());
  return {
    deadwood: r.dw,
    melds: r.melds.map(m => m.slice()),
    deadwoodCards: cards.filter(c => !inMeld.has(c)),
  };
}

export const deadwoodOf = cards => analyze(cards).deadwood;
export const sumValues = cards => cards.reduce((a, c) => a + value(c), 0);

// Every way to arrange `cards` into melds + deadwood (used for lay-off search).
export function allArrangements(cards, limit = 20000) {
  const melds = candidateMelds(cards);
  const out = [];
  function rec(remaining, chosen, dead) {
    if (out.length >= limit) return;
    if (remaining.length === 0) {
      out.push({ melds: chosen.map(m => m.slice()), deadwoodCards: dead.slice() });
      return;
    }
    const [c, ...rest] = remaining;
    rec(rest, chosen, [...dead, c]);
    for (const m of melds) {
      if (m.includes(c) && m.every(x => remaining.includes(x))) {
        rec(remaining.filter(x => !m.includes(x)), [...chosen, m], dead);
      }
    }
  }
  rec(cards.slice(), [], []);
  return out;
}

const isSetMeld = m => m.every(c => rank(c) === rank(m[0]));

function fits(card, meld) {
  if (isSetMeld(meld)) return meld.length < 4 && rank(card) === rank(meld[0]);
  if (suit(card) !== suit(meld[0])) return false;
  const ranks = meld.map(rank);
  return rank(card) === Math.min(...ranks) - 1 || rank(card) === Math.max(...ranks) + 1;
}

// Lay deadwood cards onto the knocker's melds wherever they fit (repeatedly,
// since extending a run can open up room for another card).
export function layOff(deadwoodCards, knockerMelds) {
  const melds = knockerMelds.map(m => m.slice());
  let remaining = deadwoodCards.slice();
  const laid = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of remaining.slice()) {
      const target = melds.find(m => fits(c, m));
      if (target) {
        target.push(c);
        laid.push(c);
        remaining = remaining.filter(x => x !== c);
        changed = true;
      }
    }
  }
  return { remaining, laid, melds };
}

// The defender's best result after laying off onto the knocker's melds.
export function bestDefense(defenderCards, knockerMelds) {
  let best = null;
  for (const arr of allArrangements(defenderCards)) {
    const lo = layOff(arr.deadwoodCards, knockerMelds);
    const dw = sumValues(lo.remaining);
    if (!best || dw < best.deadwood) {
      best = { deadwood: dw, melds: arr.melds, laid: lo.laid, deadwoodCards: lo.remaining };
    }
  }
  return best;
}
