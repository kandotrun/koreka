// お題バルク生成スクリプト
// 10,000件までお題を一気に生成する

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID!;
const TARGET_COUNT = parseInt(process.env.TARGET_COUNT || '10000', 10);
const BATCH_SIZE = 200; // Geminiに1回で生成させる件数

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface D1QueryResponse {
  success: boolean;
  result?: Array<{ results?: Array<Record<string, unknown>> }>;
  errors?: Array<{ message: string }>;
}

const CATEGORIES = [
  { id: 'adventure', name: '冒険', emoji: '🏔️', description: '冒険的で刺激的な体験' },
  { id: 'chill', name: 'まったり', emoji: '☕', description: 'のんびりリラックスできる活動' },
  { id: 'food', name: 'グルメ', emoji: '🍜', description: '食べ物や料理に関する体験' },
  { id: 'night', name: '夜遊び', emoji: '🌙', description: '夜ならではの遊びや体験' },
  { id: 'creative', name: 'クリエイティブ', emoji: '🎨', description: '創造的でユニークな活動' },
  { id: 'random', name: 'カオス', emoji: '🎲', description: '予測不能でカオスな体験' },
  { id: 'spicy', name: 'スパイシー', emoji: '🔥', description: '攻めた・ちょっとドキドキする体験' },
];

const validCategories = new Set(CATEGORIES.map(c => c.id));

async function queryD1(sql: string, params: string[] = []): Promise<D1QueryResponse> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  if (!res.ok) {
    throw new Error(`D1 API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function getCurrentCount(): Promise<number> {
  const result = await queryD1('SELECT COUNT(*) as cnt FROM cards');
  const cnt = (result.result?.[0]?.results?.[0] as Record<string, number>)?.cnt ?? 0;
  return cnt;
}

async function getExistingTexts(): Promise<Set<string>> {
  const result = await queryD1('SELECT text FROM cards');
  const texts = new Set<string>();
  if (result.result) {
    for (const r of result.result) {
      if (r.results) {
        for (const row of r.results) {
          texts.add(row.text as string);
        }
      }
    }
  }
  return texts;
}

async function generateBatch(existingSample: string[]): Promise<Array<{ text: string; category: string }>> {
  const sampleStr = existingSample.length > 0
    ? existingSample.slice(0, 30).map(t => `- ${t}`).join('\n')
    : '（まだなし）';

  const prompt = `あなたは「Koreka」というリアルタイムカードゲームのお題生成AIです。
友達グループが「次何する？」を決めるためのお題カードを生成してください。

## カテゴリ
${CATEGORIES.map(c => `- ${c.id}（${c.name} ${c.emoji}）: ${c.description}`).join('\n')}

## ルール
- ${BATCH_SIZE}個のお題を生成してください
- 各カテゴリから均等に（各${Math.floor(BATCH_SIZE / 7)}個程度）
- 日本語で、友達同士のカジュアルな口調
- 短く（20文字以内推奨、最大30文字）
- 具体的で実行可能な内容
- 既存のお題と被らないユニークな内容
- バリエーション豊かに（似たパターンの繰り返し禁止）

## 既存のお題サンプル（参考・重複禁止）
${sampleStr}

## 出力形式
JSON配列のみ出力してください。他のテキストは不要です。
[{"text": "お題テキスト", "category": "カテゴリID"}, ...]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.95,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    // Rate limit の場合は待つ
    if (res.status === 429) {
      console.log('⏳ Rate limit hit, waiting 60s...');
      await sleep(60000);
      return generateBatch(existingSample); // retry
    }
    throw new Error(`Gemini API error: ${res.status} ${errorText}`);
  }

  const data: GeminiResponse = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // JSON部分を抽出
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn(`⚠️ Failed to parse Gemini response, skipping batch`);
    return [];
  }

  try {
    const cards: Array<{ text: string; category: string }> = JSON.parse(jsonMatch[0]);
    return cards.filter(c =>
      c.text && c.category && validCategories.has(c.category) && c.text.length <= 50
    );
  } catch {
    console.warn(`⚠️ JSON parse error, skipping batch`);
    return [];
  }
}

async function batchInsert(cards: Array<{ text: string; category: string }>): Promise<number> {
  if (cards.length === 0) return 0;

  // D1 API はバッチSQLをサポートしているので、100件ずつINSERTする
  let inserted = 0;
  const chunkSize = 50; // 1回のAPIコールで50件ずつ

  for (let i = 0; i < cards.length; i += chunkSize) {
    const chunk = cards.slice(i, i + chunkSize);
    const values = chunk.map((_, idx) => {
      const offset = i + idx;
      return `('gen-${Date.now()}-${offset}-${Math.random().toString(36).slice(2, 6)}', ?, ?, 1)`;
    }).join(',\n');

    const params: string[] = [];
    for (const card of chunk) {
      params.push(card.text, card.category);
    }

    const sql = `INSERT OR IGNORE INTO cards (id, text, category, generated) VALUES ${values}`;

    try {
      await queryD1(sql, params);
      inserted += chunk.length;
    } catch (err) {
      console.warn(`⚠️ Insert error for chunk: ${err}`);
      // 個別にフォールバック
      for (const card of chunk) {
        const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        try {
          await queryD1(
            'INSERT OR IGNORE INTO cards (id, text, category, generated) VALUES (?, ?, ?, 1)',
            [id, card.text, card.category]
          );
          inserted++;
        } catch { /* skip */ }
        await sleep(50);
      }
    }

    // D1 APIのレートリミット対策
    await sleep(200);
  }

  return inserted;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`🎴 バルクお題生成を開始 (目標: ${TARGET_COUNT.toLocaleString()}件)`);

  // 現在の件数を確認
  const currentCount = await getCurrentCount();
  console.log(`📊 現在のカード数: ${currentCount.toLocaleString()}件`);

  if (currentCount >= TARGET_COUNT) {
    console.log(`✅ すでに目標達成済み (${currentCount.toLocaleString()} >= ${TARGET_COUNT.toLocaleString()})`);
    return;
  }

  const remaining = TARGET_COUNT - currentCount;
  const estimatedBatches = Math.ceil(remaining / (BATCH_SIZE * 0.85)); // 重複除去で15%減想定
  console.log(`🎯 残り: ${remaining.toLocaleString()}件 (推定${estimatedBatches}バッチ)`);

  // 既存テキストを取得（重複チェック用）
  console.log('📋 既存のお題を取得中...');
  const existingTexts = await getExistingTexts();
  let totalInserted = 0;
  let batchNum = 0;
  let consecutiveEmptyBatches = 0;

  while (existingTexts.size + totalInserted < TARGET_COUNT) {
    batchNum++;
    const currentTotal = existingTexts.size + totalInserted;
    console.log(`\n--- バッチ ${batchNum} (現在: ${currentTotal.toLocaleString()}件) ---`);

    // 既存テキストからランダムサンプルを渡す（重複防止のヒント）
    const allTexts = [...existingTexts];
    const sample = allTexts.sort(() => Math.random() - 0.5).slice(0, 30);

    // Gemini APIで生成
    const generated = await generateBatch(sample);
    console.log(`  🤖 生成: ${generated.length}件`);

    if (generated.length === 0) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 3) {
        console.log('❌ 3回連続で生成失敗、中断');
        break;
      }
      await sleep(5000);
      continue;
    }
    consecutiveEmptyBatches = 0;

    // 重複除去
    const newCards = generated.filter(c => !existingTexts.has(c.text));
    console.log(`  🆕 新規: ${newCards.length}件 (重複${generated.length - newCards.length}件除外)`);

    if (newCards.length === 0) {
      console.log('  ⏭️ 全て重複、スキップ');
      await sleep(2000);
      continue;
    }

    // D1にinsert
    const inserted = await batchInsert(newCards);
    totalInserted += inserted;
    console.log(`  💾 挿入: ${inserted}件 (累計: ${(existingTexts.size + totalInserted).toLocaleString()}件)`);

    // 既存テキストセットを更新
    for (const card of newCards) {
      existingTexts.add(card.text);
    }

    // Gemini APIのレートリミット対策（free tier: 15 RPM）
    console.log('  ⏳ レートリミット待機 (5s)...');
    await sleep(5000);
  }

  const finalCount = await getCurrentCount();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ 完了！`);
  console.log(`  追加: ${totalInserted.toLocaleString()}件`);
  console.log(`  合計: ${finalCount.toLocaleString()}件`);

  // カテゴリ別集計
  const catResult = await queryD1('SELECT category, COUNT(*) as cnt FROM cards GROUP BY category');
  if (catResult.result?.[0]?.results) {
    console.log(`\n📊 カテゴリ別:`);
    for (const row of catResult.result[0].results) {
      const cat = CATEGORIES.find(c => c.id === row.category);
      console.log(`  ${cat?.emoji || '?'} ${cat?.name || row.category}: ${(row.cnt as number).toLocaleString()}件`);
    }
  }
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});
