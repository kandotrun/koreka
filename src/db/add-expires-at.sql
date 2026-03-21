-- カードに有効期限カラムを追加
ALTER TABLE cards ADD COLUMN expires_at TEXT;

-- 既存のtrendingカードに2ヶ月の有効期限を設定
UPDATE cards SET expires_at = date('now', '+2 months') WHERE category = 'trending' AND expires_at IS NULL;

-- seasonalカードにも3ヶ月の有効期限
UPDATE cards SET expires_at = date('now', '+3 months') WHERE category = 'seasonal' AND expires_at IS NULL;
