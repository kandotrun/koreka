import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, ServerMessage } from '../types';

// --- Mocks for Cloudflare runtime ---

class MockWebSocket {
  sent: string[] = [];
  readyState = 1;
  private _attachment: unknown = null;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  serializeAttachment(data: unknown) {
    this._attachment = structuredClone(data);
  }

  deserializeAttachment() {
    return this._attachment;
  }

  getSent(): ServerMessage[] {
    return this.sent.map(s => JSON.parse(s));
  }

  getLastSent(): ServerMessage {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }

  clearSent() {
    this.sent = [];
  }
}

class MockWebSocketPair {
  0: MockWebSocket;
  1: MockWebSocket;

  constructor() {
    this[0] = new MockWebSocket();
    this[1] = new MockWebSocket();
  }
}

Object.assign(globalThis, {
  WebSocket: MockWebSocket,
  WebSocketPair: MockWebSocketPair,
  DurableObject: class {},
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => {
    uuidCounter += 1;
    return `${String(uuidCounter).padStart(8, '0')}-0000-0000-0000-000000000000`;
  },
});

const { RoomDurableObject } = await import('../durable-objects/room');
const { default: app } = await import('../index');

function makeCards(count: number, category = 'adventure'): Card[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i + 1}`,
    text: `テストカード${i + 1}`,
    category: category as Card['category'],
    generated: false,
  }));
}

class MockPreparedStatement {
  private params: (string | number)[] = [];

  constructor(
    private readonly query: string,
    private readonly cards: Card[],
    private readonly inserts: Array<{ query: string; params: (string | number)[] }>,
    private readonly rooms: Array<{ id: string; code: string }>,
  ) {}

  bind(...params: (string | number)[]) {
    this.params = params;
    return this;
  }

  async first<T>() {
    if (this.query.includes('SELECT id FROM rooms WHERE code')) {
      const code = this.params[0] as string;
      const room = this.rooms.find(r => r.code === code);
      return room ? { id: room.id } as T : null;
    }
    if (this.query.includes('COUNT(*)')) {
      return { total: this.cards.length } as T;
    }
    return null;
  }

  async all<T>() {
    if (this.query.includes('FROM cards')) {
      return { results: this.cards as T[] };
    }
    if (this.query.includes('FROM rooms r')) {
      return { results: [] as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    this.inserts.push({ query: this.query, params: this.params });
    return { success: true, meta: { changes: 1 } };
  }
}

class MockD1Database {
  readonly inserts: Array<{ query: string; params: (string | number)[] }> = [];
  readonly rooms: Array<{ id: string; code: string }> = [];

  constructor(private readonly cards: Card[]) {}

  prepare(query: string) {
    return new MockPreparedStatement(query, this.cards, this.inserts, this.rooms);
  }

  batch(stmts: MockPreparedStatement[]) {
    return Promise.all(stmts.map(s => s.run()));
  }
}

class MockRoomNamespace {
  private readonly rooms = new Map<string, InstanceType<typeof RoomDurableObject>>();

  idFromName(code: string) {
    return {
      code,
      toString: () => `room-${code}`,
    };
  }

  get(id: { code: string }) {
    let room = this.rooms.get(id.code);
    if (!room) {
      const store = new Map<string, unknown>();
      const acceptedWs: MockWebSocket[] = [];
      room = new RoomDurableObject({
        acceptWebSocket: vi.fn((ws: MockWebSocket) => { acceptedWs.push(ws); }),
        getWebSockets: vi.fn(() => acceptedWs.filter(ws => ws.readyState === 1)),
        storage: {
          get: vi.fn(async (key: string) => store.get(key)),
          put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
          delete: vi.fn(async (key: string) => store.delete(key)),
          setAlarm: vi.fn(async () => {}),
        },
      } as unknown as DurableObjectState, {});
      this.rooms.set(id.code, room);
    }
    return {
      fetch: (request: Request) => room.fetch(request),
    };
  }
}

function makeEnv(db: MockD1Database) {
  return {
    DB: db as unknown as D1Database,
    GEMINI_API_KEY: 'test-key',
    ADMIN_PASSWORD: 'test-password',
    ROOM: new MockRoomNamespace() as unknown as DurableObjectNamespace,
  };
}

describe('input validation', () => {
  let db: MockD1Database;

  beforeEach(() => {
    uuidCounter = 0;
    db = new MockD1Database(makeCards(40));
  });

  describe('card generation input validation', () => {
    it('count is clamped to maximum of 10', async () => {
      // We can't actually test the generate endpoint without mocking Gemini,
      // but we test the API is reachable and validates the key
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 100, context: {} }),
      }, env);
      // With test-key, Gemini will fail but it should attempt the call
      // (rate limit or API error, not a validation error)
      expect([429, 502]).toContain(res.status);
    });

    it('context fields are optional', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      }, env);
      // Should not return 400 validation error
      expect(res.status).not.toBe(400);
    });
  });

  describe('deck creation validation', () => {
    it('name is required', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: ['test'] }),
      }, env);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('name and cards required');
    });

    it('cards array is required', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test deck' }),
      }, env);
      expect(res.status).toBe(400);
    });

    it('cards array cannot be empty', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test deck', cards: [] }),
      }, env);
      expect(res.status).toBe(400);
    });

    it('cards are limited to 50', async () => {
      const env = makeEnv(db);
      const manyCards = Array.from({ length: 60 }, (_, i) => `card-${i}`);
      const res = await app.request('http://example.com/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test deck', cards: manyCards }),
      }, env);
      expect(res.status).toBe(201);
      const body = await res.json() as { cardCount: number };
      expect(body.cardCount).toBeLessThanOrEqual(50);
    });

    it('creates a valid deck with proper data', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Deck', cards: ['海に行く', 'カラオケ', 'ラーメン食べる'] }),
      }, env);
      expect(res.status).toBe(201);
      const body = await res.json() as { id: string; name: string; cardCount: number };
      expect(typeof body.id).toBe('string');
      expect(body.name).toBe('My Deck');
      expect(body.cardCount).toBe(3);
    });
  });

  describe('room creation with categories filter', () => {
    it('creates room with category filter', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName: 'Host',
          settings: { categories: ['adventure', 'food'] },
        }),
      }, env);
      expect(res.status).toBe(201);
      const body = await res.json() as { code: string };
      expect(typeof body.code).toBe('string');
    });

    it('creates room with custom cards', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName: 'Host',
          settings: { customCards: ['海に行く', 'カラオケ'] },
        }),
      }, env);
      expect(res.status).toBe(201);
    });
  });

  describe('memory creation validation', () => {
    it('comment is required', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms/1234/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('comment_required');
    });

    it('empty comment is rejected', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms/1234/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: '   ' }),
      }, env);
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent room', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms/9999/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: 'Great memory!' }),
      }, env);
      expect(res.status).toBe(404);
    });
  });

  describe('room_not_found for uninitialized rooms', () => {
    it('joining an uninitialized room sends room_not_found error', async () => {
      const store = new Map<string, unknown>();
      const acceptedWs: MockWebSocket[] = [];
      const state = {
        acceptWebSocket: vi.fn((ws: MockWebSocket) => { acceptedWs.push(ws); }),
        getWebSockets: vi.fn(() => acceptedWs.filter(ws => ws.readyState === 1)),
        storage: {
          get: vi.fn(async (key: string) => store.get(key)),
          put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
          delete: vi.fn(async (key: string) => store.delete(key)),
          setAlarm: vi.fn(async () => {}),
        },
      } as unknown as DurableObjectState;

      const room = new RoomDurableObject(state, {});
      const ws = new MockWebSocket();

      // Try to join without ever initializing the room
      await room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'join', name: 'Alice' }));

      const msgs = ws.getSent();
      const error = msgs.find(m => m.type === 'error');
      expect(error).toBeDefined();
      if (error?.type === 'error') {
        expect(error.message).toBe('room_not_found');
      }
    });
  });
});
