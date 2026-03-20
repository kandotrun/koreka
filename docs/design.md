# Design System

## Visual Identity

**テーマ**: 「夜の青春」× ミニマル

青春・ドラマ感をベースに、デジタルネイティブ感を加える。
カードゲームだけどポップすぎない。大人が使ってダサくないラインを狙う。
ダークモードオンリー（夜に使うことが多いアプリのため）。

**タグライン**: 「これか！と思える瞬間を。」

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--primary` | `#FF6B35` | CTA、「これか！」の発見・興奮、冒険カテゴリ |
| `--bg` | `#0A0A0F` | アプリ背景 |
| `--surface` | `#1A1A2E` | カード背景、パネル |
| `--accent` | `#E8D44D` | 結果発表、ハイライト、ゴールド演出 |
| `--text` | `#F5F5F5` | メインテキスト |
| `--text-sub` | `#8B8B9E` | サブテキスト、ラベル |
| `--success` | `#4ECDC4` | 準備完了、まったりカテゴリ |
| `--danger` | `#EF4444` | エラー、カオスカテゴリ |

## Category Colors

| カテゴリ | Color | Icon | Gradient |
|---------|-------|------|----------|
| 冒険 | `#FF6B35` | 🏔️ | `#FF6B35 → #FF8F5E` |
| まったり | `#4ECDC4` | ☕ | `#4ECDC4 → #7EDDD6` |
| グルメ | `#FFE66D` | 🍜 | `#FFE66D → #FFF0A0` |
| 夜遊び | `#A855F7` | 🌙 | `#A855F7 → #C084FC` |
| クリエイティブ | `#EC4899` | 🎨 | `#EC4899 → #F472B6` |
| カオス | `#EF4444` | 🎲 | `#EF4444 → #F87171` |

各カテゴリのグラデーションはカード背景に使用。

## Typography

| Element | Font | Weight | Size |
|---------|------|--------|------|
| Body | Noto Sans JP | 400 | 16px |
| Heading | Noto Sans JP | 700 | 24-32px |
| Card Text (お題) | Noto Sans JP | 700 | 20-24px |
| Result Text | Noto Sans JP | 900 | 36-48px |
| Label | Noto Sans JP | 400 | 12-14px |
| Code (ルームコード) | JetBrains Mono | 700 | 48px |

## Card Design

```
┌─────────────────────────────┐
│                             │
│   🏔️ 冒険                   │  ← カテゴリアイコン + ラベル (12px, text-sub)
│                             │
│                             │
│    夜の海に                  │
│    みんなで行く              │  ← お題テキスト (24px, bold, 中央配置)
│                             │
│                             │
│                             │
│               #042          │  ← カード番号 (12px, text-sub, 右下)
└─────────────────────────────┘

Specs:
- Width: 280px (mobile), 320px (tablet)
- Aspect ratio: 3:4
- Border radius: 16px
- Background: カテゴリ別グラデーション (10% opacity on surface)
- Border: 1px solid rgba(255,255,255,0.08)
- Shadow: 0 8px 32px rgba(0,0,0,0.4)
```

## Screens

### 1. Home（トップ）

```
┌──────────────────────────┐
│         Koreka            │  ← ロゴ (accent color)
│                          │
│  これか！と思える瞬間を。  │  ← タグライン (text-sub)
│                          │
│                          │
│   ┌──────────────────┐   │
│   │  ルームを作る 🎴   │   │  ← Primary button (--primary)
│   └──────────────────┘   │
│                          │
│   ┌──────────────────┐   │
│   │  コードで参加      │   │  ← Secondary button (outline)
│   └──────────────────┘   │
│                          │
│  〜 カードが流れるBG 〜    │  ← ゆっくり流れるカードアニメーション
└──────────────────────────┘
```

### 2. Lobby（待機室）

```
┌──────────────────────────┐
│  ルーム                   │
│                          │
│     7 2 8 4              │  ← ルームコード (JetBrains Mono, 48px)
│                          │
│     [QRコード]            │  ← タップで拡大
│                          │
│  ──────────────────────  │
│                          │
│   🟢 カン (ホスト)        │  ← 参加者リスト
│   🟢 タロウ               │     アイコン = イニシャル丸
│   ⚪ ハナコ               │     🟢 = ready, ⚪ = waiting
│                          │
│   ┌──────────────────┐   │
│   │  ゲーム開始 ▶      │   │  ← 全員readyで有効化
│   └──────────────────┘   │
└──────────────────────────┘
```

### 3. Game（選別フェーズ）

```
┌──────────────────────────┐
│  Round 2    残り 3/5      │  ← プログレスバー
│                          │
│  ● ● ○ ○                │  ← 他プレイヤー進捗ドット
│                          │
│   ┌────────────────────┐ │
│   │                    │ │
│   │   🏔️ 冒険          │ │
│   │                    │ │
│   │   タクシーで        │ │  ← スワイプ可能なカード
│   │   行けるところ      │ │     (spring physics)
│   │   まで行く          │ │
│   │                    │ │
│   └────────────────────┘ │
│                          │
│  ← やらない    やる →     │  ← ヒントテキスト (初回のみ表示)
│                          │
└──────────────────────────┘

Swipe interactions:
- 右スワイプ → カードがオレンジに光る → keep
- 左スワイプ → カードがフェードアウト → discard
- スワイプ中 → カードが傾く + 背景色が変化
```

### 4. Result（結果発表）

```
┌──────────────────────────┐
│                          │
│                          │
│       これか！            │  ← バウンスアニメーション (accent)
│                          │
│   ┌────────────────────┐ │
│   │                    │ │
│   │   🏔️ 冒険          │ │
│   │                    │ │
│   │   タクシーで        │ │  ← カードフリップ登場
│   │   行けるところ      │ │
│   │   まで行く          │ │
│   │                    │ │
│   └────────────────────┘ │
│                          │
│    3/4人が選択 🔥         │  ← 投票数
│                          │
│  ┌────────┐ ┌──────────┐ │
│  │もう一回 │ │思い出記録 │ │
│  └────────┘ └──────────┘ │
│                          │
│   ✨ 紙吹雪エフェクト ✨   │  ← CSS confetti
└──────────────────────────┘
```

## Animations

| トリガー | アニメーション | ライブラリ |
|---------|-----------|---------|
| カードスワイプ | Spring physics + 回転 | framer-motion |
| カード配布 | 扇形に広がって手元に | framer-motion |
| カード回し | スライドアウト → スライドイン | framer-motion |
| 結果発表 | カードフリップ (Y軸回転) | framer-motion |
| 「これか！」テキスト | バウンス + スケール | framer-motion |
| 紙吹雪 | パーティクル降下 | CSS keyframes |
| 参加者入室 | ポップイン (scale 0→1) | framer-motion |
| ボタンタップ | Scale 0.95 → 1.0 | CSS transition |

### Spring Config

```typescript
const cardSpring = {
  type: 'spring',
  stiffness: 300,
  damping: 20,
  mass: 0.8,
};

const bounceSpring = {
  type: 'spring',
  stiffness: 500,
  damping: 15,
};
```

## Sound Design

| イベント | サウンド | 長さ |
|-------|-------|----------|
| カードスワイプ (keep) | 軽い「シュッ」+ 肯定音 | ~200ms |
| カードスワイプ (discard) | 軽い「シュッ」 | ~150ms |
| ラウンド完了 | チャイム | ~500ms |
| 結果発表 | ファンファーレ | ~1.5s |
| 参加者入室 | 「ポコッ」 | ~200ms |
| 準備完了 | 「ピッ」 | ~100ms |

実装: Web Audio API（軽量）。設定でON/OFF切り替え可能。
音源: 短いサウンドエフェクト（自作 or フリー素材）。

## Spacing & Layout

```
--space-xs: 4px
--space-sm: 8px
--space-md: 16px
--space-lg: 24px
--space-xl: 32px
--space-2xl: 48px

--radius-sm: 8px
--radius-md: 12px
--radius-lg: 16px
--radius-full: 9999px
```

## Components

### Button

```
Primary:   bg: --primary, text: white, radius: --radius-md, h: 48px
Secondary: bg: transparent, border: 1px --primary, text: --primary
Ghost:     bg: transparent, text: --text-sub
```

### Avatar（参加者アイコン）

```
Size: 40px
Shape: Circle
Background: カテゴリカラーからランダム割り当て
Content: イニシャル1文字 (16px, bold, white)
Ready状態: 🟢 border glow (--success)
```

### Input（コード入力）

```
4桁数字入力 (OTP style)
各桁: 48x56px, --surface bg, --radius-md
フォーカス: --primary border
Font: JetBrains Mono, 24px
```

## PWA Icon

- 形状: 角丸スクエア
- 背景: --bg (#0A0A0F)
- アイコン: 「K」の文字 or カード形状のシンボル
- 色: --primary (#FF6B35)
- サイズ: 192x192, 512x512

## Responsive

| Breakpoint | レイアウト |
|------------|--------|
| ~480px | モバイル（メイン対象） |
| 481-768px | タブレット |
| 769px~ | デスクトップ（カード大きく表示） |

モバイルファースト。メインの利用シーンはスマホなので、
480px以下の体験を最優先で設計する。
