import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, ClientMessage, ServerMessage } from '../types';

class MockWebSocket {
  sent: string[] = [];
  readyState = 1;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  getSent(): ServerMessage[] {
    return this.sent.map((entry) => JSON.parse(entry) as ServerMessage);
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
  return Array.from({ length: count }, (_, index) => ({
    id: `card-${index + 1}`,
    text: `テストカード${index + 1}`,
    category: 'adventure',
    generated: false,
  }));
}

class MockPreparedStatement {
  private params: string[] = [];

  constructor(
    private readonly query: string,
    private readonly cards: Card[],
    private readonly inserts: Array<{ query: string; params: string[] }>
  ) {}

  bind(...params: string[]) {
    this.params = params;
    return this;
  }

  async all<T>() {
    if (this.query.includes('FROM cards')) {
      return { results: this.cards as T[] };
    }

    return { results: [] as T[] };
  }

  async run() {
    this.inserts.push({ query: this.query, params: this.params });
    return { success: true };
  }
}

class MockD1Database {
  readonly inserts: Array<{ query: string; params: string[] }> = [];

  constructor(private readonly cards: Card[]) {}

  prepare(query: string) {
    return new MockPreparedStatement(query, this.cards, this.inserts);
  }
}

type MockRoomId = { code: string; toString(): string };

class MockRoomNamespace {
  private readonly rooms = new Map<string, InstanceType<typeof RoomDurableObject>>();

  idFromName(code: string): MockRoomId {
    return {
      code,
      toString: () => `room-${code}`,
    };
  }

  get(id: MockRoomId) {
    let room = this.rooms.get(id.code);

    if (!room) {
      const store = new Map<string, unknown>();
      room = new RoomDurableObject({
        acceptWebSocket: vi.fn(),
        storage: {
          get: vi.fn(async (key: string) => store.get(key)),
          put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
          delete: vi.fn(async (key: string) => store.delete(key)),
        },
      } as unknown as DurableObjectState, {});
      this.rooms.set(id.code, room);
    }

    return {
      fetch: (request: Request) => room.fetch(request),
    };
  }

  getRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error(`Room ${code} was not initialized`);
    }
    return room;
  }
}

function getMessages(ws: MockWebSocket): ServerMessage[] {
  return ws.getSent();
}

async function sendMessage(room: InstanceType<typeof RoomDurableObject>, ws: MockWebSocket, message: ClientMessage) {
  await room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(message));
}

describe('room creation flow', () => {
  let db: MockD1Database;
  let rooms: MockRoomNamespace;

  beforeEach(() => {
    uuidCounter = 0;
    db = new MockD1Database(makeCards(40));
    rooms = new MockRoomNamespace();
  });

  it('creates a room via API and deals cards after start', async () => {
    const response = await app.request('http://example.com/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'Host' }),
    }, {
      DB: db as unknown as D1Database,
      GEMINI_API_KEY: 'test-key',
      ROOM: rooms as unknown as DurableObjectNamespace,
    });

    expect(response.status).toBe(201);

    const body = await response.json() as { code: string };
    const room = rooms.getRoom(body.code);
    const host = new MockWebSocket();
    const guest = new MockWebSocket();

    await sendMessage(room, host, { type: 'join', name: 'Host' });
    await sendMessage(room, guest, { type: 'join', name: 'Guest' });
    await sendMessage(room, guest, { type: 'ready' });

    host.sent = [];
    guest.sent = [];

    await sendMessage(room, host, { type: 'start' });

    const hostDeal = getMessages(host).find((message) => message.type === 'deal');
    const guestDeal = getMessages(guest).find((message) => message.type === 'deal');

    expect(hostDeal).toBeDefined();
    expect(guestDeal).toBeDefined();

    if (hostDeal?.type !== 'deal' || guestDeal?.type !== 'deal') {
      throw new Error('Expected deal messages for both players');
    }

    expect(hostDeal.cards).toHaveLength(20);
    expect(guestDeal.cards).toHaveLength(20);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]?.query).toContain('INSERT INTO rooms');
  });
});
