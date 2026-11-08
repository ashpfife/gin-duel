// The bot. Fully deterministic (no randomness), so the same player moves on
// the same deck always produce the same game. It only uses information a
// human opponent would have: its own hand, the discard pile, and which
// discards the player picked up.
import { rank, suit, value } from './cards.js';
import { analyze } from './melds.js';

// Cards the bot knows can't come to it: discard pile + cards the player took.
function deadCards(ctx) {
  return new Set([...ctx.discardPile, ...ctx.playerPicked]);
}

// How promising the leftover deadwood is: live pairs and near-runs.
function potential(deadwood, ctx) {
  const dead = deadCards(ctx);
  const live = cards => cards.some(c => c >= 0 && c < 52 && !dead.has(c));
  let score = 0;
  for (let i = 0; i < deadwood.length; i++) {
    for (let j = i + 1; j < deadwood.length; j++) {
      const a = deadwood[i], b = deadwood[j];
      if (rank(a) === rank(b)) {
        const others = [0, 1, 2, 3].map(s => s * 13 + rank(a)).filter(c => c !== a && c !== b);
        if (live(others)) score += 1;
      } else if (suit(a) === suit(b)) {
        const lo = Math.min(rank(a), rank(b)), hi = Math.max(rank(a), rank(b));
        const base = suit(a) * 13;
        if (hi - lo === 1) {
          const ends = [lo - 1, hi + 1].filter(r => r >= 0 && r <= 12).map(r => base + r);
          if (live(ends)) score += 1;
        } else if (hi - lo === 2) {
          if (live([base + lo + 1])) score += 0.5;
        }
      }
    }
  }
  return score;
}

// Would discarding `c` likely help the player?
function danger(c, ctx) {
  let d = 0;
  for (const p of ctx.playerPicked) {
    if (rank(p) === rank(c)) d += 2;
    else if (suit(p) === suit(c) && Math.abs(rank(p) - rank(c)) <= 2) d += 1.5;
  }
  for (const p of ctx.playerDiscarded) {
    if (rank(p) === rank(c)) d -= 0.5;
  }
  return d;
}

export function knockThreshold(stockLeft) {
  if (stockLeft > 20) return 10;
  if (stockLeft > 10) return 7;
  return 4;
}

// Returns 'stock' or 'discard'.
export function chooseDraw(hand, ctx) {
  const top = ctx.discardPile[ctx.discardPile.length - 1];
  if (top === undefined) return 'stock';
  const current = analyze(hand).deadwood;
  const withTop = [...hand, top];
  let bestDw = Infinity, topUsed = false;
  for (const c of hand) {
    const a = analyze(withTop.filter(x => x !== c));
    if (a.deadwood < bestDw) {
      bestDw = a.deadwood;
      topUsed = !a.deadwoodCards.includes(top);
    }
  }
  if (bestDw >= current) return 'stock';
  if (topUsed) return 'discard';                                       // completes a meld
  if (bestDw <= knockThreshold(ctx.stockLeft)) return 'discard';       // lets us knock now
  return 'stock';
}

// Returns { card, knock } for an 11-card hand.
export function chooseDiscard(hand, forbidden, ctx) {
  const options = hand.filter(c => c !== forbidden);
  const evals = options.map(c => ({ c, a: analyze(hand.filter(x => x !== c)) }));
  const minDw = Math.min(...evals.map(e => e.a.deadwood));

  if (minDw <= knockThreshold(ctx.stockLeft)) {
    const pick = evals
      .filter(e => e.a.deadwood === minDw)
      .sort((x, y) => value(y.c) - value(x.c) || y.c - x.c)[0];
    return { card: pick.c, knock: true };
  }

  let best = null;
  for (const e of evals) {
    const score = e.a.deadwood - 2.5 * potential(e.a.deadwoodCards, ctx) + danger(e.c, ctx);
    if (
      !best ||
      score < best.score - 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 &&
        (value(e.c) > value(best.c) || (value(e.c) === value(best.c) && e.c > best.c)))
    ) {
      best = { c: e.c, score };
    }
  }
  return { card: best.c, knock: false };
}
