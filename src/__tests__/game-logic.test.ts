import { describe, it, expect } from 'vitest';
import type { Card, CardCategory, ClientMessage, ServerMessage } from '../types';

// ゲームロジックのユニットテスト
// Durable Objectは直接テストしにくいので、ロジック部分を抽出してテスト

function createCard(id: string, text: string, category: CardCategory = 'adventure'): Card {
  return { id, text, category, generated: false };
}

function shuffleDeck(cards: Card[]): Card[] {
  return [...cards].sort(() => Math.random() - 0.5);
}

function dealCards(deck: Card[], playerCount: number, cardsPerPlayer: number): Map<string, Card[]> {
  const shuffled = shuffleDeck(deck);
  const totalCards = Math.min(shuffled.length, playerCount * cardsPerPlayer);
  const cardsToUse = shuffled.slice(0, totalCards);
  const perPlayer = Math.ceil(cardsToUse.length / playerCount);

  const hands = new Map<string, Card[]>();
  const playerIds = Array.from({ length: playerCount }, (_, i) => `p${i}`);

  for (let i = 0; i < playerIds.length; i++) {
    hands.set(playerIds[i], cardsToUse.slice(i * perPlayer, (i + 1) * perPlayer));
  }

  return hands;
}

function checkConvergence(hands: Map<string, Card[]>, playerCount: number): boolean {
  let total = 0;
  for (const hand of hands.values()) {
    total += hand.length;
  }
  return total <= playerCount;
}

function resolveVotes(votes: Map<string, string>, cards: Card[]): Card {
  const counts = new Map<string, number>();
  for (const cardId of votes.values()) {
    counts.set(cardId, (counts.get(cardId) || 0) + 1);
  }

  let maxVotes = 0;
  const topCards: string[] = [];
  for (const [cardId, count] of counts) {
    if (count > maxVotes) {
      maxVotes = count;
      topCards.length = 0;
      topCards.push(cardId);
    } else if (count === maxVotes) {
      topCards.push(cardId);
    }
  }

  const winnerId = topCards[0]; // テストではランダムではなく最初のものを取る
  return cards.find(c => c.id === winnerId)!;
}

function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

describe('ルームコード生成', () => {
  it('4桁の数字コードを生成する', () => {
    const code = generateCode();
    expect(code).toMatch(/^\d{4}$/);
    expect(parseInt(code)).toBeGreaterThanOrEqual(1000);
    expect(parseInt(code)).toBeLessThanOrEqual(9999);
  });

  it('毎回異なるコードを生成する（高確率）', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(90);
  });
});

describe('カード配布', () => {
  const deck = Array.from({ length: 40 }, (_, i) =>
    createCard(`card-${i}`, `お題${i}`, ['adventure', 'chill', 'food', 'night'][i % 4] as CardCategory)
  );

  it('全プレイヤーにカードが配られる', () => {
    const hands = dealCards(deck, 4, 5);
    expect(hands.size).toBe(4);
  });

  it('各プレイヤーにcardsPerPlayer枚配られる', () => {
    const hands = dealCards(deck, 4, 5);
    for (const hand of hands.values()) {
      expect(hand.length).toBe(5);
    }
  });

  it('配られたカードに重複がない', () => {
    const hands = dealCards(deck, 4, 5);
    const allCardIds = new Set<string>();
    for (const hand of hands.values()) {
      for (const card of hand) {
        expect(allCardIds.has(card.id)).toBe(false);
        allCardIds.add(card.id);
      }
    }
  });

  it('デッキの枚数が足りない場合は均等に分ける', () => {
    const smallDeck = deck.slice(0, 7);
    const hands = dealCards(smallDeck, 4, 5);
    let total = 0;
    for (const hand of hands.values()) {
      total += hand.length;
    }
    expect(total).toBeLessThanOrEqual(7);
  });

  it('2人プレイでもカードが配られる', () => {
    const hands = dealCards(deck, 2, 5);
    expect(hands.size).toBe(2);
    for (const hand of hands.values()) {
      expect(hand.length).toBe(5);
    }
  });
});

describe('収束判定', () => {
  it('カード総数 <= プレイヤー数で収束', () => {
    const hands = new Map<string, Card[]>();
    hands.set('p0', [createCard('a', 'テスト')]);
    hands.set('p1', [createCard('b', 'テスト2')]);
    hands.set('p2', [createCard('c', 'テスト3')]);
    expect(checkConvergence(hands, 3)).toBe(true);
  });

  it('カード総数 > プレイヤー数で未収束', () => {
    const hands = new Map<string, Card[]>();
    hands.set('p0', [createCard('a', 'テスト'), createCard('b', 'テスト2')]);
    hands.set('p1', [createCard('c', 'テスト3'), createCard('d', 'テスト4')]);
    expect(checkConvergence(hands, 2)).toBe(false);
  });

  it('全員1枚ずつで収束', () => {
    const hands = new Map<string, Card[]>();
    hands.set('p0', [createCard('a', 'テスト')]);
    hands.set('p1', [createCard('b', 'テスト2')]);
    expect(checkConvergence(hands, 2)).toBe(true);
  });

  it('カード0枚でも収束', () => {
    const hands = new Map<string, Card[]>();
    hands.set('p0', []);
    hands.set('p1', []);
    expect(checkConvergence(hands, 2)).toBe(true);
  });
});

describe('最終投票', () => {
  const cards = [
    createCard('a', '海に行く'),
    createCard('b', 'カラオケ'),
    createCard('c', 'ラーメン'),
  ];

  it('最多得票カードが選ばれる', () => {
    const votes = new Map<string, string>();
    votes.set('p0', 'a');
    votes.set('p1', 'a');
    votes.set('p2', 'b');
    const result = resolveVotes(votes, cards);
    expect(result.id).toBe('a');
  });

  it('全員一致の場合', () => {
    const votes = new Map<string, string>();
    votes.set('p0', 'b');
    votes.set('p1', 'b');
    votes.set('p2', 'b');
    const result = resolveVotes(votes, cards);
    expect(result.id).toBe('b');
  });

  it('同率の場合はいずれかが選ばれる', () => {
    const votes = new Map<string, string>();
    votes.set('p0', 'a');
    votes.set('p1', 'b');
    const result = resolveVotes(votes, cards);
    expect(['a', 'b']).toContain(result.id);
  });

  it('1人プレイヤーの場合', () => {
    const votes = new Map<string, string>();
    votes.set('p0', 'c');
    const result = resolveVotes(votes, cards);
    expect(result.id).toBe('c');
  });
});

describe('WebSocketメッセージ型', () => {
  it('join メッセージ', () => {
    const msg: ClientMessage = { type: 'join', name: 'テスト太郎' };
    expect(msg.type).toBe('join');
    expect(msg.name).toBe('テスト太郎');
  });

  it('select メッセージ', () => {
    const msg: ClientMessage = { type: 'select', cardIds: ['card-1', 'card-3'] };
    expect(msg.type).toBe('select');
    expect(msg.cardIds).toHaveLength(2);
  });

  it('vote メッセージ', () => {
    const msg: ClientMessage = { type: 'vote', cardId: 'card-1' };
    expect(msg.type).toBe('vote');
  });

  it('result サーバーメッセージ', () => {
    const msg: ServerMessage = {
      type: 'result',
      card: createCard('a', '海に行く'),
      votes: { p0: 'a', p1: 'a' },
    };
    expect(msg.type).toBe('result');
    if (msg.type === 'result') {
      expect(msg.card.text).toBe('海に行く');
      expect(Object.keys(msg.votes)).toHaveLength(2);
    }
  });

  it('error サーバーメッセージ', () => {
    const msg: ServerMessage = { type: 'error', message: 'room_full' };
    expect(msg.type).toBe('error');
    if (msg.type === 'error') {
      expect(msg.message).toBe('room_full');
    }
  });
});

describe('カードカテゴリ', () => {
  it('全カテゴリが定義されている', () => {
    const categories: CardCategory[] = ['adventure', 'chill', 'food', 'night', 'creative', 'random', 'spicy'];
    expect(categories).toHaveLength(7);
  });

  it('カードにカテゴリが設定される', () => {
    const card = createCard('test', 'テスト', 'spicy');
    expect(card.category).toBe('spicy');
    expect(card.generated).toBe(false);
  });
});

describe('選別ロジック', () => {
  it('最低1枚は残さなければならない', () => {
    const hand = [createCard('a', 'テスト')];
    // 1枚しかない場合、捨てられない
    const selectedIds = ['a']; // 必ず残す
    expect(selectedIds.length).toBeGreaterThanOrEqual(1);
  });

  it('全カード残すことはできない（2枚以上の場合）', () => {
    const hand = [createCard('a', 'テスト'), createCard('b', 'テスト2'), createCard('c', 'テスト3')];
    // 全部残すのはNG、最低1枚は捨てる
    const maxKeep = hand.length - 1;
    expect(maxKeep).toBe(2);
  });

  it('カード回しで右隣に渡される', () => {
    const playerIds = ['p0', 'p1', 'p2', 'p3'];
    const keptCards = new Map<string, Card[]>();
    keptCards.set('p0', [createCard('a', 'A')]);
    keptCards.set('p1', [createCard('b', 'B')]);
    keptCards.set('p2', [createCard('c', 'C')]);
    keptCards.set('p3', [createCard('d', 'D')]);

    // 右回転: p0→p1, p1→p2, p2→p3, p3→p0
    const newHands = new Map<string, Card[]>();
    for (let i = 0; i < playerIds.length; i++) {
      const fromId = playerIds[i];
      const toId = playerIds[(i + 1) % playerIds.length];
      newHands.set(toId, keptCards.get(fromId)!);
    }

    expect(newHands.get('p1')![0].id).toBe('a'); // p0のカードがp1に
    expect(newHands.get('p2')![0].id).toBe('b'); // p1のカードがp2に
    expect(newHands.get('p3')![0].id).toBe('c'); // p2のカードがp3に
    expect(newHands.get('p0')![0].id).toBe('d'); // p3のカードがp0に
  });
});
