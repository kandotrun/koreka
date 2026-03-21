import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Card, ClientMessage, ServerMessage } from '../types';

// --- Mocks for Cloudflare runtime ---

class MockWebSocket {
  sent: string[] = [];
  readyState = 1; // OPEN
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

// Inject globals before importing the module
let uuidCounter = 0;
Object.assign(globalThis, {
  WebSocket: MockWebSocket,
  WebSocketPair: MockWebSocketPair,
  DurableObject: class {},
});

// Mock crypto.randomUUID for deterministic IDs
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => {
    uuidCounter++;
    return `${String(uuidCounter).padStart(8, '0')}-0000-0000-0000-000000000000`;
  },
});

// Now import the module under test
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

describe('RoomDurableObject', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  describe('init', () => {
    it('/init でルームを初期化できる', async () => {
      const cards = makeCards(10);
      const res = await room.fetch(new Request('http://internal/init', {
        method: 'POST',
        body: JSON.stringify({ code: '1234', cards, cardsPerPlayer: 5 }),
      }));
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    it('/info でルームの公開状態を取得できる', async () => {
      await initRoom(room, '5678', makeCards(10));
      const res = await room.fetch(new Request('http://internal/info'));
      const info = await res.json() as { code: string; phase: string };
      expect(info.code).toBe('5678');
      expect(info.phase).toBe('waiting');
    });

    it('不明なパスは404を返す', async () => {
      const res = await room.fetch(new Request('http://internal/unknown'));
      expect(res.status).toBe(404);
    });
  });

  describe('join', () => {
    it('プレイヤーが参加すると welcome メッセージが送られる', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws = new MockWebSocket();
      await sendMsg(room, ws, { type: 'join', name: 'Alice' });

      const msgs = getSent(ws);
      const welcome = msgs.find(m => m.type === 'welcome');
      expect(welcome).toBeDefined();
      expect(welcome!.type).toBe('welcome');
      if (welcome!.type === 'welcome') {
        expect(welcome!.playerId).toBeTruthy();
        expect(welcome!.roomState.code).toBe('1234');
        expect(welcome!.roomState.phase).toBe('waiting');
      }
    });

    it('最初のプレイヤーがホストになる', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });

      const welcome = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
      expect(welcome.roomState.hostId).toBe(welcome.playerId);
    });

    it('2人目のプレイヤーはホストにならない', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

      const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
      const welcome2 = getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
      expect(welcome2.roomState.hostId).toBe(welcome1.playerId);
    });

    it('8人以上は参加できない', async () => {
      await initRoom(room, '1234', makeCards(40));
      const sockets: MockWebSocket[] = [];
      for (let i = 0; i < 8; i++) {
        const ws = new MockWebSocket();
        await sendMsg(room, ws, { type: 'join', name: `Player${i}` });
        sockets.push(ws);
      }
      const ws9 = new MockWebSocket();
      await sendMsg(room, ws9, { type: 'join', name: 'Player9' });
      const error = getLastSent(ws9);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('room_full');
      }
    });

    it('ゲーム中は参加できない', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      const ws3 = new MockWebSocket();
      await sendMsg(room, ws3, { type: 'join', name: 'Charlie' });
      const error = getLastSent(ws3);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('game_in_progress');
      }
    });
  });

  describe('ready', () => {
    it('ready をトグルできる', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws = new MockWebSocket();
      await sendMsg(room, ws, { type: 'join', name: 'Alice' });
      ws.clearSent();

      await sendMsg(room, ws, { type: 'ready' });
      let players = getLastSent(ws);
      expect(players.type).toBe('players');
      if (players.type === 'players') {
        expect(players.players[0].ready).toBe(true);
      }

      await sendMsg(room, ws, { type: 'ready' });
      players = getLastSent(ws);
      if (players.type === 'players') {
        expect(players.players[0].ready).toBe(false);
      }
    });
  });

  describe('start', () => {
    it('ホストのみゲーム開始できる', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      ws2.clearSent();

      await sendMsg(room, ws2, { type: 'start' });
      const error = getLastSent(ws2);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('not_host');
      }
    });

    it('2人未満ではゲーム開始できない', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws = new MockWebSocket();
      await sendMsg(room, ws, { type: 'join', name: 'Alice' });
      ws.clearSent();

      await sendMsg(room, ws, { type: 'start' });
      const error = getLastSent(ws);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('need_more_players');
      }
    });

    it('全員 ready でないとゲーム開始できない', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'start' });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('not_all_ready');
      }
    });

    it('正常にゲーム開始するとカードが配布される', async () => {
      await initRoom(room, '1234', makeCards(10), 5);
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      ws1.clearSent();
      ws2.clearSent();

      await sendMsg(room, ws1, { type: 'start' });

      const deal1 = getSent(ws1).find(m => m.type === 'deal');
      const deal2 = getSent(ws2).find(m => m.type === 'deal');
      expect(deal1).toBeDefined();
      expect(deal2).toBeDefined();
      if (deal1?.type === 'deal' && deal2?.type === 'deal') {
        expect(deal1.cards.length).toBeGreaterThan(0);
        expect(deal2.cards.length).toBeGreaterThan(0);
        expect(deal1.round).toBe(1);
      }
    });
  });

  describe('select と passCards', () => {
    async function setupGameWith2Players(cardsPerPlayer = 3) {
      const cards = makeCards(cardsPerPlayer * 2);
      await initRoom(room, '1234', cards, cardsPerPlayer);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      // Get dealt cards
      const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

      ws1.clearSent();
      ws2.clearSent();

      return { ws1, ws2, hand1: deal1.cards, hand2: deal2.cards };
    }

    it('無効な選択を拒否する (空の配列)', async () => {
      const { ws1 } = await setupGameWith2Players();
      await sendMsg(room, ws1, { type: 'select', cardIds: [] });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });

    it('手札にないカードの選択を拒否する', async () => {
      const { ws1 } = await setupGameWith2Players();
      await sendMsg(room, ws1, { type: 'select', cardIds: ['nonexistent'] });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });

    it('全カードの選択を拒否する (最低1枚は捨てる)', async () => {
      const { ws1, hand1 } = await setupGameWith2Players();
      const allIds = hand1.map(c => c.id);
      await sendMsg(room, ws1, { type: 'select', cardIds: allIds });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });

    it('片方だけ選択すると waiting が送られる', async () => {
      const { ws1, ws2, hand1 } = await setupGameWith2Players();
      await sendMsg(room, ws1, { type: 'select', cardIds: [hand1[0].id] });

      // ws1 should receive a waiting message broadcast
      const waiting = getSent(ws1).find(m => m.type === 'waiting');
      expect(waiting).toBeDefined();
      if (waiting?.type === 'waiting') {
        expect(waiting.pending).toContain('Bob');
      }
    });

    it('両方が選択するとカードがパスされる', async () => {
      const { ws1, ws2, hand1, hand2 } = await setupGameWith2Players(3);
      // Each keeps 1 card (discards 2)
      await sendMsg(room, ws1, { type: 'select', cardIds: [hand1[0].id] });
      await sendMsg(room, ws2, { type: 'select', cardIds: [hand2[0].id] });

      // After both select, if total remaining (2) <= player count (2), we go to final vote
      // 2 players, each kept 1 card = 2 total remaining <= 2 players → final_vote
      const finalVote1 = getSent(ws1).find(m => m.type === 'final_vote');
      expect(finalVote1).toBeDefined();
      if (finalVote1?.type === 'final_vote') {
        expect(finalVote1.cards.length).toBeLessThanOrEqual(2);
      }
    });

    it('残りカード数がプレイヤー数より多い場合、右回しパスされる', async () => {
      const { ws1, ws2, hand1, hand2 } = await setupGameWith2Players(4);
      // Each keeps 2 cards (discards 2) → 4 remaining > 2 players → pass
      await sendMsg(room, ws1, { type: 'select', cardIds: [hand1[0].id, hand1[1].id] });
      await sendMsg(room, ws2, { type: 'select', cardIds: [hand2[0].id, hand2[1].id] });

      // Should receive pass (next round cards)
      const pass1 = getSent(ws1).find(m => m.type === 'pass');
      const pass2 = getSent(ws2).find(m => m.type === 'pass');
      expect(pass1).toBeDefined();
      expect(pass2).toBeDefined();

      if (pass1?.type === 'pass' && pass2?.type === 'pass') {
        expect(pass1.round).toBe(2);
        // Player1 should receive Player2's kept cards (right rotation)
        // Player2's kept cards were hand2[0] and hand2[1]
        expect(pass1.cards.map(c => c.id).sort()).toEqual([hand2[0].id, hand2[1].id].sort());
        // Player2 should receive Player1's kept cards
        expect(pass2.cards.map(c => c.id).sort()).toEqual([hand1[0].id, hand1[1].id].sort());
      }
    });
  });

  describe('収束判定と最終投票', () => {
    async function setupToFinalVote() {
      const cards = makeCards(4);
      await initRoom(room, '1234', cards, 2);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;

      ws1.clearSent();
      ws2.clearSent();

      // Each has 2 cards, keeps 1 → 2 remaining = 2 players → final_vote
      await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
      await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

      const finalVote = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
      ws1.clearSent();
      ws2.clearSent();

      return { ws1, ws2, survivors: finalVote.cards };
    }

    it('残りカード数 <= プレイヤー数で最終投票に移行する', async () => {
      const { survivors } = await setupToFinalVote();
      expect(survivors.length).toBeLessThanOrEqual(2);
      expect(survivors.length).toBeGreaterThan(0);
    });

    it('投票すると結果が決まる', async () => {
      const { ws1, ws2, survivors } = await setupToFinalVote();

      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      await sendMsg(room, ws2, { type: 'vote', cardId: survivors[0].id });

      const result1 = getSent(ws1).find(m => m.type === 'result');
      expect(result1).toBeDefined();
      if (result1?.type === 'result') {
        expect(result1.card.id).toBe(survivors[0].id);
        expect(Object.keys(result1.votes).length).toBe(2);
      }
    });

    it('二重投票を拒否する', async () => {
      const { ws1, survivors } = await setupToFinalVote();
      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('already_voted');
      }
    });

    it('無効なカードへの投票を拒否する', async () => {
      const { ws1 } = await setupToFinalVote();
      await sendMsg(room, ws1, { type: 'vote', cardId: 'nonexistent' });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });

    it('片方だけ投票すると waiting が送られる', async () => {
      const { ws1, ws2, survivors } = await setupToFinalVote();
      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });

      const waiting = getSent(ws1).find(m => m.type === 'waiting');
      expect(waiting).toBeDefined();
      if (waiting?.type === 'waiting') {
        expect(waiting.pending).toContain('Bob');
      }
    });

    it('同票の場合ランダムで決まる (結果が survivors に含まれる)', async () => {
      const { ws1, ws2, survivors } = await setupToFinalVote();
      if (survivors.length < 2) return; // skip if only 1 survivor

      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      await sendMsg(room, ws2, { type: 'vote', cardId: survivors[1].id });

      const result = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
      expect(result).toBeDefined();
      const validIds = survivors.map(c => c.id);
      expect(validIds).toContain(result.card.id);
    });
  });

  describe('ping/pong', () => {
    it('ping に対して pong を返す', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws = new MockWebSocket();
      await sendMsg(room, ws, { type: 'join', name: 'Alice' });
      ws.clearSent();

      await sendMsg(room, ws, { type: 'ping' });
      const pong = getLastSent(ws);
      expect(pong.type).toBe('pong');
    });
  });

  describe('無効なJSON', () => {
    it('パースできないメッセージにはエラーを返す', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws = new MockWebSocket();
      await sendMsg(room, ws, { type: 'join', name: 'Alice' });
      ws.clearSent();

      await room.webSocketMessage(ws as unknown as WebSocket, 'not json');
      const error = getLastSent(ws);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_json');
      }
    });
  });

  describe('プレイヤー切断', () => {
    it('プレイヤーが切断してもリストには残る（30秒猶予）', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      ws1.clearSent();

      await room.webSocketClose(ws2 as unknown as WebSocket);

      // 切断後もプレイヤーは残る（ws=null, 30秒後にalarmで削除）
      const players = getLastSent(ws1);
      expect(players.type).toBe('players');
      if (players.type === 'players') {
        expect(players.players.length).toBe(2);
      }
    });

    it('alarmでws=nullプレイヤーが削除され、ホストが移る', async () => {
      await initRoom(room, '1234', makeCards(10));
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

      const welcome2 = getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
      const bobId = welcome2.playerId;
      ws2.clearSent();

      // Alice (host) disconnects
      await room.webSocketClose(ws1 as unknown as WebSocket);

      // alarm発火で削除
      await room.alarm();

      const players = getLastSent(ws2);
      expect(players.type).toBe('players');
      if (players.type === 'players') {
        expect(players.players.length).toBe(1);
      }

      // Verify via /info that Bob is now host
      const res = await room.fetch(new Request('http://internal/info'));
      const info = await res.json() as { hostId: string };
      expect(info.hostId).toBe(bobId);
    });
  });
});
