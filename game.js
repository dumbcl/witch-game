'use strict';

const ACTION_LIMIT = 24;
const FINAL_DECK = 13;
const STORAGE_KEY = 'witch-investigation-v1';
const FINAL_LINKS = {
  a: { url: 'https://hobbyworld.ru/download/questions-four-01.pdf', label: 'Открыть вопросы ↗' },
  b: { url: 'https://hobbyworld.ru/download/answers-four-01.pdf', label: 'Открыть ответы ↗' },
};

const elements = Object.fromEntries([
  'intro', 'board', 'tools', 'decks', 'remaining', 'progress', 'announcement',
  'solo', 'board-title', 'board-guide', 'finish-banner', 'finish-heading',
  'finish-copy', 'finish', 'restart', 'rules', 'rules-button', 'zoom', 'zoom-title', 'zoom-image',
].map(id => [id, document.getElementById(id)]));

function newGame() {
  return { opened: [], cards: {}, ended: false };
}

function cardKey(deck, card) {
  return `${deck}-${card.number}`;
}

function remainingActions(game) {
  return DECKS.reduce((remaining, cards, index) => {
    for (const card of cards) {
      if (game.cards[cardKey(index + 1, card)]) remaining -= card.cost;
    }
    return remaining;
  }, ACTION_LIMIT);
}

function readGame(saved) {
  if (!saved || !Array.isArray(saved.opened) || !saved.cards) return null;

  const state = newGame();
  for (const deck of new Set(saved.opened)) {
    if (!Number.isInteger(deck) || !DECKS[deck - 1]) continue;
    state.opened.push(deck);
    for (const card of DECKS[deck - 1]) {
      const key = cardKey(deck, card);
      if (['a', 'b'].includes(saved.cards[key])) state.cards[key] = saved.cards[key];
    }
  }

  const remaining = remainingActions(state);
  if (remaining < 0) return null;
  state.ended = remaining === 0 && state.opened.includes(FINAL_DECK) && saved.ended === true;
  return state;
}

function restoreGame() {
  try {
    return readGame(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return null;
  }
}

let game = null;
let onlineGame = null;
const deckViews = new Map();

function saveGame() {
  if (onlineGame) {
    onlineGame.publish();
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  } catch {
    // The current game still works when the browser disables storage.
  }
}

function cardSide(deck, card) {
  return game.cards[cardKey(deck, card)] || 'a';
}

function updateBoard() {
  const remaining = remainingActions(game);
  const stopped = remaining === 0;
  const blocked = onlineGame && !onlineGame.canPlay();
  elements.remaining.textContent = remaining;
  elements.progress.value = remaining;
  elements['finish-banner'].hidden = !stopped;
  elements.finish.hidden = !stopped || game.ended;
  elements.finish.disabled = Boolean(blocked);
  elements.restart.hidden = !game.ended || Boolean(onlineGame && !onlineGame.isHost);
  elements['finish-heading'].textContent = game.ended ? 'Расследование завершено' : 'Действия закончились';
  elements['finish-copy'].textContent = game.ended
    ? 'Обсудите ответы на вопросы и сверьте их с решением в колоде 13.'
    : 'Перейдите к вопросам из колоды 13 и обсудите ваши версии.';
  elements['board-guide'].hidden = stopped;

  for (const [deck, view] of deckViews) {
    if (view.button) view.button.disabled = Boolean(blocked || (stopped && deck !== FINAL_DECK));
    if (view.cards) {
      for (const { face } of view.cards) {
        face.setAttribute('aria-disabled', String(Boolean(blocked || (stopped && deck !== FINAL_DECK))));
      }
    }
  }
}

function closedDeckButton(deck) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'deck-button';
  button.setAttribute('aria-label', `Разложить колоду ${deck}`);
  button.innerHTML = `
    <span class="deck-index" aria-hidden="true">${String(deck).padStart(2, '0')}</span>
    <span class="deck-label">Разложить колоду ${deck}</span>
    <span class="deck-arrow" aria-hidden="true">→</span>`;
  button.addEventListener('click', () => playAction({ type: 'open', deck }));
  return button;
}

function updateCard(deck, view) {
  const { card, face, image, status, link } = view;
  const key = cardKey(deck, card);
  const side = cardSide(deck, card);
  const sideLabel = side.toUpperCase();
  const nextSide = side === 'a' ? 'B' : 'A';
  const cost = game.cards[key] ? 0 : card.cost;
  image.src = `assets/${card[side]}`;
  image.alt = `Карта ${key}, сторона ${sideLabel}`;
  face.setAttribute('aria-label', `Карта ${key}, сторона ${sideLabel}. Перевернуть на ${nextSide}${cost ? ', 1 действие' : ''}`);
  status.textContent = cost ? '1 действие' : `Сторона ${sideLabel}`;
  status.classList.toggle('paid', cost > 0);
  if (link) {
    link.href = FINAL_LINKS[side].url;
    link.textContent = FINAL_LINKS[side].label;
  }
}

function createCard(deck, card) {
  const key = cardKey(deck, card);
  const figure = document.createElement('figure');
  figure.className = 'game-card';
  figure.innerHTML = `
    <button type="button" class="card-face"><img width="570" height="852" decoding="async" alt=""></button>
    <figcaption class="card-meta">
      <span class="card-number">${key}</span>
      <span class="card-status"></span>
      <button type="button" class="zoom-button" aria-label="Увеличить карту ${key}">⤢</button>
    </figcaption>`;

  const view = {
    card,
    face: figure.querySelector('.card-face'),
    image: figure.querySelector('img'),
    status: figure.querySelector('.card-status'),
  };
  if (deck === FINAL_DECK && card.number === 1) {
    view.link = document.createElement('a');
    view.link.className = 'final-link';
    view.link.target = '_blank';
    view.link.rel = 'noopener noreferrer';
    figure.append(view.link);
  }

  view.face.addEventListener('click', () => playAction({
    type: 'flip', deck, number: card.number, side: cardSide(deck, card),
  }));
  figure.querySelector('.zoom-button').addEventListener('click', () => {
    elements['zoom-title'].textContent = view.image.alt;
    elements['zoom-image'].src = view.image.src;
    elements['zoom-image'].alt = view.image.alt;
    elements.zoom.showModal();
  });
  updateCard(deck, view);
  return { figure, view };
}

function renderOpenedDeck(deck) {
  const { section } = deckViews.get(deck);
  const title = document.createElement('div');
  title.className = 'deck-heading';
  title.innerHTML = `<h2 tabindex="-1">Колода ${deck}</h2>${deck === FINAL_DECK ? '<small>Финал</small>' : ''}`;
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  const cards = DECKS[deck - 1].map(card => {
    const { figure, view } = createCard(deck, card);
    grid.append(figure);
    return view;
  });

  section.classList.add('expanded');
  section.replaceChildren(title, grid);
  deckViews.set(deck, { section, cards });
  return title.querySelector('h2');
}

function renderGame() {
  elements.intro.hidden = true;
  elements.board.hidden = false;
  elements.tools.hidden = false;
  elements.decks.replaceChildren();
  deckViews.clear();

  for (let deck = 1; deck <= DECKS.length; deck += 1) {
    const section = document.createElement('section');
    section.className = 'deck';
    elements.decks.append(section);
    deckViews.set(deck, { section });
    if (game.opened.includes(deck)) {
      renderOpenedDeck(deck);
    } else {
      const button = closedDeckButton(deck);
      section.append(button);
      deckViews.get(deck).button = button;
    }
  }
  updateBoard();
}

function applyGameAction(action, focus = false) {
  if (!game || !action || typeof action !== 'object') return false;
  const { type, deck, number, side } = action;
  const remaining = remainingActions(game);

  if (type === 'finish') {
    if (remaining !== 0 || game.ended) return false;
    if (!game.opened.includes(FINAL_DECK)) {
      game.opened.push(FINAL_DECK);
      renderOpenedDeck(FINAL_DECK);
    }
    game.ended = true;
    if (focus) focusDeck(FINAL_DECK, 'start');
  } else {
    if (!Number.isInteger(deck) || !DECKS[deck - 1] || (remaining === 0 && deck !== FINAL_DECK)) {
      return false;
    }
    const opened = game.opened.includes(deck);
    if (type === 'open' && !opened) {
      game.opened.push(deck);
      renderOpenedDeck(deck);
      if (focus) focusDeck(deck);
    } else if (type === 'flip' && opened) {
      const view = deckViews.get(deck).cards.find(({ card }) => card.number === number);
      if (!view || cardSide(deck, view.card) !== side) return false;
      const key = cardKey(deck, view.card);
      game.cards[key] = side === 'a' ? 'b' : 'a';
      updateCard(deck, view);
      playCardFlipSound();
      const left = remainingActions(game);
      elements.announcement.textContent = left === 0 && deck !== FINAL_DECK
        ? 'Действия закончились. Перейдите к колоде 13.'
        : `Карта ${key}, сторона ${game.cards[key].toUpperCase()}. Осталось действий: ${left}.`;
      updateBoard();
      if (focus && left === 0 && deck !== FINAL_DECK) elements['finish-heading'].focus();
    } else {
      return false;
    }
  }
  saveGame();
  updateBoard();
  return true;
}

function focusDeck(deck, block = 'nearest') {
  const { section } = deckViews.get(deck);
  section.querySelector('h2').focus({ preventScroll: true });
  section.scrollIntoView({ block });
}

function playAction(action) {
  if (onlineGame && !onlineGame.isHost) {
    onlineGame.request(action);
    return;
  }
  applyGameAction(action, true);
}

function syncGame(state) {
  const previous = game;
  game = state;
  if (!state) {
    elements.board.hidden = true;
    elements.tools.hidden = true;
    elements.announcement.textContent = '';
    return;
  }
  if (!previous) {
    renderGame();
    return;
  }
  let flipped = false;
  for (const deck of state.opened) {
    const view = deckViews.get(deck);
    if (view.button) {
      renderOpenedDeck(deck);
      continue;
    }
    for (const cardView of view.cards) {
      const key = cardKey(deck, cardView.card);
      if (state.cards[key] !== previous.cards[key]) {
        updateCard(deck, cardView);
        flipped ||= (state.cards[key] || 'a') !== (previous.cards[key] || 'a');
      }
    }
  }
  if (flipped) playCardFlipSound();
  updateBoard();
}

elements.solo.addEventListener('click', () => {
  game = restoreGame() || newGame();
  saveGame();
  renderGame();
  elements['board-title'].focus();
});

elements.finish.addEventListener('click', () => playAction({ type: 'finish' }));

elements.restart.addEventListener('click', () => {
  if (onlineGame) {
    onlineGame.reset();
    return;
  }
  game = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Starting a new game does not require browser storage.
  }
  elements.board.hidden = true;
  elements.tools.hidden = true;
  elements.intro.hidden = false;
  elements.announcement.textContent = '';
  elements.solo.textContent = 'Играть одному';
  elements.solo.focus();
  window.scrollTo(0, 0);
});

elements['rules-button'].addEventListener('click', () => elements.rules.showModal());
for (const dialog of [elements.rules, elements.zoom]) {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const { left, top, right, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
      dialog.close();
    }
  });
}

if (restoreGame()) elements.solo.textContent = 'Продолжить одиночную игру';
