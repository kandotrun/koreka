# Koreka（これか！）

みんなで「次何する？」を決めるリアルタイムカード投票ゲーム PWA。

## コンセプト

集まった人たちがスマホでルームに参加し、カードをスワイプしながら「やりたいこと」を絞り込む。
最後に残った1枚が、みんなの「これか！」になる。

## Features

- **ルーム作成 & 参加**: 4桁コード or QR で即参加（最大8人）
- **リアルタイム同期**: WebSocket で全員の選択を即座に反映
- **スワイプ選別**: やりたい → 右、やらない → 左
- **最終投票 & 結果発表**: 投票で1枚に決定、コンフェッティ演出付き
- **カテゴリ選択**: 冒険・まったり・グルメなど9カテゴリから選択
- **カスタムデッキ**: 自作のお題（最大50個）でプレイ可能
- **AI 生成お題**: Gemini API によるオンデマンドカード生成
- **選択制限時間**: 30秒のタイマー付き（タイムアウト時はランダム自動選択）
- **クイックリプレイ**: ホストが同じルームで即再プレイ
- **プレイヤーキック**: ホストが不要なプレイヤーを退出可能
- **思い出記録**: 結果にコメントを残して保存
- **多言語対応**: 日本語・English・한국어
- **サウンドエフェクト**: Web Audio API によるサウンド演出
- **PWA**: インストール不要、URL共有で即プレイ
- **管理者ダッシュボード**: 統計情報・人気お題の確認
- **Error Boundary**: 予期しないエラーをキャッチ
- **アクセシビリティ**: ARIA 属性による支援技術対応

## Tech Stack

| Layer | Tech |
|-------|------|
| API / WebSocket | [Hono](https://hono.dev) on Cloudflare Workers |
| Realtime State | Cloudflare Durable Objects |
| Frontend | Vite + React + TypeScript |
| Hosting | Cloudflare Workers (static assets) |
| DB | Cloudflare D1 |
| AI | Gemini API |
| Animation | Framer Motion |
| Sound | Web Audio API |
| Test | Vitest |

## Getting Started

```bash
# Install dependencies
pnpm install

# Initialize local DB
pnpm db:setup

# Start development server
pnpm dev

# Type check
pnpm typecheck

# Run tests
pnpm test

# Build frontend
pnpm build

# Deploy to production
pnpm deploy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for AI card generation |
| `ADMIN_PASSWORD` | Password for admin dashboard login |

Cloudflare Workers の環境変数は `wrangler secret put` で設定:

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put ADMIN_PASSWORD
```

## Deployment

```bash
# Build & deploy
pnpm deploy
```

Cloudflare Workers + Durable Objects + D1 にデプロイされます。
`wrangler.toml` で設定を確認してください。

## Docs

- [Architecture](docs/architecture.md) — アーキテクチャ・DB設計・WebSocket仕様
- [Game Flow](docs/game-flow.md) — ゲームフロー・UI遷移
- [API](docs/api.md) — REST / WebSocket API仕様
- [Design](docs/design.md) — デザインシステム・カラー・画面設計
- [Deploy](docs/deploy.md) — デプロイ手順・CI/CD
- [v0.1.0 Release Notes](docs/v0.1.0-release.md) — 最新リリースノート

## License

MIT
