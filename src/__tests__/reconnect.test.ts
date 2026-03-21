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

describe('Reconnection', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  it('同じplayerIdで再接続すると同じプレイヤーとして復帰する', async () => {
    await initRoom(room, '1234', makeCards(10));

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;

    // Alice disconnects
    await room.webSocketClose(ws1 as unknown as WebSocket);

    // Alice reconnects with same ID
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws3, { type: 'join', name: 'Alice', playerId: aliceId });

    const welcome3 = getSent(ws3).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    expect(welcome3).toBeDefined();
    expect(welcome3.playerId).toBe(aliceId);
  });

  it('再接続したプレイヤーがホストだった場合、ホスト権限が維持される', async () => {
    await initRoom(room, '1234', makeCards(10));

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;
    expect(welcome1.roomState.hostId).toBe(aliceId);

    // Alice disconnects
    await room.webSocketClose(ws1 as unknown as WebSocket);

    // Alice reconnects
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws3, { type: 'join', name: 'Alice', playerId: aliceId });

    const welcome3 = getSent(ws3).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    expect(welcome3.roomState.hostId).toBe(aliceId);

    // Verify Alice can still perform host actions (start)
    await sendMsg(room, ws2, { type: 'ready' });
    ws3.clearSent();
    await sendMsg(room, ws3, { type: 'start' });

    // Should not get not_host error
    const error = getSent(ws3).find(m => m.type === 'error' && m.message === 'not_host');
    expect(error).toBeUndefined();
  });

  it('selecting phase中の再接続で手札が再送される', async () => {
    await initRoom(room, '1234', makeCards(10), 5);

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws2, { type: 'ready' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;

    await sendMsg(room, ws1, { type: 'start' });

    // Get Alice's original hand
    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const originalHand = deal1.cards;

    // Alice disconnects during selecting phase
    await room.webSocketClose(ws1 as unknown as WebSocket);

    // Alice reconnects
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws3, { type: 'join', name: 'Alice', playerId: aliceId });

    const msgs = getSent(ws3);
    const welcomeMsg = msgs.find(m => m.type === 'welcome');
    const dealMsg = msgs.find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

    expect(welcomeMsg).toBeDefined();
    expect(dealMsg).toBeDefined();
    expect(dealMsg.cards.length).toBe(originalHand.length);

    // Same cards should be dealt
    const originalIds = originalHand.map(c => c.id).sort();
    const reconnectedIds = dealMsg.cards.map(c => c.id).sort();
    expect(reconnectedIds).toEqual(originalIds);
  });

  it('新しいplayerIdで接続すると新規プレイヤーとして扱われる', async () => {
    await initRoom(room, '1234', makeCards(10));

    const ws1 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;

    // New connection without existing ID
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    const welcome2 = getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    expect(welcome2.playerId).not.toBe(aliceId);
    expect(welcome2.roomState.players).toHaveLength(2);
  });

  it('存在しないplayerIdで再接続しようとすると新規プレイヤーとして参加する', async () => {
    await initRoom(room, '1234', makeCards(10));

    const ws1 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });

    const ws2 = new MockWebSocket();
    await sendMsg(room, ws2, { type: 'join', name: 'Bob', playerId: 'nonexistent-id' });

    const welcome2 = getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    expect(welcome2).toBeDefined();
    // Gets assigned a new ID, not the nonexistent one
    expect(welcome2.playerId).not.toBe('nonexistent-id');
    expect(welcome2.roomState.players).toHaveLength(2);
  });

  it('voting phase中の再接続でsurvivorsが再送される', async () => {
    await initRoom(room, '1234', makeCards(4), 2);

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;

    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

    // Both select 1 card → go to voting
    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

    const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    expect(fv).toBeDefined();

    // Alice disconnects during voting
    await room.webSocketClose(ws1 as unknown as WebSocket);

    // Alice reconnects
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws3, { type: 'join', name: 'Alice', playerId: aliceId });

    const msgs = getSent(ws3);
    const finalVoteMsg = msgs.find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    expect(finalVoteMsg).toBeDefined();
    expect(finalVoteMsg.cards.length).toBe(fv.cards.length);
  });

  it('再接続時に古いWebSocketが閉じられる', async () => {
    await initRoom(room, '1234', makeCards(10));

    const ws1 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;

    // Reconnect without disconnecting first (simulating stale connection)
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws2, { type: 'join', name: 'Alice', playerId: aliceId });

    // Old WebSocket should be closed
    expect(ws1.readyState).toBe(3);
  });

  it('再接続後にプレイヤーリストがブロードキャストされる', async () => {
    await initRoom(room, '1234', makeCards(10));

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const aliceId = welcome1.playerId;

    await room.webSocketClose(ws1 as unknown as WebSocket);
    ws2.clearSent();

    // Alice reconnects
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws3, { type: 'join', name: 'Alice', playerId: aliceId });

    // Bob should receive updated players list
    const playersMsg = getSent(ws2).find(m => m.type === 'players');
    expect(playersMsg).toBeDefined();
  });
});
