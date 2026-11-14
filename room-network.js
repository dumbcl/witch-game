'use strict';

const DIRECTORY_TOPIC = 'witch-game.ru/rooms/v1/directory';
const INBOX_ROOT = 'witch-game.ru/rooms/v1/inbox';
const ROOM_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const ROOM_HEARTBEAT = 6000;
const ROOM_EXPIRY = 26000;
const MAX_PLAYERS = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const isRoomId = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const isPublicKey = value => typeof value === 'string' && /^[A-Za-z0-9+/]{87}=$/.test(value);
const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

async function roomKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const publicKey = toBase64(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey };
}

async function roomChannel(privateKey, publicKey) {
  if (!isPublicKey(publicKey)) throw new Error('Некорректный ключ комнаты.');
  const remote = await crypto.subtle.importKey('raw', fromBase64(publicKey),
    { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: remote }, privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptRoomMessage(key, from, to, message) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const frame = { name: 'AES-GCM', iv, additionalData: encoder.encode(`${from}:${to}`) };
  const payload = await crypto.subtle.encrypt(frame, key, encoder.encode(JSON.stringify(message)));
  return { from, to, iv: toBase64(iv), data: toBase64(payload) };
}

async function decryptRoomMessage(key, envelope) {
  if (typeof envelope.iv !== 'string' || envelope.iv.length !== 16 ||
      typeof envelope.data !== 'string' || envelope.data.length > 8192) return null;
  try {
    const frame = {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encoder.encode(`${envelope.from}:${envelope.to}`),
    };
    const payload = await crypto.subtle.decrypt(frame, key, fromBase64(envelope.data));
    return JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
}

class RoomNetwork extends EventTarget {
  constructor(mqtt) {
    super();
    this.id = crypto.randomUUID();
    this.inbox = `${INBOX_ROOT}/${this.id}`;
    this.ready = false;
    this.client = mqtt.connect(ROOM_BROKER, {
      clientId: `witch-${this.id}`,
      connectTimeout: 7000,
      reconnectPeriod: 3000,
      keepalive: 15,
      queueQoSZero: false,
      resubscribe: false,
      clean: true,
    });
    this.client.on('connect', async () => {
      try {
        await this.client.subscribeAsync([DIRECTORY_TOPIC, this.inbox]);
        if (this.client.connected) this.setReady(true);
      } catch {
        this.setReady(false);
      }
    });
    this.client.on('close', () => this.setReady(false));
    this.client.on('error', () => {
      if (!this.client.connected) this.setReady(false);
    });
    this.client.on('message', (topic, payload, packet) => {
      if (packet.retain || payload.length > 9000) return;
      let data;
      try {
        data = JSON.parse(payload.toString());
      } catch {
        return;
      }
      if (!data || !isRoomId(data.from) || data.from === this.id) return;
      if (topic === DIRECTORY_TOPIC) {
        this.dispatchEvent(new CustomEvent('directory', { detail: data }));
      } else if (topic === this.inbox && data.to === this.id) {
        this.dispatchEvent(new CustomEvent('envelope', { detail: data }));
      }
    });
  }

  setReady(ready) {
    if (this.ready === ready) return;
    this.ready = ready;
    this.dispatchEvent(new Event('connection'));
  }

  async waitUntilReady() {
    if (this.ready) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeEventListener('connection', onConnect);
        reject(new Error('Сеть игр недоступна. Попробуйте снова.'));
      }, 9500);
      const onConnect = () => {
        if (!this.ready) return;
        clearTimeout(timer);
        this.removeEventListener('connection', onConnect);
        resolve();
      };
      this.addEventListener('connection', onConnect);
    });
  }

  announce(message) {
    if (this.ready) this.client.publish(DIRECTORY_TOPIC, JSON.stringify({ ...message, from: this.id }));
  }

  async send(to, key, message, publicKey) {
    if (!this.ready) return;
    const envelope = await encryptRoomMessage(key, this.id, to, message);
    if (publicKey) envelope.publicKey = publicKey;
    if (this.ready) this.client.publish(`${INBOX_ROOT}/${to}`, JSON.stringify(envelope));
  }
}
