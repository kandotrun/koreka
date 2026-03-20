import { describe, it, expectTypeOf } from 'vitest';
import type {
  Card,
  CardCategory,
  Player,
  RoomPhase,
  RoomState,
  ClientMessage,
  ServerMessage,
  PlayerInfo,
  RoomPublicState,
  CreateRoomRequest,
  CreateRoomResponse,
} from '../types';

describe('WebSocket メッセージ型チェック', () => {
  describe('ClientMessage', () => {
    it('join メッセージの型が正しい', () => {
      const msg: ClientMessage = { type: 'join', name: 'Alice' };
      expectTypeOf(msg).toMatchTypeOf<ClientMessage>();
    });

    it('ready メッセージの型が正しい', () => {
      const msg: ClientMessage = { type: 'ready' };
      expectTypeOf(msg).toMatchTypeOf<ClientMessage>();
    });

    it('start メッセージの型が正しい', () => {
      const msg: ClientMessage = { type: 'start' };
      expectTypeOf(msg).toMatchTypeOf<ClientMessage>();
    });

    it('select メッセージの型が正しい', () => {
      const msg: ClientMessage = { type: 'select', cardIds: ['card-1', 'card-2'] };
      expectTypeOf(msg).toMatchTypeOf<ClientMessage>();
      if (msg.type === 'select') {
        expectTypeOf(msg.cardIds).toEqualTypeOf<string[]>();
      }
    });

    it('vote メッセージの型が正しい', () => {
      const msg: ClientMessage = { type: 'vote', cardId: 'card-1' };
      expectTypeOf(msg).toMatchTypeOf<ClientMessage>();
      if (msg.type === 'vote') {
        expectTypeOf(msg.cardId).toEqualTypeOf<string>();
      }
    });

    it('ping メッセージの型が正しい', () => {
      const msg: ClientMessage = { type: 'ping' };
      expectTypeOf(msg).toMatchTypeOf<ClientMessage>();
    });
  });

  describe('ServerMessage', () => {
    it('welcome メッセージの型が正しい', () => {
      const msg: ServerMessage = {
        type: 'welcome',
        playerId: 'p1',
        roomState: {
          code: '1234',
          phase: 'waiting',
          hostId: 'p1',
          players: [],
          round: 0,
        },
      };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('players メッセージの型が正しい', () => {
      const msg: ServerMessage = {
        type: 'players',
        players: [{ id: 'p1', name: 'Alice', ready: true }],
      };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('deal メッセージの型が正しい', () => {
      const msg: ServerMessage = {
        type: 'deal',
        cards: [{ id: '1', text: 'test', category: 'adventure', generated: false }],
        round: 1,
      };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('pass メッセージの型が正しい', () => {
      const msg: ServerMessage = {
        type: 'pass',
        cards: [{ id: '1', text: 'test', category: 'chill', generated: false }],
        round: 2,
      };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('waiting メッセージの型が正しい', () => {
      const msg: ServerMessage = { type: 'waiting', pending: ['Bob'] };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('round_complete メッセージの型が正しい', () => {
      const msg: ServerMessage = { type: 'round_complete', remaining: 4, round: 2 };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('final_vote メッセージの型が正しい', () => {
      const msg: ServerMessage = {
        type: 'final_vote',
        cards: [{ id: '1', text: 'test', category: 'food', generated: false }],
      };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('result メッセージの型が正しい', () => {
      const msg: ServerMessage = {
        type: 'result',
        card: { id: '1', text: 'test', category: 'night', generated: false },
        votes: { p1: '1', p2: '1' },
      };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('error メッセージの型が正しい', () => {
      const msg: ServerMessage = { type: 'error', message: 'room_full' };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });

    it('pong メッセージの型が正しい', () => {
      const msg: ServerMessage = { type: 'pong' };
      expectTypeOf(msg).toMatchTypeOf<ServerMessage>();
    });
  });

  describe('Card 型', () => {
    it('全カテゴリが CardCategory に含まれる', () => {
      const categories: CardCategory[] = [
        'adventure', 'chill', 'food', 'night', 'creative', 'random', 'spicy',
      ];
      expectTypeOf(categories).toMatchTypeOf<CardCategory[]>();
    });

    it('Card インターフェースが正しいフィールドを持つ', () => {
      const card: Card = {
        id: 'test-1',
        text: 'テストカード',
        category: 'adventure',
        generated: false,
      };
      expectTypeOf(card.id).toEqualTypeOf<string>();
      expectTypeOf(card.text).toEqualTypeOf<string>();
      expectTypeOf(card.category).toEqualTypeOf<CardCategory>();
      expectTypeOf(card.generated).toEqualTypeOf<boolean>();
    });
  });

  describe('RoomPhase', () => {
    it('全フェーズが定義されている', () => {
      const phases: RoomPhase[] = [
        'waiting', 'dealing', 'selecting', 'passing', 'voting', 'result',
      ];
      expectTypeOf(phases).toMatchTypeOf<RoomPhase[]>();
    });
  });

  describe('CreateRoomRequest / CreateRoomResponse', () => {
    it('CreateRoomRequest が正しいフィールドを持つ', () => {
      const req: CreateRoomRequest = {
        hostName: 'Alice',
        settings: {
          cardsPerPlayer: 5,
          categories: ['adventure', 'food'],
        },
      };
      expectTypeOf(req.hostName).toEqualTypeOf<string>();
    });

    it('CreateRoomResponse が正しいフィールドを持つ', () => {
      const res: CreateRoomResponse = {
        roomId: 'abc',
        code: '1234',
        wsUrl: 'ws://localhost/ws',
      };
      expectTypeOf(res.roomId).toEqualTypeOf<string>();
      expectTypeOf(res.code).toEqualTypeOf<string>();
      expectTypeOf(res.wsUrl).toEqualTypeOf<string>();
    });
  });
});
