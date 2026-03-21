import type { Card, PlayerInfo, RoomPhase, ServerMessage, ClientMessage, RoomPublicState } from '../types';
import type { Env } from '../env';

interface PlayerState {
  id: string;
  name: string;
  ready: boolean;
  ws: WebSocket | null;
  selectedCards: string[];
}

interface InternalRoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: Map<string, PlayerState>;
  deck: Card[];
  hands: Map<string, Card[]>;
  round: number;
  survivors: Card[];
  result: Card | null;
  votes: Map<string, string>;
  cardsPerPlayer: number;
}

interface PersistentRoomData {
  code: string;
  phase: RoomPhase;
  hostId: string;
  deck: Card[];
  round: number;
  survivors: Card[];
  cardsPerPlayer: number;
  hands: Record<string, Card[]>;
  votes: Record<string, string>;
}

// WebSocket attachmentに保存するプレイヤーデータ
interface WsAttachment {
  id: string;
  name: string;
  ready: boolean;
  selectedCards: string[];
}

export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room: InternalRoomState;
  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.room = {
      code: '',
      phase: 'waiting',
      hostId: '',
      players: new Map(),
      deck: [],
      hands: new Map(),
      round: 0,
      survivors: [],
      result: null,
      votes: new Map(),
      cardsPerPlayer: 5,
    };
  }

  /**
   * ハイバネーション復帰時にStorageとWebSocket attachmentsからステートを復元
   */
  private async restore() {
    if (this.initialized) return;
    this.initialized = true;

    // 1. Storageからゲーム状態を復元
    const saved = await this.state.storage.get<PersistentRoomData>('room');
    if (saved) {
      this.room.code = saved.code;
      this.room.phase = saved.phase;
      this.room.hostId = saved.hostId;
      this.room.deck = saved.deck;
      this.room.cardsPerPlayer = saved.cardsPerPlayer;
      this.room.round = saved.round;
      this.room.survivors = saved.survivors || [];
      this.room.hands = new Map(Object.entries(saved.hands || {}));
      this.room.votes = new Map(Object.entries(saved.votes || {}));
    }

    // 2. WebSocket attachmentsからプレイヤーを復元
    const webSockets = this.state.getWebSockets();
    for (const ws of webSockets) {
      try {
        const attachment = ws.deserializeAttachment() as WsAttachment | null;
        if (attachment?.id) {
          this.room.players.set(attachment.id, {
            id: attachment.id,
            name: attachment.name,
            ready: attachment.ready ?? false,
            ws,
            selectedCards: attachment.selectedCards || [],
          });
        }
      } catch {
        // 壊れたattachmentは無視
      }
    }
  }

  private async persist() {
    const data: PersistentRoomData = {
      code: this.room.code,
      phase: this.room.phase,
      hostId: this.room.hostId,
      deck: this.room.deck,
      round: this.room.round,
      survivors: this.room.survivors,
      cardsPerPlayer: this.room.cardsPerPlayer,
      hands: Object.fromEntries(this.room.hands),
      votes: Object.fromEntries(this.room.votes),
    };
    await this.state.storage.put('room', data);
  }

  /** WebSocket attachmentにプレイヤー状態を保存 */
  private saveAttachment(player: PlayerState) {
    if (!player.ws) return;
    try {
      const data: WsAttachment = {
        id: player.id,
        name: player.name,
        ready: player.ready,
        selectedCards: player.selectedCards,
      };
      player.ws.serializeAttachment(data);
    } catch {
      // WS already closed
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.restore();
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.handleWebSocket(request);
    }

    if (url.pathname === '/init') {
      // /init は内部呼び出し専用（Workers runtime の fetch() 経由のみ）
      // Cloudflare DOはpublicにfetchできないので実質認証済み
      const body = await request.json() as { code: string; cards: Card[]; cardsPerPlayer?: number };
      if (!body.code || !Array.isArray(body.cards) || body.cards.length === 0) {
        return new Response(JSON.stringify({ error: 'invalid_init' }), { status: 400 });
      }
      this.room.code = body.code;
      this.room.deck = body.cards;
      if (body.cardsPerPlayer && body.cardsPerPlayer > 0 && body.cardsPerPlayer <= 50) {
        this.room.cardsPerPlayer = body.cardsPerPlayer;
      }
      await this.persist();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/info') {
      return new Response(JSON.stringify(this.getPublicState()));
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.restore();
    if (typeof message !== 'string') return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      this.send(ws, { type: 'error', message: 'invalid_json' });
      return;
    }

    switch (msg.type) {
      case 'join':
        await this.handleJoin(ws, msg.name, msg.playerId);
        break;
      case 'ready':
        await this.handleReady(ws);
        break;
      case 'start':
        await this.handleStart(ws);
        break;
      case 'select':
        await this.handleSelect(ws, msg.cardIds);
        break;
      case 'vote':
        await this.handleVote(ws, msg.cardId);
        break;
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.restore();
    this.removePlayer(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.restore();
    this.removePlayer(ws);
  }

  private async handleJoin(ws: WebSocket, rawName: string, existingId?: string) {
    // 名前サニタイズ: 空白トリム、長さ制限、制御文字除去
    const name = rawName.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 20) || 'ゲスト';

    // 再接続: 既存のplayerIdがあればWSだけ差し替え
    if (existingId && this.room.players.has(existingId)) {
      const player = this.room.players.get(existingId)!;

      // 古いWSがあれば閉じる
      if (player.ws && player.ws !== ws) {
        try { player.ws.close(1000, 'reconnect'); } catch {}
      }

      player.ws = ws;
      player.name = name;
      this.saveAttachment(player);

      this.send(ws, {
        type: 'welcome',
        playerId: existingId,
        roomState: this.getPublicState(),
      });

      // ゲーム中なら手札も再送
      if (this.room.phase === 'selecting') {
        const hand = this.room.hands.get(existingId);
        if (hand) {
          this.send(ws, { type: 'deal', cards: hand, round: this.room.round });
        }
      } else if (this.room.phase === 'voting') {
        this.send(ws, { type: 'final_vote', cards: this.room.survivors });
      }

      this.broadcastPlayers();
      return;
    }

    // ゲーム中は新規参加ブロック
    if (this.room.phase !== 'waiting') {
      this.send(ws, { type: 'error', message: 'game_in_progress' });
      return;
    }

    if (this.room.players.size >= 8) {
      this.send(ws, { type: 'error', message: 'room_full' });
      return;
    }

    const playerId = crypto.randomUUID().slice(0, 8);
    const player: PlayerState = {
      id: playerId,
      name,
      ready: false,
      ws,
      selectedCards: [],
    };

    this.room.players.set(playerId, player);
    this.saveAttachment(player);

    // First player is the host (only if no host set)
    if (!this.room.hostId || !this.room.players.has(this.room.hostId)) {
      this.room.hostId = playerId;
    }

    await this.persist();

    this.send(ws, {
      type: 'welcome',
      playerId,
      roomState: this.getPublicState(),
    });

    this.broadcastPlayers();
  }

  private async handleReady(ws: WebSocket) {
    const player = this.findPlayer(ws);
    if (!player) return;

    player.ready = !player.ready;
    this.saveAttachment(player);
    this.broadcastPlayers();
  }

  private async handleStart(ws: WebSocket) {
    const player = this.findPlayer(ws);
    if (!player) return;

    if (player.id !== this.room.hostId) {
      this.send(ws, { type: 'error', message: 'not_host' });
      return;
    }

    if (this.room.players.size < 2) {
      this.send(ws, { type: 'error', message: 'need_more_players' });
      return;
    }

    const allReady = [...this.room.players.values()].every(p => p.id === this.room.hostId || p.ready);
    if (!allReady) {
      this.send(ws, { type: 'error', message: 'not_all_ready' });
      return;
    }

    await this.startGame();
  }

  private async startGame() {
    this.room.phase = 'dealing';
    this.room.round = 1;

    // Fisher-Yates shuffle（均一な分布）
    const shuffled = [...this.room.deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const playerCount = this.room.players.size;
    const totalCards = Math.min(shuffled.length, playerCount * this.room.cardsPerPlayer);
    const cardsToUse = shuffled.slice(0, totalCards);
    const perPlayer = Math.ceil(cardsToUse.length / playerCount);

    // Deal cards
    const playerIds = [...this.room.players.keys()];
    this.room.hands = new Map();

    for (let i = 0; i < playerIds.length; i++) {
      const hand = cardsToUse.slice(i * perPlayer, (i + 1) * perPlayer);
      this.room.hands.set(playerIds[i], hand);
    }

    // Send dealt cards to each player
    this.room.phase = 'selecting';
    for (const [playerId, hand] of this.room.hands) {
      const player = this.room.players.get(playerId);
      if (player) {
        this.send(player.ws, { type: 'deal', cards: hand, round: this.room.round });
      }
    }
    await this.persist();
  }

  private async handleSelect(ws: WebSocket, cardIds: string[]) {
    const player = this.findPlayer(ws);
    if (!player || this.room.phase !== 'selecting') return;

    const hand = this.room.hands.get(player.id);
    if (!hand) return;

    // Validate
    const handIds = new Set(hand.map(c => c.id));
    const validSelection = cardIds.every(id => handIds.has(id));
    if (!validSelection || cardIds.length === 0) {
      this.send(ws, { type: 'error', message: 'invalid_selection' });
      return;
    }

    if (cardIds.length >= hand.length && hand.length > 1) {
      this.send(ws, { type: 'error', message: 'invalid_selection' });
      return;
    }

    player.selectedCards = cardIds;
    this.saveAttachment(player);

    // Check if all players have selected
    const allSelected = [...this.room.players.values()].every(p => p.selectedCards.length > 0);

    if (!allSelected) {
      const pending = [...this.room.players.values()]
        .filter(p => p.selectedCards.length === 0)
        .map(p => p.name);
      this.broadcast({ type: 'waiting', pending });
      return;
    }

    await this.passCards();
  }

  private async passCards() {
    this.room.phase = 'passing';
    const playerIds = [...this.room.players.keys()];
    const playerCount = playerIds.length;

    const keptCards = new Map<string, Card[]>();
    let totalRemaining = 0;

    for (const [playerId, player] of this.room.players) {
      const hand = this.room.hands.get(playerId) || [];
      const kept = hand.filter(c => player.selectedCards.includes(c.id));
      keptCards.set(playerId, kept);
      totalRemaining += kept.length;
    }

    if (totalRemaining <= playerCount) {
      await this.startFinalVote(keptCards);
      return;
    }

    this.room.round++;
    const newHands = new Map<string, Card[]>();

    for (let i = 0; i < playerCount; i++) {
      const fromId = playerIds[i];
      const toId = playerIds[(i + 1) % playerCount];
      const cards = keptCards.get(fromId) || [];
      newHands.set(toId, cards);
    }

    this.room.hands = newHands;

    for (const player of this.room.players.values()) {
      player.selectedCards = [];
      this.saveAttachment(player);
    }

    this.room.phase = 'selecting';
    for (const [playerId, hand] of this.room.hands) {
      const player = this.room.players.get(playerId);
      if (player) {
        this.send(player.ws, { type: 'pass', cards: hand, round: this.room.round });
      }
    }

    this.broadcast({ type: 'round_complete', remaining: totalRemaining, round: this.room.round });
    await this.persist();
  }

  private async startFinalVote(keptCards: Map<string, Card[]>) {
    this.room.phase = 'voting';
    this.room.votes = new Map();

    const allCards: Card[] = [];
    const seen = new Set<string>();
    for (const cards of keptCards.values()) {
      for (const card of cards) {
        if (!seen.has(card.id)) {
          allCards.push(card);
          seen.add(card.id);
        }
      }
    }

    this.room.survivors = allCards;

    for (const player of this.room.players.values()) {
      player.selectedCards = [];
      this.saveAttachment(player);
    }

    this.broadcast({ type: 'final_vote', cards: allCards });
    await this.persist();
  }

  private async handleVote(ws: WebSocket, cardId: string) {
    const player = this.findPlayer(ws);
    if (!player || this.room.phase !== 'voting') return;

    if (this.room.votes.has(player.id)) {
      this.send(ws, { type: 'error', message: 'already_voted' });
      return;
    }

    const validCard = this.room.survivors.some(c => c.id === cardId);
    if (!validCard) {
      this.send(ws, { type: 'error', message: 'invalid_selection' });
      return;
    }

    this.room.votes.set(player.id, cardId);

    if (this.room.votes.size >= this.room.players.size) {
      await this.resolveResult();
    } else {
      const pending = [...this.room.players.values()]
        .filter(p => !this.room.votes.has(p.id))
        .map(p => p.name);
      this.broadcast({ type: 'waiting', pending });
    }
  }

  private async resolveResult() {
    this.room.phase = 'result';

    const voteCounts = new Map<string, number>();
    for (const cardId of this.room.votes.values()) {
      voteCounts.set(cardId, (voteCounts.get(cardId) || 0) + 1);
    }

    let maxVotes = 0;
    const topCards: string[] = [];
    for (const [cardId, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        topCards.length = 0;
        topCards.push(cardId);
      } else if (count === maxVotes) {
        topCards.push(cardId);
      }
    }

    const winnerId = topCards[Math.floor(Math.random() * topCards.length)];
    const winnerCard = this.room.survivors.find(c => c.id === winnerId)!;
    this.room.result = winnerCard;

    const votes: Record<string, string> = {};
    for (const [playerId, cardId] of this.room.votes) {
      votes[playerId] = cardId;
    }

    this.broadcast({ type: 'result', card: winnerCard, votes });
    await this.persist();

    // Save result_card_id and finished_at to D1
    try {
      await this.env.DB.prepare(
        'UPDATE rooms SET result_card_id = ?, player_count = ?, finished_at = datetime(\'now\') WHERE code = ?'
      ).bind(winnerCard.id, this.room.players.size, this.room.code).run();
    } catch {
      // D1 write failure is non-fatal for game flow
    }
  }

  private findPlayer(ws: WebSocket): PlayerState | undefined {
    for (const player of this.room.players.values()) {
      if (player.ws === ws) return player;
    }
    return undefined;
  }

  private removePlayer(ws: WebSocket) {
    const player = this.findPlayer(ws);
    if (!player) return;

    player.ws = null;

    // waitingフェーズなら30秒後に削除
    if (this.room.phase === 'waiting') {
      this.state.storage.setAlarm(Date.now() + 30_000).catch(() => {});
    }

    this.broadcastPlayers();
  }

  async alarm() {
    await this.restore();
    if (this.room.phase !== 'waiting') return;

    const toRemove: string[] = [];
    for (const [id, player] of this.room.players) {
      if (player.ws === null) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.room.players.delete(id);
      this.room.hands.delete(id);
    }

    if (this.room.players.size > 0) {
      if (toRemove.includes(this.room.hostId)) {
        const firstPlayer = this.room.players.values().next().value;
        if (firstPlayer) {
          this.room.hostId = firstPlayer.id;
        }
      }
      await this.persist();
      this.broadcastPlayers();
    }
  }

  private getPublicState(): RoomPublicState {
    return {
      code: this.room.code,
      phase: this.room.phase,
      hostId: this.room.hostId,
      players: this.getPlayerInfoList(),
      round: this.room.round,
    };
  }

  private getPlayerInfoList(): PlayerInfo[] {
    return [...this.room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
    }));
  }

  private send(ws: WebSocket | null, msg: ServerMessage) {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // WebSocket closed
    }
  }

  private broadcast(msg: ServerMessage) {
    for (const player of this.room.players.values()) {
      this.send(player.ws, msg);
    }
  }

  private broadcastPlayers() {
    this.broadcast({ type: 'players', players: this.getPlayerInfoList() });
  }
}
