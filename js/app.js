import { label, isRed, rank, suit, RANKS, SUITS, bySuitThenRank, byRankThenSuit } from './cards.js';
import { analyze } from './melds.js';
import { restoreMatch } from './engine.js';
import { randomSeed } from './rng.js';
import { decodeChallenge, verifyPlayers, mergePlayers, challengeUrl } from './share.js';

const app = document.getElementById('app');
const BOT_DRAW_DELAY = 650;
const BOT_DISCARD_DELAY = 800;

// ---------- storage (all wrapped: storage can be unavailable) ----------
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem('ginDuel.' + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('ginDuel.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem('ginDuel.' + key); } catch { /* ignore */ }
  },
};
const gameKey = (seed, n) => `${seed}|${n}`;

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const signed = n => (n > 0 ? `+${n}` : `${n}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function cardHtml(c, { cls = '', attrs = '' } = {}) {
  return `<button type="button" class="card ${isRed(c) ? 'red' : 'black'} ${cls}" data-card="${c}" ${attrs}
    aria-label="${RANKS[rank(c)]} of ${['spades', 'hearts', 'diamonds', 'clubs'][suit(c)]}">
    <span class="corner"><b>${RANKS[rank(c)]}</b><i>${SUITS[suit(c)]}</i></span>
    <span class="pip">${SUITS[suit(c)]}</span>
    <span class="corner br"><b>${RANKS[rank(c)]}</b><i>${SUITS[suit(c)]}</i></span>
  </button>`;
}
const backHtml = (cls = '') => `<div class="card back ${cls}" aria-hidden="true"></div>`;

function groupsHtml(analysis, { sort = 'suit', laid = [], cardCls = () => '', cardAttrs = () => '' } = {}) {
  const sorter = sort === 'rank' ? byRankThenSuit : bySuitThenRank;
  const melds = analysis.melds.map(m => m.slice().sort(bySuitThenRank).sort((a, b) => rank(a) - rank(b)));
  const dead = analysis.deadwoodCards.slice().sort(sorter);
  const render = c => cardHtml(c, { cls: `${cardCls(c)} ${laid.includes(c) ? 'laid' : ''}`, attrs: cardAttrs(c) });
  return [
    ...melds.map(m => `<div class="group meld">${m.map(render).join('')}</div>`),
    dead.length ? `<div class="group deadwood">${dead.map(render).join('')}</div>` : '',
  ].join('');
}

function resultSentence(r) {
  const pts = plural(r.points, 'point');
  switch (r.type) {
    case 'dead': return 'The stock ran out — nobody scores this hand.';
    case 'gin': return r.winner === 'player' ? `You went gin — ${pts}!` : `The bot went gin — ${pts}.`;
    case 'undercut': return r.winner === 'player'
      ? `You undercut the bot’s knock — ${pts}!`
      : `The bot undercut your knock — ${pts}.`;
    default: return r.winner === 'player' ? `You knocked and won ${pts}.` : `The bot knocked and won ${pts}.`;
  }
}
const typeTag = r => ({ dead: 'dead', gin: 'gin', undercut: 'undercut', knock: 'knock' }[r.type]);

// ---------- state ----------
let state = { screen: 'home' };
let botTimer = null;
const clearBot = () => { clearTimeout(botTimer); botTimer = null; };

function setHash(code) {
  history.replaceState(null, '', code ? `#c=${code}` : location.pathname + location.search);
}

function linkData() {
  const m = location.hash.match(/^#c=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { return decodeChallenge(m[1]); } catch { return 'invalid'; }
}

// ---------- routing ----------
function route() {
  clearBot();
  const data = linkData();
  if (!data) return showHome();
  if (data === 'invalid') { toast('That challenge link looks broken.'); setHash(null); return showHome(); }
  const key = gameKey(data.seed, data.numHands);
  const played = store.get('played.' + key);
  if (played) {
    // Remember everyone we've seen on this deck so far.
    let known = played.others || [];
    for (const p of data.players) if (p.moves !== played.moves) known = mergePlayers(known, p);
    store.set('played.' + key, { ...played, others: known });
    return showResults(data.seed, data.numHands);
  }
  const progress = store.get('progress.' + key);
  if (progress) return startGame(data.seed, data.numHands, progress.name, data.players, progress.log);
  return showIntro(data);
}

// ---------- home ----------
function showHome() {
  state = { screen: 'home' };
  const name = store.get('name', '');
  const recent = store.get('recent', []).slice(0, 5);
  const today = new Date();
  const dailySeed = `daily-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  app.innerHTML = `
  <section class="panel home">
    <div class="brand">
      <div class="logo-cards">${cardHtml(0, { cls: 'tilt-l' })}${cardHtml(13 + 12, { cls: 'tilt-r' })}</div>
      <h1>Gin Duel</h1>
      <p class="tagline">Play gin rummy against the bot. Then send a friend the <em>exact same deck</em> and see who plays it better.</p>
    </div>
    <form id="startForm" class="stack">
      <label class="field"><span>Your name</span>
        <input id="name" maxlength="24" autocomplete="nickname" placeholder="e.g. Ash" value="${esc(name)}" required></label>
      <fieldset class="field"><legend>Length</legend>
        <div class="seg">
          ${[1, 3, 5].map(n => `<label><input type="radio" name="hands" value="${n}" ${n === 3 ? 'checked' : ''}><span>${plural(n, 'hand')}</span></label>`).join('')}
        </div>
      </fieldset>
      <button class="btn primary big" type="submit">Deal a new duel</button>
      <button class="btn ghost" type="button" id="daily">Play today’s daily deck (3 hands)</button>
    </form>
    ${recent.length ? `<div class="recent"><h3>Your recent duels</h3>${recent.map(r => `
      <a class="recent-row" href="#c=${r.code}"><span>${esc(r.title)}</span><b class="${r.total >= 0 ? 'pos' : 'neg'}">${signed(r.total)}</b></a>`).join('')}</div>` : ''}
    <details class="rules">
      <summary>How it works</summary>
      ${rulesHtml()}
    </details>
  </section>`;
  const begin = (seed, n) => {
    const nm = document.getElementById('name').value.trim();
    if (!nm) { document.getElementById('name').focus(); return toast('Enter your name first.'); }
    store.set('name', nm);
    const key = gameKey(seed, n);
    const code = challengeUrl({ seed, numHands: n, players: [] }).split('#c=')[1];
    if (!store.get('played.' + key)) store.set('progress.' + key, { name: nm, log: '' });
    setHash(code);
    route();
  };
  document.getElementById('startForm').addEventListener('submit', e => {
    e.preventDefault();
    begin(randomSeed(), Number(new FormData(e.target).get('hands')));
  });
  document.getElementById('daily').addEventListener('click', () => begin(dailySeed, 3));
}

function rulesHtml() {
  return `<ul>
    <li><b>The duel:</b> you and your friend each play the bot on an identical deck — same deals, same stock order. The bot is deterministic, so any difference in the result comes from your decisions.</li>
    <li><b>Your score</b> is points you win minus points the bot wins across all hands. Higher beats your friend.</li>
    <li><b>Each turn:</b> draw from the stock or take the top discard, then discard one card. You can’t throw back the card you just picked up.</li>
    <li><b>Melds</b> are sets (3–4 of a rank) or runs (3+ in a suit, ace low). Your hand is arranged into the best melds automatically. Everything else is <b>deadwood</b> (face cards 10, ace 1).</li>
    <li><b>Knock</b> when your deadwood is 10 or less after discarding. The defender lays off cards onto your melds, then you win the difference in deadwood.</li>
    <li><b>Gin</b> (0 deadwood) scores 25 + the opponent’s deadwood, no lay-offs. An <b>undercut</b> (defender’s deadwood ≤ knocker’s) gives the defender 25 + the difference.</li>
    <li>If the stock gets down to 2 cards, the hand is dead and nobody scores.</li>
  </ul>`;
}

// ---------- challenge intro ----------
function showIntro(data) {
  state = { screen: 'intro' };
  const players = verifyPlayers(data.seed, data.numHands, data.players).filter(p => p.valid)
    .sort((a, b) => b.total - a.total);
  const name = store.get('name', '');
  const lead = players[0];
  app.innerHTML = `
  <section class="panel intro">
    <p class="eyebrow">Gin Duel · ${plural(data.numHands, 'hand')}</p>
    ${lead
      ? `<h1>${esc(lead.name)} challenged you</h1>
         <p class="tagline">${players.length === 1 ? `${esc(lead.name)} played this exact deck against the bot and finished` : 'Scores to beat on this exact deck:'}
         ${players.length === 1 ? `<b class="${lead.total >= 0 ? 'pos' : 'neg'}">${signed(lead.total)}</b>. Play the same cards and beat that.` : ''}</p>
         ${players.length > 1 ? `<ol class="board">${players.map(p => `<li><span>${esc(p.name)}</span><b class="${p.total >= 0 ? 'pos' : 'neg'}">${signed(p.total)}</b></li>`).join('')}</ol>` : ''}`
      : `<h1>A fresh deck</h1><p class="tagline">Nobody has played this deck yet. Set the score to beat.</p>`}
    <form id="introForm" class="stack">
      <label class="field"><span>Your name</span>
        <input id="name" maxlength="24" autocomplete="nickname" value="${esc(name)}" required></label>
      <button class="btn primary big" type="submit">Play this deck</button>
      <a class="btn ghost" href="./">Start my own duel instead</a>
    </form>
    <details class="rules"><summary>How it works</summary>${rulesHtml()}</details>
  </section>`;
  document.getElementById('introForm').addEventListener('submit', e => {
    e.preventDefault();
    const nm = document.getElementById('name').value.trim();
    if (!nm) return;
    store.set('name', nm);
    store.set('progress.' + gameKey(data.seed, data.numHands), { name: nm, log: '' });
    startGame(data.seed, data.numHands, nm, data.players, '');
  });
}

// ---------- game ----------
function startGame(seed, numHands, name, rivals, log) {
  let match;
  try { match = restoreMatch(seed, numHands, log || ''); }
  catch { match = restoreMatch(seed, numHands, ''); }
  const verifiedRivals = verifyPlayers(seed, numHands, rivals).filter(p => p.valid);
  const best = verifiedRivals.sort((a, b) => b.total - a.total)[0] || null;
  state = {
    screen: 'game', seed, numHands, name, rivals, match, target: best,
    selected: null, sort: store.get('sort', 'suit'), message: '', botBusy: false,
  };
  if (match.hand.phase === 'over') { renderGame(); return; }
  state.message = openingMessage();
  renderGame();
  if (match.hand.turn === 'bot') scheduleBot();
}

function openingMessage() {
  const h = state.match.hand;
  const n = h.index + 1;
  const last = h.events.at(-1);
  if (last) {
    return last.who === 'bot' && last.type === 'discard'
      ? `The bot discarded the ${label(last.card)}. Your turn — draw a card.`
      : h.phase === 'discard' ? 'Choose a card to discard.' : 'Your turn — draw a card.';
  }
  return h.starter === 'player'
    ? `Hand ${n}: you go first. Draw from the stock or take the ${label(h.discardTop)}.`
    : `Hand ${n}: the bot goes first.`;
}

function saveProgress() {
  const { seed, numHands, name, match } = state;
  store.set('progress.' + gameKey(seed, numHands), { name, log: match.liveLog });
}

function scheduleBot() {
  const h = state.match.hand;
  state.botBusy = true;
  renderGame();
  botTimer = setTimeout(() => {
    const ev = h.botDraw();
    state.message = h.events.at(-1).source === 'discard'
      ? `The bot took the ${label(ev)}.`
      : 'The bot drew from the stock.';
    renderGame();
    botTimer = setTimeout(() => {
      const { card, knock } = h.botDiscard();
      state.botBusy = false;
      if (h.phase === 'over') {
        state.message = knock ? `The bot knocked, discarding the ${label(card)}.` : 'The stock ran out.';
      } else {
        state.message = `The bot discarded the ${label(card)}. Your turn — draw a card.`;
      }
      saveProgress();
      renderGame();
    }, BOT_DISCARD_DELAY);
  }, BOT_DRAW_DELAY);
}

function onDraw(source) {
  const h = state.match.hand;
  if (state.botBusy || h.turn !== 'player' || h.phase !== 'draw') return;
  const c = h.draw(source);
  state.selected = null;
  state.message = source === 'discard'
    ? `You took the ${label(c)}. Now discard a card (not the ${label(c)}).`
    : `You drew the ${label(c)}. Now choose a card to discard.`;
  saveProgress();
  renderGame();
}

function onCard(c) {
  const h = state.match.hand;
  if (state.botBusy || h.turn !== 'player' || h.phase !== 'discard') return;
  if (!h.canDiscard(c)) return toast('You can’t throw back the card you just picked up.');
  if (state.selected === c) return doDiscard(false);
  state.selected = c;
  renderGame();
}

function doDiscard(knock) {
  const h = state.match.hand;
  const c = state.selected;
  if (c == null || !h.canDiscard(c)) return;
  if (knock && !h.canKnockWith(c)) return;
  h.discard(c, knock);
  state.selected = null;
  saveProgress();
  if (h.phase === 'over') {
    state.message = knock ? 'You knocked!' : 'The stock ran out.';
    renderGame();
    return;
  }
  state.message = `You discarded the ${label(c)}.`;
  scheduleBot();
}

function nextHand() {
  const { match } = state;
  match.recordHand();
  if (match.over) return finishMatch();
  saveProgress();
  state.message = openingMessage();
  state.selected = null;
  renderGame();
  if (match.hand.turn === 'bot') scheduleBot();
}

function finishMatch() {
  const { seed, numHands, name, rivals, match } = state;
  const key = gameKey(seed, numHands);
  store.set('played.' + key, { name, moves: match.moveLog, others: rivals });
  store.remove('progress.' + key);
  showResults(seed, numHands);
}

function renderGame() {
  const { match, selected, message, botBusy, target, sort } = state;
  const h = match.hand;
  const yourTurn = h.turn === 'player' && !botBusy && h.phase !== 'over';
  const canDraw = yourTurn && h.phase === 'draw';
  const canPick = yourTurn && h.phase === 'discard';
  const hand = h.hands.player;
  const a = analyze(hand);
  const after = selected != null ? h.deadwoodAfterDiscard(selected) : null;
  const canKnock = selected != null && h.canKnockWith(selected);
  const running = match.total;

  app.innerHTML = `
  <section class="game">
    <header class="topbar">
      <a class="home-link" href="./" title="Home">Gin Duel</a>
      <div class="chips">
        <span class="chip">Hand ${Math.min(match.handIndex + 1, match.numHands)} / ${match.numHands}</span>
        <span class="chip ${running >= 0 ? 'pos' : 'neg'}">You ${signed(running)}</span>
        ${target ? `<span class="chip target" title="Best score on this deck">${esc(target.name)} ${signed(target.total)}</span>` : ''}
      </div>
    </header>

    <div class="opponent">
      <div class="who"><span class="avatar">🤖</span> Bot <small>${plural(h.hands.bot.length, 'card')}</small></div>
      <div class="fan">${h.hands.bot.map(() => backHtml()).join('')}</div>
    </div>

    <div class="table">
      <button type="button" class="pile stock ${canDraw ? 'live' : ''}" id="stock" ${canDraw ? '' : 'disabled'} aria-label="Draw from stock">
        ${backHtml()}<span class="count">${h.stock.length}</span><span class="pile-label">Stock</span>
      </button>
      <div class="pile discard ${canDraw && h.discardPile.length ? 'live' : ''}">
        ${h.discardPile.length > 1 ? `<div class="under">${backHtml('ghost')}</div>` : ''}
        ${h.discardPile.length ? cardHtml(h.discardTop, { attrs: `id="discardTop" ${canDraw ? '' : 'disabled'}` }) : '<div class="card empty"></div>'}
        <span class="pile-label">Discard</span>
      </div>
    </div>

    <p class="status ${yourTurn ? 'yours' : ''}">${botBusy ? '<span class="dots"></span> ' : ''}${esc(message)}</p>

    <div class="player">
      <div class="hand-head">
        <div class="who"><span class="avatar">🙂</span> ${esc(state.name)}</div>
        <div class="dw">Deadwood <b>${a.deadwood}</b>${hand.length === 11 ? ' <small>(11 cards)</small>' : ''}</div>
        <button type="button" class="btn tiny" id="sortBtn">Sort: ${sort}</button>
      </div>
      <div class="hand ${canPick ? 'pickable' : ''}">
        ${groupsHtml(a, {
          sort,
          cardCls: c => [c === selected ? 'selected' : '', c === h.lastDrawn && h.turn === 'player' ? 'new' : '',
            canPick && !h.canDiscard(c) ? 'locked' : ''].join(' '),
        })}
      </div>
      <div class="actions">
        ${canPick && selected != null ? `
          <span class="hint">Deadwood after: <b>${after}</b></span>
          <button type="button" class="btn" id="discardBtn">Discard ${label(selected)}</button>
          ${canKnock ? `<button type="button" class="btn primary" id="knockBtn">${after === 0 ? 'Gin!' : `Knock (${after})`}</button>` : ''}`
          : canPick ? '<span class="hint">Tap a card to select it, tap again to discard.</span>'
          : canDraw ? '<span class="hint">Tap the stock or the discard pile.</span>' : ''}
      </div>
    </div>
  </section>
  ${h.phase === 'over' ? handOverHtml(h) : ''}`;

  document.getElementById('stock')?.addEventListener('click', () => onDraw('stock'));
  document.getElementById('discardTop')?.addEventListener('click', () => onDraw('discard'));
  document.getElementById('sortBtn').addEventListener('click', () => {
    state.sort = state.sort === 'suit' ? 'rank' : 'suit';
    store.set('sort', state.sort);
    renderGame();
  });
  app.querySelectorAll('.hand .card').forEach(el => el.addEventListener('click', () => onCard(Number(el.dataset.card))));
  document.getElementById('discardBtn')?.addEventListener('click', () => doDiscard(false));
  document.getElementById('knockBtn')?.addEventListener('click', () => doDiscard(true));
  document.getElementById('nextBtn')?.addEventListener('click', nextHand);
}

function handOverHtml(h) {
  const r = h.result;
  const last = state.match.handIndex + 1 >= state.match.numHands;
  const side = (who, title) => {
    const info = r[who];
    const dw = info.deadwood;
    return `<div class="reveal">
      <div class="reveal-head"><b>${title}</b><span>Deadwood ${dw}${info.laid?.length ? ` · laid off ${info.laid.length}` : ''}</span></div>
      <div class="hand small">${groupsHtml(
        { melds: info.melds, deadwoodCards: [...info.deadwoodCards, ...(info.laid || [])] },
        { laid: info.laid || [], cardAttrs: () => 'tabindex="-1"' })}</div>
    </div>`;
  };
  const tone = r.playerScore > 0 ? 'win' : r.playerScore < 0 ? 'loss' : 'even';
  return `<div class="overlay"><div class="modal ${tone}" role="dialog" aria-labelledby="hoTitle">
    <p class="eyebrow">Hand ${h.index + 1} of ${state.match.numHands}</p>
    <h2 id="hoTitle">${esc(resultSentence(r))}</h2>
    <p class="hand-score">This hand: <b class="${r.playerScore > 0 ? 'pos' : r.playerScore < 0 ? 'neg' : ''}">${signed(r.playerScore)}</b></p>
    ${side('player', esc(state.name))}
    ${side('bot', 'Bot')}
    ${r.type === 'knock' || r.type === 'undercut' ? `<p class="math">${r.knocker === 'player' ? 'Your' : 'Bot’s'} deadwood ${r[r.knocker].deadwood} vs ${r.knocker === 'player' ? 'bot’s' : 'your'} ${r[r.knocker === 'player' ? 'bot' : 'player'].deadwood} after lay-offs${r.type === 'undercut' ? ' → undercut bonus 25' : ''}.${r[r.knocker === 'player' ? 'bot' : 'player'].laid.length ? ' <span class="laid-key">Blue</span> = laid off.' : ''}</p>` : ''}
    ${r.type === 'gin' ? '<p class="math">Gin bonus 25 + opponent’s deadwood</p>' : ''}
    <p class="running">Running total: <b class="${state.match.total + r.playerScore >= 0 ? 'pos' : 'neg'}">${signed(state.match.total + r.playerScore)}</b></p>
    <button type="button" class="btn primary big" id="nextBtn">${last ? 'See how you did' : 'Next hand'}</button>
  </div></div>`;
}

// ---------- results ----------
function showResults(seed, numHands) {
  state = { screen: 'results' };
  const key = gameKey(seed, numHands);
  const mine = store.get('played.' + key);
  let list = mergePlayers(mine.others || [], { name: mine.name, moves: mine.moves });
  const verified = verifyPlayers(seed, numHands, list).filter(p => p.valid).sort((a, b) => b.total - a.total);
  const me = verified.find(p => p.moves === mine.moves);
  const others = verified.filter(p => p !== me);
  const url = challengeUrl({ seed, numHands, players: verified.map(p => ({ name: p.name, moves: p.moves })) });
  setHash(url.split('#c=')[1]);

  // Remember in recent list
  const recent = store.get('recent', []).filter(r => r.key !== key);
  recent.unshift({ key, code: url.split('#c=')[1], total: me.total,
    title: seed.startsWith('daily-') ? `Daily deck ${seed.slice(6)}` : `${plural(numHands, 'hand')} · ${others.length ? 'vs ' + others.map(o => o.name).join(', ') : 'no rivals yet'}` });
  store.set('recent', recent.slice(0, 10));

  let headline, sub;
  if (!others.length) {
    headline = `You finished ${signed(me.total)} against the bot`;
    sub = 'Now send this exact deck to someone and see if they can beat you.';
  } else {
    const rank = verified.indexOf(me) + 1;
    const rival = others[0];
    if (rank === 1) {
      const margin = me.total - rival.total;
      headline = margin === 0 ? `Dead even with ${esc(rival.name)}` : `You beat ${esc(rival.name)} by ${margin}`;
    } else {
      const leader = verified[0];
      headline = `${esc(leader.name)} beat you by ${leader.total - me.total}`;
    }
    sub = `Same deck, same bot. You finished ${signed(me.total)}.` + (others.length > 1 ? ` You placed #${rank} of ${verified.length}.` : '');
  }

  app.innerHTML = `
  <section class="panel results">
    <p class="eyebrow">Gin Duel · ${seed.startsWith('daily-') ? 'Daily deck ' + esc(seed.slice(6)) : plural(numHands, 'hand')}</p>
    <h1>${headline}</h1>
    <p class="tagline">${sub}</p>
    <div class="table-wrap"><table class="scores">
      <thead><tr><th>Player</th>${Array.from({ length: numHands }, (_, i) => `<th>H${i + 1}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${verified.map((p, i) => `<tr class="${p === me ? 'me' : ''}">
        <td><span class="place">${i + 1}</span>${esc(p.name)}${p === me ? ' <small>(you)</small>' : ''}</td>
        ${p.results.map(r => `<td><b class="${r.playerScore > 0 ? 'pos' : r.playerScore < 0 ? 'neg' : ''}">${signed(r.playerScore)}</b><small class="tag ${typeTag(r)}">${typeTag(r)}</small></td>`).join('')}
        <td class="total ${p.total >= 0 ? 'pos' : 'neg'}">${signed(p.total)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="share">
      <h3>${others.length ? 'Send the updated standings' : 'Challenge someone'}</h3>
      <p>Anyone who opens this link plays the identical deck. Their score is added to the table, so have them send the link back.</p>
      <div class="share-row"><input id="shareUrl" readonly value="${esc(url)}" aria-label="Challenge link">
        <button class="btn primary" id="copyBtn" type="button">Copy link</button></div>
      ${navigator.share ? '<button class="btn" id="nativeShare" type="button">Share…</button>' : ''}
    </div>
    <div class="row-buttons"><a class="btn ghost" href="./" id="newBtn">Start a new duel</a></div>
    <details class="rules"><summary>How scoring works</summary>${rulesHtml()}</details>
  </section>`;

  const shareText = `I scored ${signed(me.total)} against the bot in Gin Duel. Same deck — can you beat me?`;
  document.getElementById('copyBtn').addEventListener('click', async () => {
    const input = document.getElementById('shareUrl');
    try { await navigator.clipboard.writeText(input.value); toast('Link copied — send it to your rival.'); }
    catch { input.select(); toast('Select the link and copy it.'); }
  });
  document.getElementById('nativeShare')?.addEventListener('click', () => {
    navigator.share({ title: 'Gin Duel challenge', text: shareText, url }).catch(() => {});
  });
  document.getElementById('newBtn').addEventListener('click', e => { e.preventDefault(); setHash(null); showHome(); });
}

window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const a = e.target.closest('a[href="./"]');
  if (a && a.id !== 'newBtn') { e.preventDefault(); setHash(null); route(); }
});
route();
