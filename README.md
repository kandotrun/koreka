# Koreka（これか！）

みんなで「次何する？」を決めるリアルタイムカードゲーム PWA。

## コンセプト

集まった人たちがスマホでルームに参加し、カードを回しながら「やりたいこと」を絞り込む。
最後に残った1枚が、みんなの「これか！」になる。

## Features (MVP)

- 🎴 **ルーム作成 & 参加**: 4桁コード or QR で即参加
- 🔄 **リアルタイム同期**: 全員の選択が即座に反映
- 👆 **スワイプ選別**: やりたい → 右、やらない → 左
- 🎯 **結果発表**: 全員一致のカードを表示
- 🤖 **AI生成お題**: 場所・天気・時間帯に応じたオリジナルカード
- 📱 **PWA**: インストール不要、URL共有で即プレイ

## Tech Stack

| Layer | Tech |
|-------|------|
| API / WebSocket | [Hono](https://hono.dev) on Cloudflare Workers |
| Realtime State | Cloudflare Durable Objects |
| Frontend | Vite + React (SPA) |
| Hosting | Cloudflare Workers (static assets) |
| DB | Cloudflare D1 (お題・履歴) |
| AI お題生成 | Workers AI / OpenAI |

## Docs

- [Architecture](docs/architecture.md) — アーキテクチャ・DB設計・WebSocket仕様
- [Game Flow](docs/game-flow.md) — ゲームフロー・UI遷移
- [API](docs/api.md) — REST / WebSocket API仕様
- [Design](docs/design.md) — デザインシステム・カラー・画面設計
- [Deploy](docs/deploy.md) — デプロイ手順・CI/CD・トラブルシューティング

## Getting Started

```bash
# Install
pnpm install

# Dev (Workers + Vite)
pnpm dev

# Deploy
pnpm deploy
```

## License

MIT
