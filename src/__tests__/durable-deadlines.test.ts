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

function makeMockState() {
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
  return { state, store, acceptedWs };
}

function setAlarmCalls(state: DurableObjectState): number[] {
  const spy = state.storage.setAlarm as unknown as { mock: { calls: [number][] } };
  return spy.mock.calls.map(c => c[0]);
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

describe('Durable deadlines (storage + alarm による再起動耐久)', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;
  let store: Map<string, unknown>;
  let acceptedWs: MockWebSocket[];

  beforeEach(() => {
    vi.useFakeTimers();
    uuidCounter = 0;
    ({ state, store, acceptedWs } = makeMockState());
    room = new RoomDurableObject(state, {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 2人を選択フェーズまで進める */
  async function setupSelecting() {
    await initRoom(room, '1234', makeCards(4), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    // runtimeにacceptされたWebSocketとして登録（ハイバネーション復帰時のgetWebSockets()相当）
    acceptedWs.push(ws1, ws2);
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws1, { type: 'start' });
    return { ws1, ws2 };
  }

  /** 2人を最終投票フェーズまで進める */
  async function setupFinalVote() {
    const { ws1, ws2 } = await setupSelecting();
    const aliceId = (getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>).playerId;

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

    const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    expect(fv).toBeDefined();
    return { ws1, ws2, aliceId, survivors: fv.cards };
  }

  it('選択フェーズ開始で締切がstorageに保存され、その時刻にalarmが設定される', async () => {
    await setupSelecting();

    const deadline = store.get('selectDeadlineAt');
    expect(typeof deadline).toBe('number');
    expect(setAlarmCalls(state)).toContain(deadline);
  });

  it('DOが再起動（ハイバネーション復帰）しても選択締切でゲームが進む', async () => {
    const { ws1, ws2 } = await setupSelecting();

    // 誰も選択しないまま、インメモリタイマーを失った新インスタンス（復帰）がalarmを受ける
    ws1.clearSent();
    ws2.clearSent();
    const restored = new RoomDurableObject(state, {});
    vi.setSystemTime(Date.now() + 31_000);
    await restored.alarm();

    // 自動選択の通知が届き、ゲームが先へ進む
    const aliceTimeout = getSent(ws1).find(m => m.type === 'error' && m.message === 'selection_timeout');
    expect(aliceTimeout).toBeDefined();
    const progressed = getSent(ws1).some(m => m.type === 'pass' || m.type === 'final_vote');
    expect(progressed).toBe(true);
  });

  it('DOが再起動しても投票締切で結果が出て、既存の票が保持される', async () => {
    const { ws1, ws2, aliceId, survivors } = await setupFinalVote();

    // Aliceだけ投票してから復帰
    await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
    ws1.clearSent();
    ws2.clearSent();

    const restored = new RoomDurableObject(state, {});
    vi.setSystemTime(Date.now() + 31_000);
    await restored.alarm();

    const r = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
    expect(r).toBeDefined();
    // Aliceの票はstorageから復元され、上書きされていない
    expect(r.votes[aliceId]).toBe(survivors[0].id);
    expect(Object.keys(r.votes).length).toBe(2);
    expect(getSent(ws1).find(m => m.type === 'error' && m.message === 'vote_timeout')).toBeUndefined();
    // Bobは未投票のため自動投票される
    const bobTimeout = getSent(ws2).find(m => m.type === 'error' && m.message === 'vote_timeout');
    expect(bobTimeout).toBeDefined();
  });

  it('切断クリーンアップ後もTTL（2時間）alarmが再設定される', async () => {
    await initRoom(room, '1234', makeCards(4), 2);
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    await room.webSocketClose(ws2 as unknown as WebSocket);
    await room.alarm();

    // クリーンアップ後もTTLがalarmに残っている（最後のsetAlarmは2時間後のTTL）
    const calls = setAlarmCalls(state);
    const last = calls[calls.length - 1];
    expect(last).toBeGreaterThan(Date.now() + 60 * 60 * 1000);

    // Bobはプレイヤーリストから削除されている
    const playersMsgs = getSent(ws1).filter(m => m.type === 'players') as Extract<ServerMessage, { type: 'players' }>[];
    expect(playersMsgs.length).toBeGreaterThan(0);
    expect(playersMsgs[playersMsgs.length - 1].players.length).toBe(1);
  });
});
