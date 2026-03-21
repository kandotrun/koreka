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

describe('Player Kick', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  async function setup3Players() {
    await initRoom(room, '1234', makeCards(15));
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const ws3 = new MockWebSocket();

    await sendMsg(room, ws1, { type: 'join', name: 'Alice' }); // host
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws3, { type: 'join', name: 'Charlie' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const welcome2 = getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const welcome3 = getSent(ws3).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;

    return {
      ws1, ws2, ws3,
      aliceId: welcome1.playerId,
      bobId: welcome2.playerId,
      charlieId: welcome3.playerId,
    };
  }

  it('ホストがプレイヤーをキックするとルームから削除される', async () => {
    const { ws1, ws2, bobId } = await setup3Players();
    ws1.clearSent();

    await sendMsg(room, ws1, { type: 'kick', playerId: bobId });

    // Players list should be updated
    const players = getSent(ws1).find(m => m.type === 'players') as Extract<ServerMessage, { type: 'players' }>;
    expect(players).toBeDefined();
    expect(players.players).toHaveLength(2);
    expect(players.players.map(p => p.name)).not.toContain('Bob');
  });

  it('キックされたプレイヤーは kicked エラーを受け取る', async () => {
    const { ws1, ws2, bobId } = await setup3Players();
    ws2.clearSent();

    await sendMsg(room, ws1, { type: 'kick', playerId: bobId });

    const error = getSent(ws2).find(m => m.type === 'error') as Extract<ServerMessage, { type: 'error' }>;
    expect(error).toBeDefined();
    expect(error.message).toBe('kicked');
  });

  it('キックされたプレイヤーのWebSocketがcloseされる', async () => {
    const { ws1, ws2, bobId } = await setup3Players();

    await sendMsg(room, ws1, { type: 'kick', playerId: bobId });

    expect(ws2.readyState).toBe(3); // CLOSED
  });

  it('非ホストがキックしようとするとnot_hostエラーになる', async () => {
    const { ws2, charlieId } = await setup3Players();
    ws2.clearSent();

    await sendMsg(room, ws2, { type: 'kick', playerId: charlieId });

    const error = getLastSent(ws2);
    expect(error.type).toBe('error');
    if (error.type === 'error') {
      expect(error.message).toBe('not_host');
    }
  });

  it('ホストが自分自身をキックしようとしても無視される', async () => {
    const { ws1, aliceId } = await setup3Players();
    ws1.clearSent();

    await sendMsg(room, ws1, { type: 'kick', playerId: aliceId });

    // No error, no kick message - silently ignored
    // Player list should NOT have been broadcast (no change)
    const msgs = getSent(ws1);
    const errorMsg = msgs.find(m => m.type === 'error' && m.message === 'kicked');
    expect(errorMsg).toBeUndefined();

    // Verify Alice is still in room
    const res = await room.fetch(new Request('http://internal/info'));
    const info = await res.json() as { players: { name: string }[] };
    expect(info.players.map((p: { name: string }) => p.name)).toContain('Alice');
  });

  it('キック後にプレイヤーリストが全員にブロードキャストされる', async () => {
    const { ws1, ws3, bobId } = await setup3Players();
    ws1.clearSent();
    ws3.clearSent();

    await sendMsg(room, ws1, { type: 'kick', playerId: bobId });

    // Both remaining players should receive updated player list
    const players1 = getSent(ws1).find(m => m.type === 'players') as Extract<ServerMessage, { type: 'players' }>;
    const players3 = getSent(ws3).find(m => m.type === 'players') as Extract<ServerMessage, { type: 'players' }>;
    expect(players1).toBeDefined();
    expect(players3).toBeDefined();
    expect(players1.players).toHaveLength(2);
    expect(players3.players).toHaveLength(2);
  });

  it('存在しないプレイヤーIDでキックしても何も起こらない', async () => {
    const { ws1 } = await setup3Players();
    ws1.clearSent();

    await sendMsg(room, ws1, { type: 'kick', playerId: 'nonexistent' });

    // Should silently do nothing
    const msgs = getSent(ws1);
    const playersBroadcast = msgs.find(m => m.type === 'players');
    expect(playersBroadcast).toBeUndefined();
  });

  it('キック後に /info でプレイヤー数が正しく減っている', async () => {
    const { ws1, bobId } = await setup3Players();

    await sendMsg(room, ws1, { type: 'kick', playerId: bobId });

    const res = await room.fetch(new Request('http://internal/info'));
    const info = await res.json() as { players: { id: string }[] };
    expect(info.players).toHaveLength(2);
    expect(info.players.map((p: { id: string }) => p.id)).not.toContain(bobId);
  });
});
