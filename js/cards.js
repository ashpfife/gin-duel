// Cards are integers 0..51. suit = floor(c / 13), rank = c % 13 (0 = Ace ... 12 = King).

export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const rank = c => c % 13;
export const suit = c => Math.floor(c / 13);
export const value = c => Math.min(rank(c) + 1, 10);
export const isRed = c => suit(c) === 1 || suit(c) === 2;
export const label = c => RANKS[rank(c)] + SUITS[suit(c)];

export const newDeck = () => Array.from({ length: 52 }, (_, i) => i);

// Display order: by suit (alternating colours ♠ ♥ ♣ ♦), then rank. Display only.
const SUIT_ORDER = [0, 1, 3, 2];
export const bySuitThenRank = (a, b) => SUIT_ORDER[suit(a)] - SUIT_ORDER[suit(b)] || rank(a) - rank(b);
export const byRankThenSuit = (a, b) => rank(a) - rank(b) || SUIT_ORDER[suit(a)] - SUIT_ORDER[suit(b)];

// One URL-safe character per card, used in move logs.
const CARD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const cardToChar = c => CARD_CHARS[c];
export const charToCard = ch => {
  const i = CARD_CHARS.indexOf(ch);
  if (i < 0) throw new Error(`Bad card code "${ch}"`);
  return i;
};
