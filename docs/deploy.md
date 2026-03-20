# デプロイガイド

## 前提条件

- [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`pnpm add -g wrangler`)
- Node.js 22+
- pnpm

## 初回セットアップ

### 1. Cloudflare ログイン

```bash
wrangler login
```

ブラウザが開くので、Cloudflare アカウントで認証する。

### 2. D1 データベース作成

```bash
wrangler d1 create koreka-db
```

出力されるdatabase_idをメモする：

```
✅ Successfully created DB 'koreka-db'
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. wrangler.toml を更新

`wrangler.toml` の `database_id` を実際の値に差し替える：

```toml
[[d1_databases]]
binding = "DB"
database_name = "koreka-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # ← ここ
```

### 4. D1 スキーマ適用 + 初期データ投入

```bash
# 本番DBにスキーマ適用
wrangler d1 execute koreka-db --remote --file=src/db/schema.sql

# 初期お題データ投入
wrangler d1 execute koreka-db --remote --file=src/db/seed.sql
```

### 5. 依存関係インストール

```bash
pnpm install
```

## デプロイ

```bash
pnpm deploy
```

これは以下を実行する：
1. `cd frontend && npx vite build` — フロントエンドビルド
2. `wrangler deploy` — Workers + Durable Objects + Static Assets デプロイ

初回デプロイ時、Durable Objects のマイグレーションが自動適用される。

## ローカル開発

### D1 ローカルセットアップ

```bash
# ローカルDBにスキーマ適用
pnpm db:init

# 初期お題データ投入
pnpm db:seed

# または一括
pnpm db:setup
```

### 起動

```bash
pnpm dev
```

`wrangler dev` が起動し、以下が利用可能：
- http://localhost:8787 — アプリ
- Durable Objects（ローカルモード）
- D1（ローカルモード）

## カスタムドメイン設定

### Workers カスタムドメイン

1. Cloudflare Dashboard → Workers & Pages → koreka → Settings → Domains & Routes
2. 「Add Custom Domain」をクリック
3. `koreka.app` を入力（ドメインはCloudflareのDNSに登録済みであること）
4. SSL証明書は自動で発行される

### ドメイン取得（未取得の場合）

```bash
# Cloudflare Registrar で取得するのが一番楽
# Dashboard → Domain Registration → Register Domains → koreka.app を検索
```

## 環境変数 / シークレット

現時点で必要な環境変数はない（D1とDurable Objectsはbindingで接続）。

将来的にGemini APIキーが必要になった場合：

```bash
wrangler secret put GEMINI_API_KEY
# プロンプトでキーを入力
```

## GitHub Actions CI/CD（任意）

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - run: pnpm install
      - run: pnpm build
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```

### 必要なシークレット

| Secret | 取得方法 |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens → Create Token → Edit Cloudflare Workers |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard → Workers & Pages → 右サイドバーの Account ID |

## お題バッチ生成（GitHub Actions）

```yaml
# .github/workflows/generate-cards.yml
name: お題生成
on:
  schedule:
    - cron: '0 15 * * *'  # 毎日 00:00 JST
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - run: pnpm install
      - run: pnpm run generate-cards
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          CF_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
          D1_DATABASE_ID: ${{ secrets.D1_DATABASE_ID }}
```

### 追加シークレット

| Secret | 取得方法 |
|--------|---------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) で発行（無料） |
| `D1_DATABASE_ID` | `wrangler d1 list` で確認 |

## トラブルシューティング

### Durable Objects のマイグレーションエラー

```bash
# マイグレーションを手動適用
wrangler deploy --dry-run
wrangler deploy
```

### D1 にデータが入ってない

```bash
# 本番DBの中身を確認
wrangler d1 execute koreka-db --remote --command="SELECT COUNT(*) FROM cards"

# 再投入
wrangler d1 execute koreka-db --remote --file=src/db/seed.sql
```

### WebSocket が接続できない

- `wrangler.toml` の `compatibility_date` が `2023-05-18` 以降であることを確認
- ブラウザのコンソールでWebSocket URLが正しいか確認（`wss://koreka.app/api/rooms/XXXX/ws`）

### フロントエンドが表示されない

```bash
# ビルド成果物が存在するか確認
ls frontend/dist/

# なければビルド
pnpm build

# wrangler.toml の [assets] directory が正しいか確認
# directory = "frontend/dist"
```

## 構成図

```
GitHub (kandotrun/koreka)
  │
  ├── push to main → GitHub Actions → wrangler deploy
  │
  └── daily cron → GitHub Actions → Gemini API → D1 (お題追加)

Cloudflare
  ├── Workers (Hono API + Static Assets)
  ├── Durable Objects (Room WebSocket)
  └── D1 (cards, rooms, memories)

Client (PWA)
  └── WebSocket → Durable Object
```
