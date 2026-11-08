// Game engine: one hand of gin rummy between the player and the bot, plus a
// match of several hands. Everything is deterministic from (seed, hand index,
// player moves), so any result can be re-played and verified from its move log.
import { rngFromSeed, shuffle } from './rng.js';
import { newDeck, cardToChar, charToCard, label } from './cards.js';
import { analyze, bestDefense } from './melds.js';
import * as bot from './bot.js';

export const GIN_BONUS = 25;
export const UNDERCUT_BONUS = 25;
export const KNOCK_LIMIT = 10;

const other = who => (who === 'player' ? 'bot' : 'player');

export class Hand {
  constructor(seed, index) {
    this.seed = seed;
    this.index = index;
    const deck = shuffle(newDeck(), rngFromSeed(`${seed}|hand${index}`));
    this.starter = index % 2 === 0 ? 'player' : 'bot';
    this.hands = { player: [], bot: [] };
    for (let i = 0; i < 10; i++) {
      this.hands[this.starter].push(deck.pop());
      this.hands[other(this.starter)].push(deck.pop());
    }
    this.discardPile = [deck.pop()];
    this.stock = deck;
    this.turn = this.starter;
    this.phase = 'draw'; // 'draw' | 'discard' | 'over'
    this.takenFromDiscard = null;
    this.lastDrawn = null;
    this.moves = '';
    this.events = [];
    this.result = null;
    this.playerPicked = [];
    this.playerDiscarded = [];
  }

  get discardTop() {
    return this.discardPile[this.discardPile.length - 1];
  }

  botContext() {
    return {
      discardPile: this.discardPile.slice(),
      playerPicked: this.playerPicked.filter(c => this.hands.player.includes(c)),
      playerDiscarded: this.playerDiscarded.slice(),
      stockLeft: this.stock.length,
    };
  }

  draw(source) {
    if (this.phase !== 'draw') throw new Error('Not time to draw');
    const who = this.turn;
    let card;
    if (source === 'discard') {
      if (!this.discardPile.length) throw new Error('Discard pile is empty');
      card = this.discardPile.pop();
      this.takenFromDiscard = card;
      if (who === 'player') this.playerPicked.push(card);
    } else if (source === 'stock') {
      card = this.stock.pop();
      this.takenFromDiscard = null;
    } else {
      throw new Error(`Bad draw source ${source}`);
    }
    this.hands[who].push(card);
    this.lastDrawn = card;
    this.phase = 'discard';
    if (who === 'player') this.moves += source === 'discard' ? '1' : '0';
    this.events.push({ who, type: 'draw', source, card });
    return card;
  }

  // Deadwood the current player would have after discarding `card`.
  deadwoodAfterDiscard(card, who = this.turn) {
    return analyze(this.hands[who].filter(c => c !== card)).deadwood;
  }

  canDiscard(card, who = this.turn) {
    return this.phase === 'discard' && this.turn === who &&
      this.hands[who].includes(card) && card !== this.takenFromDiscard;
  }

  canKnockWith(card, who = this.turn) {
    return this.canDiscard(card, who) && this.deadwoodAfterDiscard(card, who) <= KNOCK_LIMIT;
  }

  discard(card, knock = false) {
    const who = this.turn;
    if (!this.canDiscard(card, who)) throw new Error(`Can't discard ${label(card)}`);
    if (knock && !this.canKnockWith(card, who)) throw new Error('Deadwood too high to knock');
    this.hands[who] = this.hands[who].filter(c => c !== card);
    this.discardPile.push(card);
    if (who === 'player') {
      this.moves += cardToChar(card) + (knock ? '!' : '');
      this.playerDiscarded.push(card);
    }
    this.events.push({ who, type: 'discard', card, knock });
    this.takenFromDiscard = null;
    this.lastDrawn = null;

    if (knock) return this.finishKnock(who);
    if (this.stock.length <= 2) return this.finishDead();
    this.turn = other(who);
    this.phase = 'draw';
  }

  botDraw() {
    if (this.turn !== 'bot' || this.phase !== 'draw') throw new Error('Not the bot’s draw');
    return this.draw(bot.chooseDraw(this.hands.bot, this.botContext()));
  }

  botDiscard() {
    if (this.turn !== 'bot' || this.phase !== 'discard') throw new Error('Not the bot’s discard');
    const { card, knock } = bot.chooseDiscard(this.hands.bot, this.takenFromDiscard, this.botContext());
    this.discard(card, knock);
    return { card, knock };
  }

  botTurn() {
    this.botDraw();
    this.botDiscard();
  }

  finishDead() {
    this.phase = 'over';
    this.result = {
      type: 'dead', winner: null, points: 0, playerScore: 0,
      player: analyze(this.hands.player), bot: analyze(this.hands.bot),
    };
    return this.result;
  }

  finishKnock(knocker) {
    const defender = other(knocker);
    const k = analyze(this.hands[knocker]);
    let type, winner, points, defense;
    if (k.deadwood === 0) {
      defense = { ...analyze(this.hands[defender]), laid: [] };
      type = 'gin'; winner = knocker; points = GIN_BONUS + defense.deadwood;
    } else {
      defense = bestDefense(this.hands[defender], k.melds);
      if (defense.deadwood <= k.deadwood) {
        type = 'undercut'; winner = defender; points = UNDERCUT_BONUS + (k.deadwood - defense.deadwood);
      } else {
        type = 'knock'; winner = knocker; points = defense.deadwood - k.deadwood;
      }
    }
    this.phase = 'over';
    this.result = {
      type, knocker, winner, points,
      playerScore: winner === 'player' ? points : -points,
      [knocker]: { ...k, laid: [] },
      [defender]: defense,
    };
    return this.result;
  }
}

export class Match {
  constructor(seed, numHands) {
    this.seed = seed;
    this.numHands = numHands;
    this.results = [];
    this.handMoves = [];
    this.hand = new Hand(seed, 0);
  }
  get handIndex() { return this.results.length; }
  get total() { return this.results.reduce((a, r) => a + r.playerScore, 0); }
  get over() { return this.results.length >= this.numHands; }

  // Call once the current hand's phase is 'over'.
  recordHand() {
    this.results.push(this.hand.result);
    this.handMoves.push(this.hand.moves);
    if (!this.over) this.hand = new Hand(this.seed, this.results.length);
  }
  get moveLog() { return this.handMoves.join('_'); }
  // Includes the hand in progress (or finished but not yet recorded).
  get liveLog() {
    return this.over ? this.moveLog : [...this.handMoves, this.hand.moves].join('_');
  }
}

// Apply one hand's worth of player moves (bot turns are played automatically).
// With partial=true the moves may stop mid-hand (used to resume a saved game).
function applyHandMoves(h, m, partial) {
  let p = 0;
  while (h.phase !== 'over') {
    if (h.turn === 'bot') {
      if (h.phase === 'draw') h.botDraw(); else h.botDiscard();
      continue;
    }
    if (h.phase === 'draw') {
      if (partial && p >= m.length) return;
      const d = m[p++];
      if (d !== '0' && d !== '1') throw new Error('Bad draw code');
      h.draw(d === '1' ? 'discard' : 'stock');
    }
    if (partial && p >= m.length) return;
    const card = charToCard(m[p++] ?? '');
    const knock = m[p] === '!';
    if (knock) p++;
    h.discard(card, knock);
  }
  if (p !== m.length) throw new Error('Move log continues after the hand ended');
}

// Re-play a full match from its move log. Throws if the log is invalid.
export function replay(seed, numHands, moveLog) {
  const parts = moveLog.split('_');
  if (parts.length !== numHands) throw new Error('Move log has the wrong number of hands');
  const results = [];
  for (let i = 0; i < numHands; i++) {
    const h = new Hand(seed, i);
    applyHandMoves(h, parts[i], false);
    results.push(h.result);
  }
  return { results, total: results.reduce((a, r) => a + r.playerScore, 0) };
}

// Rebuild an in-progress match from a (possibly partial) move log.
export function restoreMatch(seed, numHands, moveLog) {
  const m = new Match(seed, numHands);
  const parts = moveLog ? moveLog.split('_') : [''];
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    applyHandMoves(m.hand, part, last);
    if (!last) {
      if (m.hand.phase !== 'over') throw new Error('Saved hand did not finish');
      m.recordHand();
    }
  });
  return m;
}
