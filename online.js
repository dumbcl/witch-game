'use strict';

const JOIN_TIMEOUT = 13000;
const online = Object.fromEntries([
  'create-room', 'join-room', 'online-dialog', 'online-title', 'create-form',
  'new-room-name', 'new-room-password', 'room-list', 'join-form', 'join-password',
  'back-to-rooms', 'online-status', 'room-panel', 'room-name', 'room-status',
  'room-players', 'room-count', 'player-count', 'leave-room', 'start',
].map(id => [id, document.getElementById(id)]));

let networkPromise;
let selectedRoom;
let joining;
let screen;

let network;
const listings = new Map();

async function connectDirectory() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
    throw new Error('Для онлайн-игры откройте сайт по HTTPS.');
  }
  networkPromise ??= import('./vendor/mqtt-5.14.1.mjs').then(({ default: mqtt }) => {
    network = new RoomNetwork(mqtt);
    network.addEventListener('directory', ({ detail }) => receiveListing(detail));
    network.addEventListener('envelope', ({ detail }) => {
      const session = onlineGame || joining;
      session?.receive(detail).catch(console.warn);
    });
    network.addEventListener('connection', () => {
      renderRoomList();
      if (onlineGame) {
        renderRoom();
        if (game) updateBoard();
        onlineGame.heartbeat();
      }
      if (network.ready && screen === 'list') network.announce({ type: 'search' });
    });
    setInterval(() => {
      const now = Date.now();
      for (const [id, room] of listings) {
        if (room.expires < now) listings.delete(id);
      }
      if (onlineGame) onlineGame.heartbeat();
      renderRoomList();
    }, ROOM_HEARTBEAT);
    return network;
  }).catch(() => {
    networkPromise = null;
    throw new Error('Не удалось запустить онлайн-игру. Попробуйте снова.');
  });
  return networkPromise;
}

function receiveListing(message) {
  if (message.type === 'search') {
    if (onlineGame?.isHost) announceRoom(onlineGame);
    return;
  }
  const { from, id, name, count, publicKey } = message;
  if (!isRoomId(id) || !isPublicKey(publicKey)) return;
  const previous = listings.get(id);
  if (previous && (previous.host !== from || previous.publicKey !== publicKey)) return;
  if (message.type === 'closed') {
    listings.delete(id);
  } else if (message.type === 'list' && typeof name === 'string' && name.trim() &&
      name.length <= 64 && Number.isInteger(count) && count >= 1 && count <= MAX_PLAYERS) {
    if (listings.size >= 100 && !previous) return;
    listings.set(id, { id, host: from, name, count, publicKey,
      started: message.started === true, expires: Date.now() + ROOM_EXPIRY });
  }
  renderRoomList();
}

function getListedRooms() {
  return [...listings.values()].filter(room => room.expires > Date.now())
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function renderRoomList() {
  if (screen !== 'list' || !online['online-dialog'].open) return;
  const list = online['room-list'];
  const rooms = getListedRooms();
  const focusedRoom = list.contains(document.activeElement) ? document.activeElement.dataset.room : null;
  const entries = rooms.map(room => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'room-choice';
    button.dataset.room = room.id;
    button.disabled = room.count >= MAX_PLAYERS;
    const title = document.createElement('strong');
    title.textContent = room.name;
    const description = document.createElement('span');
    description.textContent = `${room.started ? 'Игра идёт' : 'Ожидание игроков'} · ${room.count}/${MAX_PLAYERS}${button.disabled ? ' · Комната заполнена' : ''}`;
    button.append(title, description);
    button.addEventListener('click', () => {
      selectedRoom = room;
      online['join-password'].value = '';
      showOnlineScreen('password');
      online['join-password'].focus();
    });
    item.append(button);
    return item;
  });
  list.replaceChildren(...entries);
  if (focusedRoom) {
    Array.from(list.querySelectorAll('button')).find(button => button.dataset.room === focusedRoom)?.focus();
  }
  const status = online['online-status'];
  if (rooms.length) {
    status.textContent = '';
  } else if (!network?.ready) {
    status.textContent = 'Подключаемся к списку игр…';
  } else {
    status.textContent = 'Пока нет доступных игр. Список обновляется автоматически.';
  }
}

function showOnlineScreen(next) {
  screen = next;
  online['online-title'].textContent = {
    create: 'Создать игру',
    list: 'Подключиться к игре',
    password: selectedRoom?.name,
  }[next];
  online['create-form'].hidden = next !== 'create';
  online['room-list'].hidden = next !== 'list';
  online['join-form'].hidden = next !== 'password';
  online['online-status'].textContent = '';
  if (!online['online-dialog'].open) online['online-dialog'].showModal();
  if (next === 'list') renderRoomList();
}

function announceRoom(session) {
  network.announce({
    type: 'list',
    id: session.id,
    publicKey: session.publicKey,
    name: session.name,
    count: 1 + session.guests.size,
    started: Boolean(game),
  });
}

function renderRoom() {
  const session = onlineGame;
  if (!session) return;
  online['room-panel'].hidden = false;
  online['room-name'].textContent = session.name;
  online['room-status'].textContent = !network.ready
    ? 'Восстанавливаем соединение…'
    : !session.canPlay()
      ? 'Связь с хостом потеряна. Подключитесь к комнате снова.'
      : session.isHost
        ? 'Вы хост. Держите эту вкладку открытой.'
        : game ? 'Вы в игре' : 'Ожидаем начала игры';
  const seats = session.isHost ? [1, ...guestSeats(session)] : session.seats;
  online['room-count'].textContent = `${seats.length} / ${MAX_PLAYERS}`;
  const playerCount = online['player-count'];
  const summary = !network.ready || !session.canPlay()
    ? online['room-status'].textContent
    : `Игроки ${seats.length}/${MAX_PLAYERS}`;
  if (playerCount.textContent !== summary) playerCount.textContent = summary;
  playerCount.hidden = !game;
  online['room-players'].replaceChildren(...seats.sort((a, b) => a - b).map(seat => {
    const player = document.createElement('li');
    const ownSeat = seat === (session.isHost ? 1 : session.seat);
    player.textContent = `${seat === 1 ? 'Хост' : `Игрок ${seat}`}${ownSeat ? ' · вы' : ''}`;
    return player;
  }));
  online.start.hidden = !session.isHost || Boolean(game);
}

function enterRoom(session) {
  onlineGame = session;
  elements.intro.hidden = true;
  online['online-dialog'].close();
  renderRoom();
  online['room-name'].focus();
  window.scrollTo(0, 0);
}

function reportError(error) {
  online['online-status'].textContent = error.message;
}

function guestSeats(session) {
  return [...session.guests.values()].map(guest => guest.seat);
}

async function createSession(name, password) {
  const { privateKey, publicKey } = await roomKeys();
  const id = crypto.randomUUID();
  let revision = 0;
  const admissions = new Set();

  const session = {
    id, name, publicKey,
    isHost: true,
    guests: new Map(),
    canPlay: () => true,
    async receive(envelope) {
      let guest = session.guests.get(envelope.from);
      if (!guest) {
        if (!isPublicKey(envelope.publicKey) || admissions.size >= 8 || admissions.has(envelope.from)) return;
        admissions.add(envelope.from);
        try {
          const key = await roomChannel(privateKey, envelope.publicKey);
          const message = await decryptRoomMessage(key, envelope);
          if (onlineGame !== session || message?.type !== 'join' || message.room !== id) return;
          if (message.password !== password) {
            await network.send(envelope.from, key, { type: 'rejected', reason: 'password', room: id });
            return;
          }
          if (session.guests.size >= MAX_PLAYERS - 1) {
            await network.send(envelope.from, key, { type: 'rejected', reason: 'full', room: id });
            return;
          }
          const occupied = guestSeats(session);
          const seat = [2, 3, 4].find(number => !occupied.includes(number));
          guest = { key, seat, sequence: 0, seen: Date.now(), inbound: Promise.resolve() };
          session.guests.set(envelope.from, guest);
          session.publish();
          announceRoom(session);
        } finally {
          admissions.delete(envelope.from);
        }
        return;
      }

      guest.inbound = guest.inbound.then(() => receiveGuestMessage(envelope, guest)).catch(console.warn);
    },
    publish() {
      revision += 1;
      renderRoom();
      for (const [peer, guest] of session.guests) sendSnapshot(peer, guest).catch(console.warn);
    },
    heartbeat() {
      const before = session.guests.size;
      for (const [peer, guest] of session.guests) {
        if (Date.now() - guest.seen > ROOM_EXPIRY * 2) session.guests.delete(peer);
      }
      if (before !== session.guests.size) session.publish();
      announceRoom(session);
    },
    reset() {
      syncGame(null);
      session.publish();
      announceRoom(session);
      online.start.focus();
    },
    leave() {
      network.announce({ type: 'closed', id, publicKey });
      for (const [peer, guest] of session.guests) {
        network.send(peer, guest.key, { type: 'closed', room: id }).catch(console.warn);
      }
    },
  };

  async function receiveGuestMessage(envelope, guest) {
    const peer = envelope.from;
    const message = await decryptRoomMessage(guest.key, envelope);
    if (!message || onlineGame !== session || session.guests.get(peer) !== guest || message.room !== id) return;
    if (message.type === 'join') {
      await sendSnapshot(peer, guest);
      return;
    }
    if (!Number.isSafeInteger(message.sequence) || message.sequence <= guest.sequence) return;
    guest.sequence = message.sequence;
    guest.seen = Date.now();
    if (message.type === 'leave') {
      session.guests.delete(peer);
      session.publish();
      announceRoom(session);
    } else if (message.type === 'action') {
      if (!applyGameAction(message.action)) await sendSnapshot(peer, guest);
    } else if (message.type === 'ping') {
      await sendSnapshot(peer, guest);
    }
  }

  function sendSnapshot(peer, guest) {
    return network.send(peer, guest.key, {
      type: 'snapshot', room: id, revision, state: game, seat: guest.seat,
      seats: [1, ...guestSeats(session)],
    });
  }

  return session;
}

function acceptSnapshot(session, update) {
  if (!Number.isSafeInteger(update.revision) || update.revision < session.revision ||
      !Array.isArray(update.seats) || update.seats.length > MAX_PLAYERS ||
      ![2, 3, 4].includes(update.seat) || !update.seats.includes(update.seat) ||
      !update.seats.includes(1) || new Set(update.seats).size !== update.seats.length ||
      !update.seats.every(seat => [1, 2, 3, 4].includes(seat))) return false;

  const state = update.state === null ? null : readGame(update.state);
  if (!state && update.state !== null) return false;
  session.seen = Date.now();
  session.seat = update.seat;
  session.seats = update.seats;
  if (update.revision > session.revision) {
    session.revision = update.revision;
    const starting = !game && state;
    syncGame(state);
    if (starting) elements['board-title'].focus();
  }
  renderRoom();
  if (game) updateBoard();
  return true;
}

async function joinSession(listed, password) {
  const { privateKey, publicKey } = await roomKeys();
  const key = await roomChannel(privateKey, listed.publicKey);
  if (screen !== 'password' || selectedRoom !== listed || !online['online-dialog'].open) return;

  await new Promise((resolve, reject) => {
    let sequence = 0;
    let outbound = Promise.resolve();
    const send = message => {
      const frame = { ...message, room: listed.id, sequence: ++sequence };
      outbound = outbound.then(() => network.send(listed.host, key, frame)).catch(console.warn);
    };
    const session = {
      name: listed.name, isHost: false, revision: -1, seats: [1], seen: 0, closed: false,
      canPlay: () => network.ready && !session.closed && Date.now() - session.seen <= ROOM_EXPIRY,
      async receive(envelope) {
        if (envelope.from !== listed.host) return;
        const message = await decryptRoomMessage(key, envelope);
        if (!message || message.room !== listed.id) return;
        if (onlineGame === session) {
          if (message.type === 'closed') {
            session.closed = true;
            renderRoom();
            if (game) updateBoard();
          } else if (message.type === 'snapshot' && !session.closed) {
            acceptSnapshot(session, message);
          }
          return;
        }
        if (joining !== session) return;
        if (message.type === 'rejected') {
          fail(message.reason === 'full' ? 'В комнате уже четыре игрока.' : 'Неверный пароль.');
        } else if (message.type === 'snapshot' && [2, 3, 4].includes(message.seat)) {
          clearJoin();
          session.seen = Date.now();
          enterRoom(session);
          acceptSnapshot(session, message);
          resolve();
        }
      },
      request(action) {
        if (session.canPlay()) send({ type: 'action', action });
      },
      heartbeat() {
        if (session.closed) return;
        send({ type: 'ping' });
        if (!session.canPlay()) {
          renderRoom();
          if (game) updateBoard();
        }
      },
      leave: () => send({ type: 'leave' }),
      cancel: () => fail(''),
    };
    function clearJoin() {
      clearTimeout(timer);
      clearInterval(retry);
      joining = null;
    }
    function fail(message) {
      if (joining !== session) return;
      clearJoin();
      session.leave();
      reject(new Error(message));
    }
    const sendJoin = () => network.send(listed.host, key,
      { type: 'join', room: listed.id, password }, publicKey).catch(console.warn);
    const timer = setTimeout(() => fail('Хост не ответил. Попробуйте подключиться снова.'), JOIN_TIMEOUT);
    const retry = setInterval(sendJoin, 2500);
    joining = session;
    sendJoin();
  });
}

online['create-room'].addEventListener('click', () => {
  showOnlineScreen('create');
  online['new-room-name'].focus();
});

online['join-room'].addEventListener('click', () => {
  showOnlineScreen('list');
  connectDirectory().then(async connection => {
    await connection.waitUntilReady();
    if (screen === 'list') {
      connection.announce({ type: 'search' });
      renderRoomList();
    }
  }).catch(error => {
    if (screen === 'list') reportError(error);
  });
});

online['back-to-rooms'].addEventListener('click', () => {
  if (joining) joining.cancel();
  showOnlineScreen('list');
});

online['online-dialog'].addEventListener('close', () => {
  if (online['online-dialog'].open) return;
  if (joining) joining.cancel();
  screen = null;
  online['new-room-password'].value = '';
  online['join-password'].value = '';
});

online['create-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const name = online['new-room-name'].value.trim();
  if (!name) {
    reportError(new Error('Введите название игры.'));
    online['new-room-name'].focus();
    return;
  }
  const password = online['new-room-password'].value;
  const submit = event.submitter;
  submit.disabled = true;
  online['online-status'].textContent = 'Открываем комнату…';
  try {
    const connection = await connectDirectory();
    await connection.waitUntilReady();
    const session = await createSession(name, password);
    if (screen !== 'create' || !online['online-dialog'].open) return;
    enterRoom(session);
    announceRoom(session);
    online['create-form'].reset();
  } catch (error) {
    if (screen === 'create') reportError(error);
  } finally {
    submit.disabled = false;
  }
});

online['join-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (joining || !selectedRoom || !network) return;
  const listed = selectedRoom;
  const submit = event.submitter;
  submit.disabled = true;
  online['online-status'].textContent = 'Подключаемся к хосту…';
  try {
    await joinSession(listed, online['join-password'].value);
  } catch (error) {
    if (screen === 'password' && selectedRoom === listed) reportError(error);
  } finally {
    submit.disabled = false;
  }
});

online.start.addEventListener('click', () => {
  if (!onlineGame?.isHost || game) return;
  syncGame(newGame());
  onlineGame.publish();
  announceRoom(onlineGame);
  elements['board-title'].focus();
});

online['leave-room'].addEventListener('click', () => {
  const session = onlineGame;
  if (!session) return;
  onlineGame = null;
  session.leave();
  syncGame(null);
  online['room-panel'].hidden = true;
  online['player-count'].hidden = true;
  elements.intro.hidden = false;
  online['join-room'].focus();
  window.scrollTo(0, 0);
});

window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    onlineGame?.leave();
    if (joining) joining.cancel();
  }
});
