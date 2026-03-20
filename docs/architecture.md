# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                     │
│                                                           │
│  ┌─────────────┐    ┌──────────────────────────────────┐ │
│  │  Hono API   │    │     Durable Object: Room         │ │
│  │             │    │                                  │ │
│  │ GET  /      │    │  - participants[]                │ │
│  │ POST /rooms │───▶│  - deck (shuffled cards)         │ │
│  │ WS   /ws    │    │  - hands (per player)            │ │
│  │             │    │  - phase (waiting/selecting/done) │ │
│  │ Static SPA  │    │  - WebSocket connections          │ │
│  └─────────────┘    └──────────────────────────────────┘ │
│         │                        │                        │
│         ▼                        ▼                        │
│  ┌─────────────┐    ┌──────────────────────────────────┐ │
│  │ Workers AI  │    │        Cloudflare D1              │ │
│  │ (お題生成)   │    │  - cards (お題マスタ)              │ │
│  │             │    │  - rooms (履歴)                   │ │
│  └─────────────┘    │  - memories (思い出記録)           │ │
│                      └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    Client (PWA)                           │
│                                                           │
│  Vite + React SPA                                        │
│  - WebSocket connection to Durable Object                │
│  - Swipe UI for card selection                           │
│  - PWA manifest + Service Worker                         │
└─────────────────────────────────────────────────────────┘
```

## Project Structure

```
koreka/
├── src/
│   ├── index.ts              # Hono Workers entry point
│   ├── routes/
│   │   ├── rooms.ts          # POST /api/rooms (create)
│   │   ├── cards.ts          # GET /api/cards (list)
│   │   └── ws.ts             # WebSocket upgrade handler
│   ├── durable-objects/
│   │   └── room.ts           # Room Durable Object
│   ├── db/
│   │   ├── schema.sql        # D1 schema
│   │   └── seed.sql          # 初期お題データ
│   └── types.ts              # Shared types
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Home.tsx      # ルーム作成 / 参加
│   │   │   ├── Lobby.tsx     # 待機室
│   │   │   ├── Game.tsx      # カード選別 (swipe)
│   │   │   └── Result.tsx    # 結果表示
│   │   ├── components/
│   │   │   ├── Card.tsx      # カードUI
│   │   │   ├── SwipeArea.tsx # スワイプ操作
│   │   │   └── QRCode.tsx    # QRコード表示
│   │   ├── hooks/
│   │   │   ├── useRoom.ts    # WebSocket接続管理
│   │   │   └── useSwipe.ts   # スワイプジェスチャー
│   │   └── lib/
│   │       └── ws.ts         # WebSocket client
│   ├── public/
│   │   ├── manifest.json     # PWA manifest
│   │   └── sw.js             # Service Worker
│   ├── index.html
│   └── vite.config.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
└── docs/
    ├── architecture.md       # This file
    ├── game-flow.md          # ゲームフロー詳細
    └── api.md                # API仕様
```

## Durable Object: Room

1ルーム = 1 Durable Object インスタンス。全てのゲーム状態をメモリ上で管理し、
接続中の全プレイヤーにWebSocketでリアルタイム配信する。

### State

```typescript
interface RoomState {
  id: string;                     // 4桁ルームコード
  phase: 'waiting' | 'dealing' | 'selecting' | 'passing' | 'result';
  hostId: string;                 // ルーム作成者
  players: Player[];              // 参加者一覧
  deck: Card[];                   // シャッフル済みデッキ
  hands: Map<string, Card[]>;     // プレイヤーID → 手札
  round: number;                  // 現在のラウンド
  survivors: Card[];              // 生き残りカード
  result: Card | null;            // 最終結果
  createdAt: number;
}

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  ready: boolean;
  selectedCards: string[];        // 残したカードID
}

interface Card {
  id: string;
  text: string;                   // お題テキスト
  category: string;               // カテゴリ (adventure / chill / food / ...)
  generated: boolean;             // AI生成かどうか
}
```

### Lifecycle

```
create room → waiting for players
                    │
         all ready (host starts)
                    │
              deal cards (N枚/人)
                    │
         ┌── selecting phase ──┐
         │   各自スワイプで選別   │
         │   keep or discard    │
         └──────────────────────┘
                    │
              pass to next player
                    │
            (repeat until converge)
                    │
              result: 1 card remains
                    │
              show "これか！" screen
```

## WebSocket Protocol

全メッセージはJSON。`type` フィールドで識別する。

### Client → Server

```typescript
// ルーム参加
{ type: 'join', name: string }

// 準備完了
{ type: 'ready' }

// カード選択結果（残すカードのIDリスト）
{ type: 'select', cardIds: string[] }
```

### Server → Client

```typescript
// 参加者更新
{ type: 'players', players: { id: string, name: string, ready: boolean }[] }

// ゲーム開始 & 手札配布
{ type: 'deal', cards: Card[], round: number }

// 回ってきたカード（隣のプレイヤーから）
{ type: 'pass', cards: Card[], round: number }

// 全員選択完了
{ type: 'round_complete', remaining: number }

// 最終結果
{ type: 'result', card: Card }

// エラー
{ type: 'error', message: string }
```

## Game Algorithm

### カード選別ロジック

1. **配布**: デッキから各プレイヤーに `ceil(totalCards / playerCount)` 枚配る
2. **選別**: 各自が手札から「やりたい」カードだけ残す（最低1枚）
3. **回す**: 残したカードを右隣のプレイヤーに渡す
4. **繰り返し**: 2-3 を繰り返す
5. **収束判定**: 全員の手札が `playerCount` 枚以下になったら最終投票
6. **最終投票**: 各自1枚選ぶ → 最多得票カードが結果

### 収束の保証

- 毎ラウンド、各プレイヤーは最低1枚は捨てなければならない
- カード総数は単調減少するので、必ず収束する
- 最悪ケースでも `initialHandSize` ラウンドで終了

## D1 Schema

```sql
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  result_card_id TEXT,
  player_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  photo_url TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_memories_room ON memories(room_id);
```

## AI お題生成

Gemini API（無料枠）を使い、2つの経路でお題を生成する。

### 生成パターン

#### ① 日次バッチ生成（GitHub Actions）

毎日0:00 JSTに自動実行。お題プールを継続的に拡充する。

- **頻度**: 1日1回
- **生成数**: 50個/回
- **API**: Gemini (gemini-2.5-flash, 無料枠)
- **保存先**: Cloudflare D1 (cards テーブル)
- **重複チェック**: テキスト類似度で既存カードとの重複を排除
- **コスト**: 0円（Gemini API 無料枠内）

```yaml
# .github/workflows/generate-cards.yml
name: Generate Cards
on:
  schedule:
    - cron: '0 15 * * *'  # 毎日 00:00 JST
  workflow_dispatch:       # 手動実行

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: pnpm install
      - run: pnpm run generate-cards
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```

バッチ生成時は以下の変数でバリエーションを出す:
- **季節**: 春/夏/秋/冬
- **時間帯**: 朝/昼/夕方/夜
- **曜日**: 平日/休日
- **シチュエーション**: 飲み会後/旅行中/初対面/カップル etc.

#### ② ユーザーオンデマンド生成

ルーム作成時に「AIでお題を生成」ボタンを押すと、
その場のコンテキストに合わせたお題を即時生成する。

- **生成数**: 10個/回
- **API**: Gemini (gemini-2.5-flash, 無料枠)
- **レートリミット**: 1ルームあたり3回まで（無料枠保護）

### スケール予測

| 期間 | 累計お題数 |
|------|-----------|
| 1週間 | 350枚 |
| 1ヶ月 | 1,500枚 |
| 3ヶ月 | 4,500枚 |
| 6ヶ月 | 9,000枚 |

### Input

```typescript
interface GenerateRequest {
  context?: {
    time: 'morning' | 'afternoon' | 'evening' | 'night';
    season?: 'spring' | 'summer' | 'autumn' | 'winter';
    weather?: string;
    location?: string;         // GPS or 手入力
    playerCount: number;
    mood?: 'chill' | 'adventure' | 'romantic' | 'party';
    situation?: string;        // 飲み会後、旅行中 etc.
  };
  count: number;               // 生成枚数
  exclude: string[];           // 既存カードIDリスト（重複防止）
}
```

### Prompt Strategy

```
あなたは「次何する？」を決めるカードゲームのお題を考えるクリエイターです。

条件:
- {playerCount}人で遊んでいます
- 時間帯: {time}
- 季節: {season}
- 場所: {location}
- ムード: {mood}
- シチュエーション: {situation}

以下のルールでお題を{count}個生成してください:
1. 「普段やらないけど、やってみたら最高の思い出になる」こと
2. その場で実行可能なこと
3. 参加者全員が楽しめること
4. 1つのお題は30文字以内
5. 具体的なアクションであること（抽象的なNG）
6. 既存のお題と被らないこと

JSONの配列で返してください:
[{ "text": "お題テキスト", "category": "カテゴリ" }]
```

### 品質管理

- 生成後にフィルタリング: 不適切/危険/実行不可能なお題を除外
- 文字数チェック: 30文字以内
- 重複チェック: Levenshtein距離 or embedding類似度で既存カードと比較
- カテゴリバランス: バッチ生成時はカテゴリ偏りを検出して次回の生成パラメータに反映

## PWA Configuration

```json
{
  "name": "Koreka",
  "short_name": "Koreka",
  "description": "みんなで「次何する？」を決めるカードゲーム",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#FF6B35",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## Deployment

```bash
# D1 database作成
wrangler d1 create koreka-db

# schema適用
wrangler d1 execute koreka-db --file=src/db/schema.sql

# 初期お題データ投入
wrangler d1 execute koreka-db --file=src/db/seed.sql

# デプロイ
pnpm build && wrangler deploy
```

## wrangler.toml

```toml
name = "koreka"
main = "src/index.ts"
compatibility_date = "2026-03-20"

[assets]
directory = "frontend/dist"

[[d1_databases]]
binding = "DB"
database_name = "koreka-db"
database_id = "<YOUR_DB_ID>"

[[durable_objects.bindings]]
name = "ROOM"
class_name = "RoomDurableObject"

[[migrations]]
tag = "v1"
new_classes = ["RoomDurableObject"]
```

## Performance Targets

| Metric | Target |
|--------|--------|
| First Contentful Paint | < 1.5s |
| WebSocket latency | < 100ms |
| Max concurrent rooms | 10,000+ (Durable Objects) |
| Max players per room | 8 |
| Card pool size | 200+ (initial) + AI generated |

## Future (Post-MVP)

- 📸 思い出記録: 結果実行後に写真+コメント保存
- 🎨 カスタムデッキ: ユーザーがオリジナルお題セットを作成
- 🌍 多言語対応: 英語・韓国語
- 📊 統計: どのお題が一番選ばれたか
- 🔗 SNS共有: 結果カードをOGP画像で共有
