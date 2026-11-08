# Gin Duel

Gin rummy against a bot, where the real opponent is your friend.

**Play:** https://ashpfife.github.io/gin-duel/

You play a game against the bot, then send a link to someone else. They play the **exact same deck** (same deals, same stock order) against the **same bot**. Instead of trying to beat the bot, each of you is trying to do better against it than the other person.

## How it works

- **Seeded deck.** Every game has a seed. Each hand's deck is shuffled from `seed + hand number` with a deterministic PRNG, so everyone who plays that seed gets identical cards.
- **Deterministic bot.** The bot uses no randomness and only sees what a human opponent would (its own hand, the discard pile, and which discards you picked up). Same deck plus same moves means the same game, so differences in score come from decisions.
- **Score.** Points you win minus points the bot wins, summed over the hands (1, 3 or 5). Highest score on the deck wins the duel.
- **No server.** The challenge link holds the seed and each player's move log in the URL hash (`#c=…`). When the page opens a link, it **re-plays every move log** against the deck to work out the scores, so a score can't be faked by editing the link.
- **Pass it around.** Anyone who plays from a link gets added to the standings. Send the new link back and everyone sees the updated table.
- **Daily deck.** Everyone who plays on the same day gets the same 3-hand deck.
- Games in progress are saved in `localStorage`, so a refresh picks up where you left off and doesn't re-deal.

## Rules (standard gin rummy)

- 10 cards each. On your turn, draw from the stock or take the top discard, then discard one card. You can't throw back a card you just took from the discard pile.
- Melds are sets (3–4 of a rank) or runs (3+ in a suit, ace low). The game arranges your hand into the best melds automatically. Unmelded cards are deadwood (A = 1, face cards = 10).
- **Knock** with 10 or less deadwood. The defender lays off cards onto the knocker's melds, and the knocker scores the difference.
- **Gin** (0 deadwood) scores 25 + the opponent's deadwood, with no lay-offs.
- **Undercut**: if the defender's deadwood is less than or equal to the knocker's, the defender scores 25 + the difference.
- If the stock gets down to 2 cards, the hand is dead and nobody scores.

## Running locally

It's a static site with no build step or dependencies. ES modules need to be served over HTTP:

```bash
npm start          # serves on http://localhost:5173
```

## Tests

```bash
npm test
```

The tests cover deterministic dealing, meld and lay-off maths, scoring, link encoding, rejecting tampered move logs, and that re-playing (or resuming) a move log reproduces the live game exactly.

## Project layout

| File | What it does |
| --- | --- |
| `js/rng.js` | Seeded PRNG + shuffle |
| `js/cards.js` | Card encoding, labels, move-log characters |
| `js/melds.js` | Best-meld search, deadwood, lay-offs |
| `js/bot.js` | The deterministic bot |
| `js/engine.js` | Hand/match rules, scoring, replay and resume |
| `js/share.js` | Challenge-link encoding and score verification |
| `js/app.js` | UI |

## Hosting

Served by GitHub Pages from the `main` branch (root folder). Any push to `main` redeploys it.
