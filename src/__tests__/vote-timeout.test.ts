import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// --- Tests ---

describe('Vote Timeout & Kick progress (投票のスタック対策)', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    vi.useFakeTimers();
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 2人で最終投票フェーズまで進める */
  async function setupFinalVote() {
    await initRoom(room, '1234', makeCards(4), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    const aliceId = (getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;
    const bobId = (getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;

    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

    const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    expect(fv).toBeDefined();

    ws1.clearSent();
    ws2.clearSent();

    return { ws1, ws2, aliceId, bobId, survivors: fv.cards };
  }

  /** 3人で最終投票フェーズまで進める */
  async function setupFinalVote3() {
    await initRoom(room, '1234', makeCards(6), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws3, { type: 'join', name: 'Carol' });
    const aliceId = (getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;
    const bobId = (getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;
    const carolId = (getSent(ws3).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;

    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws3, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal3 = getSent(ws3).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });
    await sendMsg(room, ws3, { type: 'select', cardIds: [deal3.cards[0].id] });

    const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    expect(fv).toBeDefined();

    ws1.clearSent();
    ws2.clearSent();
    ws3.clearSent();

    return { ws1, ws2, ws3, aliceId, bobId, carolId, survivors: fv.cards };
  }

  it('投票者が30秒間投票しないと自動投票されて結果が出る', async () => {
    const { ws1, ws2, aliceId, survivors } = await setupFinalVote();

    // Aliceだけ投票
    await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
    ws1.clearSent();
    ws2.clearSent();

    // 30秒経過 → Bobは自動投票される
    await vi.advanceTimersByTimeAsync(30_000);

    const bobTimeout = getSent(ws2).find(m => m.type === 'error' && m.message === 'vote_timeout');
    expect(bobTimeout).toBeDefined();

    const r = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
    expect(r).toBeDefined();
    expect(r.votes[aliceId]).toBe(survivors[0].id);
    expect(Object.keys(r.votes).length).toBe(2);
  });

  it('29秒では自動投票されない', async () => {
    const { ws1, ws2, survivors } = await setupFinalVote();

    await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
    ws1.clearSent();
    ws2.clearSent();

    await vi.advanceTimersByTimeAsync(29_000);

    const bobTimeout = getSent(ws2).find(m => m.type === 'error' && m.message === 'vote_timeout');
    const result = getSent(ws1).find(m => m.type === 'result');
    expect(bobTimeout).toBeUndefined();
    expect(result).toBeUndefined();
  });

  it('投票中に切断したプレイヤーがいても期限後にゲームが完走する', async () => {
    const { ws1, ws2, survivors } = await setupFinalVote();

    // Bobが投票せずに切断、Aliceは投票済み
    await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
    await room.webSocketClose(ws2 as unknown as WebSocket);
    ws1.clearSent();

    // 30秒経過 → Bobは自動投票され、Aliceに結果が届く
    await vi.advanceTimersByTimeAsync(30_000);

    const result = getSent(ws1).find(m => m.type === 'result');
    expect(result).toBeDefined();
  });

  it('自動投票は投票済みプレイヤーの票を上書きしない', async () => {
    const { ws1, ws2, aliceId, survivors } = await setupFinalVote();

    await sendMsg(room, ws1, { type: 'vote', cardId: survivors[1].id });
    ws1.clearSent();

    await vi.advanceTimersByTimeAsync(30_000);

    const r = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
    expect(r).toBeDefined();
    expect(r.votes[aliceId]).toBe(survivors[1].id);
  });

  it('selecting中に最後の未選択プレイヤーをキックすると即座に進行する', async () => {
    // 3人セットアップ（まだ選択フェーズ）
    await initRoom(room, '1234', makeCards(6), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws3, { type: 'join', name: 'Carol' });
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws3, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const carolId = (getSent(ws3).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;

    // Alice, Bobは選択済み。Carolだけ未選択
    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

    ws1.clearSent();
    ws2.clearSent();

    // Carolをキック → 残り全員選択済みなので即進行
    await sendMsg(room, ws1, { type: 'kick', playerId: carolId });

    const progressed = getSent(ws1).some(m => m.type === 'pass' || m.type === 'final_vote');
    expect(progressed).toBe(true);
  });

  it('voting中にキックで残り全員投票済みになると結果が出る', async () => {
    const { ws1, ws2, carolId, survivors } = await setupFinalVote3();

    // Alice, Bobが投票、Carolは未投票のまま
    await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
    await sendMsg(room, ws2, { type: 'vote', cardId: survivors[0].id });
    ws1.clearSent();

    // Carolをキック → 残り全員投票済み → 即座に結果が出る
    await sendMsg(room, ws1, { type: 'kick', playerId: carolId });

    const r = getSent(ws1).find(m => m.type === 'result');
    expect(r).toBeDefined();
  });

  it('キックされたプレイヤーの票は結果から除外される', async () => {
    await initRoom(room, '1234', makeCards(6), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const ws3 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws3, { type: 'join', name: 'Carol' });
    const aliceId = (getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;
    const bobId = (getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;
    const carolId = (getSent(ws3).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws3, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal3 = getSent(ws3).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });
    await sendMsg(room, ws3, { type: 'select', cardIds: [deal3.cards[0].id] });

    const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;

    // Alice投票 → Carol投票 → Carolをキック → Bob投票 → 結果
    await sendMsg(room, ws1, { type: 'vote', cardId: fv.cards[0].id });
    await sendMsg(room, ws3, { type: 'vote', cardId: fv.cards[1] !== undefined ? fv.cards[1].id : fv.cards[0].id });
    ws1.clearSent();
    await sendMsg(room, ws1, { type: 'kick', playerId: carolId });
    await sendMsg(room, ws2, { type: 'vote', cardId: fv.cards[0].id });

    const r = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
    expect(r).toBeDefined();
    // キックされたCarolの票は含まれない
    expect(r.votes[carolId]).toBeUndefined();
    expect(r.votes[aliceId]).toBe(fv.cards[0].id);
    expect(r.votes[bobId]).toBe(fv.cards[0].id);
  });
});
