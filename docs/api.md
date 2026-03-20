# API Specification

Base URL: `https://koreka.app` (production) / `http://localhost:8787` (dev)

## REST Endpoints

### Create Room

```
POST /api/rooms
```

Request:
```json
{
  "hostName": "カン",
  "settings": {
    "cardsPerPlayer": 5,
    "categories": ["adventure", "chill", "food"],
    "useAI": true,
    "aiContext": {
      "time": "night",
      "mood": "adventure"
    }
  }
}
```

Response:
```json
{
  "roomId": "do-xxx",
  "code": "7284",
  "wsUrl": "wss://koreka.app/api/rooms/7284/ws"
}
```

### Get Room Info

```
GET /api/rooms/:code
```

Response:
```json
{
  "code": "7284",
  "phase": "waiting",
  "playerCount": 3,
  "maxPlayers": 8,
  "players": [
    { "id": "p1", "name": "カン", "ready": true },
    { "id": "p2", "name": "タロウ", "ready": false }
  ]
}
```

### List Card Categories

```
GET /api/cards/categories
```

Response:
```json
{
  "categories": [
    { "id": "adventure", "name": "冒険", "icon": "🏔️", "count": 30 },
    { "id": "chill", "name": "まったり", "icon": "☕", "count": 25 },
    { "id": "food", "name": "グルメ", "icon": "🍜", "count": 20 },
    { "id": "night", "name": "夜遊び", "icon": "🌙", "count": 25 },
    { "id": "creative", "name": "クリエイティブ", "icon": "🎨", "count": 15 },
    { "id": "random", "name": "カオス", "icon": "🎲", "count": 20 }
  ]
}
```

### Generate AI Cards

```
POST /api/cards/generate
```

Request:
```json
{
  "context": {
    "time": "night",
    "location": "福岡",
    "playerCount": 4,
    "mood": "adventure"
  },
  "count": 10
}
```

Response:
```json
{
  "cards": [
    { "id": "ai-001", "text": "屋台で一番安いメニューだけで晩ごはん", "category": "food", "generated": true },
    { "id": "ai-002", "text": "中洲の橋の上で記念写真を撮る", "category": "adventure", "generated": true }
  ]
}
```

### Save Memory

```
POST /api/rooms/:code/memories
Content-Type: multipart/form-data
```

Fields:
- `photo`: File (optional)
- `comment`: string (optional)

Response:
```json
{
  "id": "mem-001",
  "photoUrl": "https://koreka.app/uploads/mem-001.jpg",
  "comment": "最高の夜だった",
  "createdAt": "2026-03-20T23:30:00Z"
}
```

## WebSocket Protocol

### Connection

```
GET /api/rooms/:code/ws
Upgrade: websocket
```

Durable Object が WebSocket 接続を受け入れ、ルーム内の全プレイヤーと双方向通信する。

### Client → Server Messages

| type | payload | description |
|------|---------|-------------|
| `join` | `{ name: string }` | ルーム参加 |
| `ready` | `{}` | 準備完了トグル |
| `start` | `{}` | ゲーム開始（ホストのみ） |
| `select` | `{ cardIds: string[] }` | カード選別結果 |
| `vote` | `{ cardId: string }` | 最終投票 |
| `ping` | `{}` | 接続維持 |

### Server → Client Messages

| type | payload | description |
|------|---------|-------------|
| `players` | `{ players: Player[] }` | 参加者一覧更新 |
| `deal` | `{ cards: Card[], round: number }` | 手札配布 |
| `pass` | `{ cards: Card[], round: number }` | 回ってきたカード |
| `waiting` | `{ pending: string[] }` | まだ選択中のプレイヤー |
| `round_complete` | `{ remaining: number, round: number }` | ラウンド完了 |
| `final_vote` | `{ cards: Card[] }` | 最終投票開始 |
| `result` | `{ card: Card, votes: Record<string, string> }` | 最終結果 |
| `error` | `{ message: string }` | エラー |
| `pong` | `{}` | ping応答 |

### Error Codes

| message | description |
|---------|-------------|
| `room_full` | ルーム満員 (8人) |
| `room_not_found` | ルームが存在しない |
| `game_in_progress` | ゲーム中は参加不可 |
| `not_host` | ホスト権限が必要な操作 |
| `invalid_selection` | 不正なカード選択 |
| `already_voted` | 二重投票 |
