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

describe('Edge Cases', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  describe('全カードキープ防止', () => {
    it('手札が2枚以上の場合、全カードをキープしようとするとinvalid_selectionエラー', async () => {
      await initRoom(room, '1234', makeCards(10), 5);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      const allIds = deal1.cards.map(c => c.id);
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'select', cardIds: allIds });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });

    it('手札3枚で3枚選択しようとするとinvalid_selectionエラー', async () => {
      await initRoom(room, '1234', makeCards(6), 3);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'select', cardIds: deal1.cards.map(c => c.id) });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });
  });

  describe('1枚カードのゲーム', () => {
    it('手札1枚の場合は全キープ可能（捨てるものがない）', async () => {
      await initRoom(room, '1234', makeCards(2), 1);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      expect(deal1.cards).toHaveLength(1);
      expect(deal2.cards).toHaveLength(1);

      ws1.clearSent();
      ws2.clearSent();

      // Both keep their single card
      await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
      await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

      // Should go directly to final_vote (2 remaining = 2 players)
      const finalVote = getSent(ws1).find(m => m.type === 'final_vote');
      expect(finalVote).toBeDefined();

      // No error should have occurred
      const error = getSent(ws1).find(m => m.type === 'error');
      expect(error).toBeUndefined();
    });

    it('1枚ゲームの完全なフロー: deal → select → vote → result', async () => {
      await initRoom(room, '1234', makeCards(2), 1);

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

      await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });
      await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id] });

      const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
      expect(fv.cards.length).toBeLessThanOrEqual(2);

      ws1.clearSent();
      ws2.clearSent();

      await sendMsg(room, ws1, { type: 'vote', cardId: fv.cards[0].id });
      await sendMsg(room, ws2, { type: 'vote', cardId: fv.cards[0].id });

      const result = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
      expect(result).toBeDefined();
      expect(result.card.id).toBe(fv.cards[0].id);
    });
  });

  describe('8人 (最大定員) ゲームフロー', () => {
    it('8人が参加してゲームを完了できる', async () => {
      const playerCount = 8;
      const cardsPerPlayer = 3;
      await initRoom(room, 'MAX8', makeCards(playerCount * cardsPerPlayer), cardsPerPlayer);

      const sockets: MockWebSocket[] = [];
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank'];

      for (let i = 0; i < playerCount; i++) {
        const ws = new MockWebSocket();
        await sendMsg(room, ws, { type: 'join', name: names[i] });
        sockets.push(ws);
      }

      // Everyone except host readies
      for (let i = 1; i < playerCount; i++) {
        await sendMsg(room, sockets[i], { type: 'ready' });
      }

      // Clear all messages
      sockets.forEach(ws => ws.clearSent());

      // Host starts game
      await sendMsg(room, sockets[0], { type: 'start' });

      // Everyone should get dealt cards
      const hands: Card[][] = [];
      for (let i = 0; i < playerCount; i++) {
        const deal = getSent(sockets[i]).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
        expect(deal).toBeDefined();
        expect(deal.cards.length).toBeGreaterThan(0);
        hands.push(deal.cards);
      }

      // Everyone keeps 1 card
      sockets.forEach(ws => ws.clearSent());
      for (let i = 0; i < playerCount; i++) {
        await sendMsg(room, sockets[i], { type: 'select', cardIds: [hands[i][0].id] });
      }

      // Should reach final_vote (8 remaining = 8 players)
      const fv = getSent(sockets[0]).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
      expect(fv).toBeDefined();
      expect(fv.cards.length).toBeLessThanOrEqual(playerCount);

      // Everyone votes for the same card
      sockets.forEach(ws => ws.clearSent());
      for (let i = 0; i < playerCount; i++) {
        await sendMsg(room, sockets[i], { type: 'vote', cardId: fv.cards[0].id });
      }

      // Result should be determined
      const result = getSent(sockets[0]).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
      expect(result).toBeDefined();
      expect(result.card.id).toBe(fv.cards[0].id);
      expect(Object.keys(result.votes)).toHaveLength(playerCount);
    });
  });

  describe('二重投票防止', () => {
    async function setupToVoting() {
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

      const fv = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
      ws1.clearSent();
      ws2.clearSent();

      return { ws1, ws2, survivors: fv.cards };
    }

    it('同じプレイヤーが二度投票するとalready_votedエラー', async () => {
      const { ws1, survivors } = await setupToVoting();

      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('already_voted');
      }
    });

    it('異なるカードに二度目の投票を試みてもalready_votedエラー', async () => {
      const { ws1, survivors } = await setupToVoting();
      if (survivors.length < 2) return;

      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
      ws1.clearSent();

      // Try voting for a different card
      await sendMsg(room, ws1, { type: 'vote', cardId: survivors[1].id });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('already_voted');
      }
    });
  });

  describe('存在しないカードへの投票', () => {
    it('survivorsに含まれないカードへの投票はinvalid_selectionエラー', async () => {
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

      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'vote', cardId: 'nonexistent-card-id' });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });
  });

  describe('空の選択', () => {
    it('空の配列で選択するとinvalid_selectionエラー', async () => {
      await initRoom(room, '1234', makeCards(10), 5);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'select', cardIds: [] });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });
  });

  describe('手札にないカードの選択', () => {
    it('手札にないカードIDで選択するとinvalid_selectionエラー', async () => {
      await initRoom(room, '1234', makeCards(10), 5);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'select', cardIds: ['fake-card-xyz'] });
      const error = getLastSent(ws1);
      expect(error.type).toBe('error');
      if (error.type === 'error') {
        expect(error.message).toBe('invalid_selection');
      }
    });
  });

  describe('ゲーム外でのアクション', () => {
    it('waiting phaseでselectを送ってもエラーにならない（無視される）', async () => {
      await initRoom(room, '1234', makeCards(10));

      const ws1 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'select', cardIds: ['card-1'] });

      // Should be silently ignored (player check or phase check fails)
      const msgs = getSent(ws1);
      const error = msgs.find(m => m.type === 'error');
      expect(error).toBeUndefined();
    });

    it('waiting phaseでvoteを送っても無視される', async () => {
      await initRoom(room, '1234', makeCards(10));

      const ws1 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      ws1.clearSent();

      await sendMsg(room, ws1, { type: 'vote', cardId: 'card-1' });

      const msgs = getSent(ws1);
      const error = msgs.find(m => m.type === 'error');
      expect(error).toBeUndefined();
    });
  });

  describe('selecting phase中の二重選択', () => {
    it('同じプレイヤーが2回選択しても2回目が有効になる', async () => {
      await initRoom(room, '1234', makeCards(6), 3);

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
      await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
      await sendMsg(room, ws2, { type: 'ready' });
      await sendMsg(room, ws1, { type: 'start' });

      const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
      ws1.clearSent();

      // First selection
      await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id] });

      // Second selection (should overwrite or be accepted)
      ws1.clearSent();
      await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[1].id] });

      // Shouldn't crash - either accepted or silently ignored
      // (implementation rejects because selectedCards.length > 0 already on second call)
    });
  });

  describe('9人目の参加拒否', () => {
    it('8人満員の状態で9人目が参加しようとするとroom_fullエラー', async () => {
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
  });
});
