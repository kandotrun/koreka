import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import useSWR from 'swr';
import { useTheme } from '../hooks/useTheme';
import { useI18n } from '../contexts/I18nContext';
import { LANGS } from '../lib/i18n';
import { fetcher } from '../lib/fetcher';

const categoryConfig: Record<string, { icon: string; color: string }> = {
  adventure: { icon: '🏔️', color: '#FF6B35' },
  chill: { icon: '☕', color: '#4ECDC4' },
  food: { icon: '🍜', color: '#FFE66D' },
  night: { icon: '🌙', color: '#A855F7' },
  creative: { icon: '🎨', color: '#EC4899' },
  random: { icon: '🎲', color: '#EF4444' },
  spicy: { icon: '🔥', color: '#F43F5E' },
  trending: { icon: '📰', color: '#3B82F6' },
  seasonal: { icon: '🌸', color: '#F59E0B' },
};

interface SampleCard {
  id: string;
  text: string;
  category: string;
  generated: number;
}

const themeIcon: Record<string, string> = {
  system: '🖥️',
  light: '☀️',
  dark: '🌙',
};

export default function Home() {
  const navigate = useNavigate();
  const { preference, toggle } = useTheme();
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<'home' | 'join' | 'create'>('home');
  const { data: sampleData } = useSWR<{ cards?: SampleCard[] }>('/api/cards/sample?limit=100', fetcher);
  const sampleCards = sampleData?.cards ?? [];
  const { data: popularData } = useSWR<{ cards?: (SampleCard & { timesSelected: number })[] }>('/api/cards/popular?limit=100', fetcher);
  const popularCards: SampleCard[] = (popularData?.cards ?? []).map(c => ({ id: c.id, text: c.text, category: c.category, generated: c.generated ? 1 : 0 }));
  const allCategories = Object.keys(categoryConfig) as Array<keyof typeof categoryConfig>;

  const [name, setName] = useState('');
  const [code, setCode] = useState(['', '', '', '']);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(allCategories));
  const [customCardsText, setCustomCardsText] = useState('');
  const [loading, setLoading] = useState(false);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedCategories.size === allCategories.length) {
      setSelectedCategories(new Set());
    } else {
      setSelectedCategories(new Set(allCategories));
    }
  };

  const handleCreateRoom = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const settings: Record<string, unknown> = {};
      // カスタムカードが入力されている場合
      const customLines = customCardsText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 50);
      if (customLines.length > 0) {
        settings.customCards = customLines;
      } else {
        // 全選択 or 0選択 = 全カテゴリ（フィルターなし）
        if (selectedCategories.size > 0 && selectedCategories.size < allCategories.length) {
          settings.categories = Array.from(selectedCategories);
        }
      }
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName: name,
          ...(Object.keys(settings).length > 0 ? { settings } : {}),
        }),
      });
      const data = await res.json();
      // Store name for WebSocket join
      sessionStorage.setItem('playerName', name);
      navigate(`/${data.code}`);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = () => {
    const roomCode = code.join('');
    if (roomCode.length !== 4 || !name.trim()) return;
    sessionStorage.setItem('playerName', name);
    navigate(`/${roomCode}`);
  };

  const handleCodeInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    if (value && index < 3) {
      codeRefs.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      codeRefs.current[index - 1]?.focus();
    }
  };

  const cycleLang = () => {
    const idx = LANGS.findIndex(l => l.code === lang);
    const next = LANGS[(idx + 1) % LANGS.length];
    setLang(next.code);
  };

  const currentFlag = LANGS.find(l => l.code === lang)?.flag ?? '🇯🇵';

  return (
    <div className="page" role="main" style={{ justifyContent: 'center', gap: 'var(--space-xl)', position: 'relative' }}>
      {/* テーマ切り替え + 言語切り替え */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'flex',
        gap: 8,
        zIndex: 10,
      }}>
        <button
          onClick={cycleLang}
          aria-label={LANGS.find(l => l.code === lang)?.label ?? 'Language'}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-full)',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            cursor: 'pointer',
          }}
          title={LANGS.find(l => l.code === lang)?.label}
        >
          {currentFlag}
        </button>
        <button
          onClick={toggle}
          aria-label={`${t('theme.title')}: ${preference}`}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-full)',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            cursor: 'pointer',
          }}
          title={`${t('theme.title')}: ${preference}`}
        >
          {themeIcon[preference]}
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ textAlign: 'center' }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
          <h1 style={{
            fontSize: 52,
            fontWeight: 900,
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}>
            これか
          </h1>
          <span style={{
            fontSize: 52,
            fontWeight: 900,
            color: 'var(--primary)',
            lineHeight: 1,
          }}>!</span>
        </div>
        <p style={{
          color: 'var(--text-sub)',
          marginTop: 6,
          fontSize: 11,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
        }}>
          {t('home.subtitle')}
        </p>
      </motion.div>

      {mode === 'home' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}
        >
          {/* サービス説明 */}
          <div style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-lg)',
            border: '1px solid var(--border)',
          }}>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text)' }}>
              {t('home.desc1')}<br />
              <strong style={{ color: 'var(--primary)' }}>{t('home.desc_highlight')}</strong>{t('home.desc2')}<br />
              {t('home.desc3')}
            </p>
          </div>

          {/* お題サンプル（2行交互スクロール） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <p style={{ fontSize: 11, color: 'var(--text-sub)', textAlign: 'center', letterSpacing: '0.1em' }}>
              {t('home.sample_title')}
            </p>
            {(() => {
              const fallback: SampleCard[] = [
                { id: 'f1', text: '夜の海にみんなで行く', category: 'adventure', generated: 0 },
                { id: 'f2', text: '知らないバーに飛び込む', category: 'night', generated: 0 },
                { id: 'f3', text: '屋台で一番安いメニューだけで晩ごはん', category: 'food', generated: 0 },
                { id: 'f4', text: '目を見つめ合って先に逸らした方が負け', category: 'spicy', generated: 0 },
                { id: 'f5', text: 'コンビニでアイス買って公園で語る', category: 'chill', generated: 0 },
                { id: 'f6', text: '全員でTikTok撮影チャレンジ', category: 'creative', generated: 0 },
                { id: 'f7', text: 'じゃんけんで負けた人が奢る', category: 'random', generated: 0 },
                { id: 'f8', text: 'カラオケで点数バトルする', category: 'night', generated: 0 },
              ];
              const cards = sampleCards.length > 0 ? sampleCards : fallback;
              const mid = Math.ceil(cards.length / 2);
              const row1 = cards.slice(0, mid);
              const row2 = cards.slice(mid);

              const renderRow = (items: SampleCard[], reverse: boolean) => {
                const doubled = [...items, ...items];
                return (
                  <div className="marquee-container">
                    <div className={reverse ? 'marquee-track marquee-reverse' : 'marquee-track'}>
                      {doubled.map((card, i) => {
                        const cat = categoryConfig[card.category] || { icon: '📋', color: '#8B8B9E' };
                        return (
                          <div
                            key={`${card.id}-${i}`}
                            style={{
                              minWidth: 130,
                              padding: '10px 12px',
                              background: `linear-gradient(135deg, ${cat.color}15, ${cat.color}08)`,
                              border: `1px solid ${cat.color}25`,
                              borderRadius: 'var(--radius-md)',
                              flexShrink: 0,
                            }}
                          >
                            <span style={{ fontSize: 13 }}>{cat.icon}</span>
                            <p style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4, color: 'var(--text)' }}>
                              {card.text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              };

              return (
                <>
                  {renderRow(row1, false)}
                  {renderRow(row2, true)}
                </>
              );
            })()}
            {/* 3行目: 人気のお題 TOP100 */}
            {popularCards.length > 0 && (
              <>
                <p style={{ fontSize: 11, color: 'var(--text-sub)', textAlign: 'center', letterSpacing: '0.1em', marginTop: 'var(--space-sm)' }}>
                  — 🔥 {t('home.popular_topics')} —
                </p>
                <div className="marquee-container">
                  <div className="marquee-track">
                    {[...popularCards, ...popularCards].map((card, i) => {
                      const cat = categoryConfig[card.category] || { icon: '📋', color: '#8B8B9E' };
                      return (
                        <div
                          key={`popular-${card.id}-${i}`}
                          style={{
                            minWidth: 130,
                            padding: '10px 12px',
                            background: `linear-gradient(135deg, ${cat.color}20, ${cat.color}10)`,
                            border: `1px solid ${cat.color}30`,
                            borderRadius: 'var(--radius-md)',
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ fontSize: 13 }}>🔥</span>
                          <p style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4, color: 'var(--text)' }}>
                            {card.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 使い方 */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 'var(--space-lg)',
            padding: '0 var(--space-sm)',
          }}>
            {[
              { step: '1', label: t('home.step1') },
              { step: '2', label: t('home.step2') },
              { step: '3', label: t('home.step3') },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'var(--primary)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  margin: '0 auto 6px',
                }}>
                  {s.step}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* ボタン */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <button className="btn-primary" onClick={() => setMode('create')}>
              {t('home.create_room')}
            </button>
            <button className="btn-secondary" onClick={() => setMode('join')}>
              {t('home.join_code')}
            </button>
          </div>
        </motion.div>
      )}

      {(mode === 'create' || mode === 'join') && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}
        >
          {/* Name input */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
              {t('home.name_label')}
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('home.name_placeholder')}
              maxLength={10}
              autoFocus
              aria-label={t('home.name_label')}
              style={{
                width: '100%',
                height: 48,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text)',
                fontSize: 16,
                padding: '0 16px',
              }}
            />
          </div>

          {/* Category select (create mode only) */}
          {mode === 'create' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                  {t('home.category_label')}
                </label>
                <button
                  onClick={toggleAll}
                  style={{
                    fontSize: 11,
                    color: 'var(--primary)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {selectedCategories.size === allCategories.length ? t('home.deselect_all') : t('home.select_all')}
                </button>
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                {allCategories.map(cat => {
                  const cfg = categoryConfig[cat];
                  const selected = selectedCategories.has(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        border: `1.5px solid ${selected ? cfg.color : 'var(--border)'}`,
                        background: selected ? `${cfg.color}18` : 'var(--surface)',
                        color: selected ? cfg.color : 'var(--text-sub)',
                        transition: 'all 0.15s ease',
                        opacity: selected ? 1 : 0.6,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{cfg.icon}</span>
                      {t(`cat.${cat}`)}
                    </button>
                  );
                })}
              </div>
              {selectedCategories.size === 0 && (
                <p style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 6 }}>
                  {t('home.no_category_hint')}
                </p>
              )}
            </div>
          )}

          {/* Custom deck (create mode only) */}
          {mode === 'create' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
                {t('home.custom_deck_label')}
              </label>
              <textarea
                value={customCardsText}
                onChange={e => setCustomCardsText(e.target.value)}
                placeholder={t('home.custom_deck_placeholder')}
                style={{
                  width: '100%',
                  minHeight: 80,
                  padding: 'var(--space-sm)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 14,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              {customCardsText.trim().length > 0 && (
                <p style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4 }}>
                  {t('home.custom_deck_hint')}
                </p>
              )}
            </div>
          )}

          {/* Code input (join mode only) */}
          {mode === 'join' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
                {t('home.room_code_label')}
              </label>
              <div className="code-input">
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { codeRefs.current[i] = el; }}
                    type="tel"
                    inputMode="numeric"
                    value={digit}
                    onChange={e => handleCodeInput(i, e.target.value)}
                    onKeyDown={e => handleCodeKeyDown(i, e)}
                    maxLength={1}
                    aria-label={`${t('home.room_code_label')} ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          )}

          <button
            className="btn-primary"
            disabled={!name.trim() || (mode === 'join' && code.join('').length !== 4) || loading}
            onClick={mode === 'create' ? handleCreateRoom : handleJoinRoom}
          >
            {loading ? '...' : mode === 'create' ? t('home.create_submit') : t('home.join_submit')}
          </button>

          <button className="btn-ghost" onClick={() => setMode('home')} style={{ textAlign: 'center' }}>
            {t('common.back')}
          </button>
        </motion.div>
      )}
    </div>
  );
}
