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

describe('Full Game Flow (2 players, join → result)', () => {
  let room: InstanceType<typeof RoomDurableObject>;
  let state: DurableObjectState;

  beforeEach(() => {
    uuidCounter = 0;
    state = makeMockState();
    room = new RoomDurableObject(state, {});
  });

  it('2人プレイヤーの完全なゲームフロー: join → ready → start → select → vote → result', async () => {
    // 10 cards, 5 per player
    await initRoom(room, 'FULL', makeCards(10), 5);

    // --- Step 1: Two players join ---
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });

    const welcome1 = getSent(ws1).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    const welcome2 = getSent(ws2).find(m => m.type === 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    expect(welcome1).toBeDefined();
    expect(welcome2).toBeDefined();
    expect(welcome1.roomState.phase).toBe('waiting');

    const aliceId = welcome1.playerId;
    const bobId = welcome2.playerId;

    // --- Step 2: Both ready ---
    await sendMsg(room, ws2, { type: 'ready' });
    ws1.clearSent();
    ws2.clearSent();

    // --- Step 3: Host starts game ---
    await sendMsg(room, ws1, { type: 'start' });

    // --- Step 4: Both receive deal messages with cards ---
    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    expect(deal1).toBeDefined();
    expect(deal2).toBeDefined();
    expect(deal1.cards.length).toBe(5);
    expect(deal2.cards.length).toBe(5);
    expect(deal1.round).toBe(1);
    expect(deal2.round).toBe(1);

    // --- Step 5: Selection rounds until convergence ---
    let hand1 = deal1.cards;
    let hand2 = deal2.cards;
    let round = 1;

    // Keep iterating selection rounds
    while (true) {
      ws1.clearSent();
      ws2.clearSent();

      // Each player keeps half (ceil of half, but less than all)
      const keepCount1 = Math.max(1, Math.ceil(hand1.length / 2));
      const keepCount2 = Math.max(1, Math.ceil(hand2.length / 2));
      const keep1 = hand1.slice(0, Math.min(keepCount1, hand1.length - 1));
      const keep2 = hand2.slice(0, Math.min(keepCount2, hand2.length - 1));

      // Ensure at least 1 kept and at least 1 discarded
      expect(keep1.length).toBeGreaterThan(0);
      expect(keep1.length).toBeLessThan(hand1.length);
      expect(keep2.length).toBeGreaterThan(0);
      expect(keep2.length).toBeLessThan(hand2.length);

      await sendMsg(room, ws1, { type: 'select', cardIds: keep1.map(c => c.id) });
      await sendMsg(room, ws2, { type: 'select', cardIds: keep2.map(c => c.id) });

      // Check if we reached final_vote
      const finalVote1 = getSent(ws1).find(m => m.type === 'final_vote');
      if (finalVote1) {
        // Converged! Verify both got final_vote
        const finalVote2 = getSent(ws2).find(m => m.type === 'final_vote');
        expect(finalVote2).toBeDefined();

        if (finalVote1.type === 'final_vote' && finalVote2?.type === 'final_vote') {
          expect(finalVote1.cards.length).toBeGreaterThan(0);
          expect(finalVote1.cards.length).toBeLessThanOrEqual(2);

          // --- Step 6: Final vote ---
          ws1.clearSent();
          ws2.clearSent();

          const survivors = finalVote1.cards;
          await sendMsg(room, ws1, { type: 'vote', cardId: survivors[0].id });
          await sendMsg(room, ws2, { type: 'vote', cardId: survivors[0].id });

          // --- Step 7: Result ---
          const result1 = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
          const result2 = getSent(ws2).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
          expect(result1).toBeDefined();
          expect(result2).toBeDefined();

          // Verify result card is one of the voted cards
          const survivorIds = survivors.map(c => c.id);
          expect(survivorIds).toContain(result1.card.id);

          // Verify votes include both players
          expect(Object.keys(result1.votes)).toHaveLength(2);
          expect(result1.votes[aliceId]).toBe(survivors[0].id);
          expect(result1.votes[bobId]).toBe(survivors[0].id);
        }
        break;
      }

      // Not converged yet - cards were passed
      const pass1 = getSent(ws1).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;
      const pass2 = getSent(ws2).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;
      expect(pass1).toBeDefined();
      expect(pass2).toBeDefined();

      round++;
      expect(pass1.round).toBe(round);
      hand1 = pass1.cards;
      hand2 = pass2.cards;

      // Safety: shouldn't take more than 10 rounds
      expect(round).toBeLessThan(10);
    }
  });

  it('3人プレイヤーの完全なゲームフロー', async () => {
    await initRoom(room, 'TRI', makeCards(12), 4);

    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    const ws3 = new MockWebSocket();

    await sendMsg(room, ws1, { type: 'join', name: 'Alice' });
    await sendMsg(room, ws2, { type: 'join', name: 'Bob' });
    await sendMsg(room, ws3, { type: 'join', name: 'Charlie' });

    await sendMsg(room, ws2, { type: 'ready' });
    await sendMsg(room, ws3, { type: 'ready' });

    ws1.clearSent();
    ws2.clearSent();
    ws3.clearSent();

    await sendMsg(room, ws1, { type: 'start' });

    const deal1 = getSent(ws1).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal2 = getSent(ws2).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    const deal3 = getSent(ws3).find(m => m.type === 'deal') as Extract<ServerMessage, { type: 'deal' }>;
    expect(deal1).toBeDefined();
    expect(deal2).toBeDefined();
    expect(deal3).toBeDefined();

    let hand1 = deal1.cards;
    let hand2 = deal2.cards;
    let hand3 = deal3.cards;
    let round = 1;

    while (true) {
      ws1.clearSent();
      ws2.clearSent();
      ws3.clearSent();

      // Keep 1 card each (discard the rest)
      const keep1 = [hand1[0]];
      const keep2 = [hand2[0]];
      const keep3 = [hand3[0]];

      await sendMsg(room, ws1, { type: 'select', cardIds: keep1.map(c => c.id) });
      await sendMsg(room, ws2, { type: 'select', cardIds: keep2.map(c => c.id) });
      await sendMsg(room, ws3, { type: 'select', cardIds: keep3.map(c => c.id) });

      const finalVote1 = getSent(ws1).find(m => m.type === 'final_vote');
      if (finalVote1) {
        expect(finalVote1.type === 'final_vote' && finalVote1.cards.length).toBeLessThanOrEqual(3);

        if (finalVote1.type === 'final_vote') {
          ws1.clearSent();
          ws2.clearSent();
          ws3.clearSent();

          await sendMsg(room, ws1, { type: 'vote', cardId: finalVote1.cards[0].id });
          await sendMsg(room, ws2, { type: 'vote', cardId: finalVote1.cards[0].id });
          await sendMsg(room, ws3, { type: 'vote', cardId: finalVote1.cards[0].id });

          const result = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
          expect(result).toBeDefined();
          expect(result.card.id).toBe(finalVote1.cards[0].id);
        }
        break;
      }

      const pass1 = getSent(ws1).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;
      const pass2 = getSent(ws2).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;
      const pass3 = getSent(ws3).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;
      expect(pass1).toBeDefined();
      expect(pass2).toBeDefined();
      expect(pass3).toBeDefined();

      round++;
      hand1 = pass1.cards;
      hand2 = pass2.cards;
      hand3 = pass3.cards;

      expect(round).toBeLessThan(10);
    }
  });

  it('2人で各1枚キープ → 即座にfinal_voteへ遷移する', async () => {
    // 4 cards, 2 per player → each keeps 1 → 2 remaining = 2 players → final_vote immediately
    await initRoom(room, 'FAST', makeCards(4), 2);

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

    // Should go directly to final_vote (no pass)
    const pass1 = getSent(ws1).find(m => m.type === 'pass');
    expect(pass1).toBeUndefined();

    const finalVote1 = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;
    expect(finalVote1).toBeDefined();
    expect(finalVote1.cards.length).toBeLessThanOrEqual(2);

    // Vote and get result
    ws1.clearSent();
    ws2.clearSent();
    await sendMsg(room, ws1, { type: 'vote', cardId: finalVote1.cards[0].id });
    await sendMsg(room, ws2, { type: 'vote', cardId: finalVote1.cards[0].id });

    const result = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
    expect(result).toBeDefined();
    expect(result.card.id).toBe(finalVote1.cards[0].id);
  });

  it('split vote (同票) の場合、結果はsurvivorsに含まれるカードから選ばれる', async () => {
    await initRoom(room, 'TIE', makeCards(4), 2);

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

    const finalVote = getSent(ws1).find(m => m.type === 'final_vote') as Extract<ServerMessage, { type: 'final_vote' }>;

    if (finalVote.cards.length >= 2) {
      ws1.clearSent();
      ws2.clearSent();

      // Each votes for different card → tie
      await sendMsg(room, ws1, { type: 'vote', cardId: finalVote.cards[0].id });
      await sendMsg(room, ws2, { type: 'vote', cardId: finalVote.cards[1].id });

      const result = getSent(ws1).find(m => m.type === 'result') as Extract<ServerMessage, { type: 'result' }>;
      expect(result).toBeDefined();
      const survivorIds = finalVote.cards.map(c => c.id);
      expect(survivorIds).toContain(result.card.id);
    }
  });

  it('right-rotation: パスされたカードが正しいプレイヤーに渡る', async () => {
    // 8 cards, 4 per player → each keeps 2 (discard 2) → 4 remaining > 2 players → pass
    await initRoom(room, 'PASS', makeCards(8), 4);

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

    // Alice keeps first 2, Bob keeps first 2
    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id, deal1.cards[1].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id, deal2.cards[1].id] });

    const pass1 = getSent(ws1).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;
    const pass2 = getSent(ws2).find(m => m.type === 'pass') as Extract<ServerMessage, { type: 'pass' }>;

    expect(pass1).toBeDefined();
    expect(pass2).toBeDefined();
    expect(pass1.round).toBe(2);

    // Right rotation: Alice gets Bob's kept cards, Bob gets Alice's kept cards
    expect(pass1.cards.map(c => c.id).sort()).toEqual([deal2.cards[0].id, deal2.cards[1].id].sort());
    expect(pass2.cards.map(c => c.id).sort()).toEqual([deal1.cards[0].id, deal1.cards[1].id].sort());
  });

  it('round_complete メッセージがパス時にブロードキャストされる', async () => {
    await initRoom(room, 'RC', makeCards(8), 4);

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

    await sendMsg(room, ws1, { type: 'select', cardIds: [deal1.cards[0].id, deal1.cards[1].id] });
    await sendMsg(room, ws2, { type: 'select', cardIds: [deal2.cards[0].id, deal2.cards[1].id] });

    const rc1 = getSent(ws1).find(m => m.type === 'round_complete') as Extract<ServerMessage, { type: 'round_complete' }>;
    expect(rc1).toBeDefined();
    expect(rc1.remaining).toBe(4); // 2+2 kept
    expect(rc1.round).toBe(2);
  });
});
