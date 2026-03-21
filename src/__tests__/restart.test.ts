import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Card, ClientMessage, ServerMessage } from '../types';

// --- Mocks for Cloudflare runtime ---

class MockWebSocket {
  sent: string[] = [];
  readyState = 1;
  private _attachment: unknown = null;
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  serializeAttachment(data: unknown) { this._attachment = structuredClone(data); }
  deserializeAttachment() { return this._attachment; }
  getSent(): ServerMessage[] { return this.sent.map(s => JSON.parse(s)); }
  getLastSent(): ServerMessage { return JSON.parse(this.sent[this.sent.length - 1]); }
  clearSent() { this.sent = []; }
}

class MockWebSocketPair {
  0: MockWebSocket;
  1: MockWebSocket;
  constructor() { this[0] = new MockWebSocket(); this[1] = new MockWebSocket(); }
}

let uuidCounter = 0;
Object.assign(globalThis, {
  WebSocket: MockWebSocket,
  WebSocketPair: MockWebSocketPair,
  DurableObject: class {},
});

vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => {
    uuidCounter++;
    return `${String(uuidCounter).padStart(8, '0')}-0000-0000-0000-000000000000`;
  },
});

const { RoomDurableObject } = await import('../durable-objects/room');

// --- Helpers ---

function makeMockState(): DurableObjectState {
  const store = new Map<string, unknown>();
  const acceptedWs: MockWebSocket[] = [];
  return {
    acceptWebSocket: vi.fn((ws: MockWebSocket) => { acceptedWs.push(ws); }),
    getWebSockets: vi.fn(() => acceptedWs.filter(ws => ws.readyState === 1)),
    storage: {
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
      delete: vi.fn(async (key: string) => store.delete(key)),
      setAlarm: vi.fn(async () => {}),
    },
  } as unknown as DurableObjectState;
}

function makeCards(count: number): Card[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `card-${i + 1}`,
    text: `テストカード${i + 1}`,
    category: 'adventure' as const,
    generated: false,
  }));
}

async function initRoom(room: InstanceType<typeof RoomDurableObject>, code: string, cards: Card[], cardsPerPlayer = 5) {
  await room.fetch(new Request('http://internal/init', {
    method: 'POST',
    body: JSON.stringify({ code, cards, cardsPerPlayer }),
  }));
}

function sendMsg(room: InstanceType<typeof RoomDurableObject>, ws: MockWebSocket, msg: ClientMessage) {
  return room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(msg));
}

function getSent(ws: MockWebSocket): ServerMessage[] {
  return ws.getSent();
}

function getLastSent(ws: MockWebSocket): ServerMessage {
  return ws.getLastSent();
}

// --- Tests ---

describe('Quick Replay (restart)', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  async function playToResult() {
    await initRoom(room, '1234', makeCards(4), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();

    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

    const finalVote = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;

    await sendMsg(room, ws1, { type: 'vote', cardId: finalVote.cards[0].id });
    await sendMsg(room, ws2, { type: 'vote', cardId: finalVote.cards[0].id });

    return { ws1, ws2 };
  }

  it('ホストがrestartするとwaitingフェーズにリセットされる', async () => {
    const { ws1, ws2 } = await playToResult();
    ws1.clearSent();
    ws2.clearSent();

    await sendMsg(room, ws1, { type: 'restart' });

    const restart1 = getSent(ws1).find(m => m.type === 'restart');
    const restart2 = getSent(ws2).find(m => m.type === 'restart');
    expect(restart1).toBeDefined();
    expect(restart2).toBeDefined();

    // Verify phase is waiting via /info
    const res = await room.fetch(new Request('http://internal/info'));
    const info = await res.json() as { phase: string };
    expect(info.phase).toBe('waiting');
  });

  it('非ホストがrestartするとnot_hostエラーになる', async () => {
    const { ws2 } = await playToResult();
    ws2.clearSent();

    await sendMsg(room, ws2, { type: 'restart' });
    const error = getLastSent(ws2);
    expect(error.type).toBe('error');
    if (error.type === 'error') {
      expect(error.message).toBe('not_host');
    }
  });

  it('restart後もプレイヤーはルームに残っている', async () => {
    const { ws1, ws2 } = await playToResult();
    ws1.clearSent();
    ws2.clearSent();

    await sendMsg(room, ws1, { type: 'restart' });

    // Players list should be broadcast after restart
    const players = getSent(ws1).find(m => m.type === 'players') as Extract<ServerMessage, { type: 'players' }>;
    expect(players).toBeDefined();
    expect(players.players).toHaveLength(2);
    expect(players.players.map(p => p.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('restart後にプレイヤーのreadyがfalseにリセットされる', async () => {
    const { ws1 } = await playToResult();
    ws1.clearSent();

    await sendMsg(room, ws1, { type: 'restart' });

    const players = getSent(ws1).find(m => m.type === 'players') as Extract<ServerMessage, { type: 'players' }>;
    expect(players.players.every(p => p.ready === false)).toBe(true);
  });

  it('restart後に新しいゲームを正常に開始できる', async () => {
    const { ws1, ws2 } = await playToResult();
    ws1.clearSent();
    ws2.clearSent();

    await sendMsg(room, ws1, { type: 'restart' });

    ws1.clearSent();
    ws2.clearSent();

    // Ready up and start again
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal');
    const deal2 = getSent(ws2).find(m => m.type === 'deal');
    expect(deal1).toBeDefined();
    expect(deal2).toBeDefined();
    if (deal1?.type === 'deal') {
      expect(deal1.cards.length).toBeGreaterThan(0);
      expect(deal1.round).toBe(1);
    }
  });

  it('restart後にカードが元のデッキから再配布される', async () => {
    const originalCards = makeCards(4);
    await initRoom(room, 'RE', originalCards, 2);

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();

    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    // Get first game's cards
    const deal1a = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2a = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const firstGameCardIds = [...deal1a.cards, ...deal2a.cards].map(c => c.id).sort();

    // Complete game
    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1a.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2a.cards[0].id] });

    const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    await sendMsg(room, ws1, { type: 'vote', cardId: fv.cards[0].id });
    await sendMsg(room, ws2, { type: 'vote', cardId: fv.cards[0].id });

    // Restart
    ws1.clearSent();
    ws2.clearSent();
    await sendMsg(room, ws1, { type: 'restart' });

    ws1.clearSent();
    ws2.clearSent();
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    // Get second game's cards
    const deal1b = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2b = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const secondGameCardIds = [...deal1b.cards, ...deal2b.cards].map(c => c.id).sort();

    // Same card IDs should be used (from original deck)
    expect(secondGameCardIds).toEqual(firstGameCardIds);
    // All original card IDs should be present
    const originalIds = originalCards.map(c => c.id).sort();
    expect(secondGameCardIds).toEqual(originalIds);
  });

  it('ゲーム中（selecting phase）でもhostはrestartできる', async () => {
    await initRoom(room, '1234', makeCards(10), 5);

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    ws1.clearSent();
    ws2.clearSent();

    // Restart during selecting phase
    await sendMsg(room, ws1, { type: 'restart' });

    const restart = getSent(ws1).find(m => m.type === 'restart');
    expect(restart).toBeDefined();

    const res = await room.fetch(new Request('http://internal/info'));
    const info = await res.json() as { phase: string };
    expect(info.phase).toBe('waiting');
  });
});
