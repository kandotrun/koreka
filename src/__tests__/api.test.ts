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

function makeCards(count: number): Card[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i + 1}`,
    text: `テストカード${i + 1}`,
    category: 'adventure' as const,
    generated: false,
  }));
}

class MockPreparedStatement {
  private params: (string | number)[] = [];

  constructor(
    private readonly query: string,
    private readonly cards: Card[],
    private readonly inserts: Array<{ query: string; params: (string | number)[] }>,
    private readonly rooms: Array<{ id: string; code: string; result_card_id?: string }>,
    private readonly memories: Array<{ id: string; room_id: string; comment: string }>,
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
    if (this.query.includes('FROM cards') && this.query.includes('GROUP BY category')) {
      const catCounts = new Map<string, number>();
      for (const card of this.cards) {
        catCounts.set(card.category, (catCounts.get(card.category) || 0) + 1);
      }
      const results = Array.from(catCounts.entries()).map(([category, count]) => ({
        category,
        count,
      }));
      return { results: results as T[] };
    }
    if (this.query.includes('FROM cards')) {
      return { results: this.cards as T[] };
    }
    if (this.query.includes('FROM rooms r') && this.query.includes('JOIN cards c')) {
      return { results: [] as T[] };
    }
    if (this.query.includes('FROM memories')) {
      return { results: this.memories as T[] };
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
  readonly rooms: Array<{ id: string; code: string; result_card_id?: string }> = [];
  readonly memories: Array<{ id: string; room_id: string; comment: string }> = [];

  constructor(private readonly cards: Card[]) {}

  prepare(query: string) {
    return new MockPreparedStatement(query, this.cards, this.inserts, this.rooms, this.memories);
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

describe('API endpoints', () => {
  let db: MockD1Database;

  beforeEach(() => {
    uuidCounter = 0;
    db = new MockD1Database(makeCards(40));
  });

  describe('GET /api/cards/categories', () => {
    it('returns categories with counts', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/cards/categories', {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { categories: Array<{ id: string; count: number }> };
      expect(body.categories).toBeDefined();
      expect(Array.isArray(body.categories)).toBe(true);
    });
  });

  describe('GET /api/cards/count', () => {
    it('returns total card count', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/cards/count', {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { total: number };
      expect(typeof body.total).toBe('number');
    });
  });

  describe('GET /api/cards/sample', () => {
    it('returns cards array', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/cards/sample', {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { cards: Card[]; count: number };
      expect(Array.isArray(body.cards)).toBe(true);
      expect(typeof body.count).toBe('number');
    });
  });

  describe('GET /api/cards/popular', () => {
    it('returns cards array', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/cards/popular', {}, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { cards: unknown[]; count: number };
      expect(Array.isArray(body.cards)).toBe(true);
      expect(typeof body.count).toBe('number');
    });
  });

  describe('POST /api/rooms', () => {
    it('requires hostName', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('hostName required');
    });

    it('creates room and returns code and roomId', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: 'Host' }),
      }, env);
      expect(res.status).toBe(201);
      const body = await res.json() as { code: string; roomId: string };
      expect(typeof body.code).toBe('string');
      expect(body.code).toMatch(/^\d{4}$/);
      expect(typeof body.roomId).toBe('string');
    });
  });

  describe('GET /api/admin/stats', () => {
    it('returns 401 without token', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/admin/stats', {}, env);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 with invalid token', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/admin/stats', {
        headers: { Authorization: 'Bearer invalid-token' },
      }, env);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/admin/login', () => {
    it('returns 401 with wrong password', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password' }),
      }, env);
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('unauthorized');
    });

    it('returns token with correct password', async () => {
      const env = makeEnv(db);
      const res = await app.request('http://example.com/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-password' }),
      }, env);
      expect(res.status).toBe(200);
      const body = await res.json() as { token: string };
      expect(typeof body.token).toBe('string');
    });

    it('admin stats accessible with valid token after login', async () => {
      const env = makeEnv(db);
      const loginRes = await app.request('http://example.com/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-password' }),
      }, env);
      const { token } = await loginRes.json() as { token: string };

      const statsRes = await app.request('http://example.com/api/admin/stats', {
        headers: { Authorization: `Bearer ${token}` },
      }, env);
      expect(statsRes.status).toBe(200);
      const body = await statsRes.json() as { totalCards: number; totalRooms: number; totalMemories: number };
      expect(typeof body.totalCards).toBe('number');
      expect(typeof body.totalRooms).toBe('number');
      expect(typeof body.totalMemories).toBe('number');
    });
  });
});
