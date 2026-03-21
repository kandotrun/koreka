import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoomContext } from '../contexts/RoomContext';
import SwipeArea from '../components/SwipeArea';
import Card from '../components/Card';
import { sound } from '../lib/sound';
import { useI18n } from '../contexts/I18nContext';

export default function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const room = useRoomContext();
  const { t } = useI18n();
  const [selecting, setSelecting] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [countdown, setCountdown] = useState(30);
  const [showTimeout, setShowTimeout] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer for selecting phase
  useEffect(() => {
    if (room.phase === 'selecting' && room.cards.length > 0 && !selecting) {
      setCountdown(30);
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, [room.phase, room.cards, selecting]);

  // Handle selection timeout error
  useEffect(() => {
    if (room.error === 'selection_timeout') {
      setSelecting(true);
      setShowTimeout(true);
      const timer = setTimeout(() => setShowTimeout(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [room.error]);

  // 新しいカードが来たら選択状態をリセット
  useEffect(() => {
    if (room.cards.length > 0) {
      setSelecting(false);
    }
  }, [room.cards]);

  // ラウンド完了サウンド
  useEffect(() => {
    if (room.round > 1) {
      sound.play('roundComplete');
    }
  }, [room.round]);

  // 結果画面に遷移
  useEffect(() => {
    if (room.phase === 'result' && room.result) {
      navigate(`/${code}/result`, {
        state: {
          card: room.result.card,
          votes: room.result.votes,
          players: room.players,
        },
      });
    }
  }, [room.phase, room.result, code, navigate, room.players]);

  const handleSwipeComplete = useCallback((keptCardIds: string[]) => {
    room.select(keptCardIds);
    setSelecting(true);
  }, [room.select]);

  const [voted, setVoted] = useState(false);

  const handleVote = useCallback((cardId: string) => {
    room.vote(cardId);
    setVoted(true);
  }, [room.vote]);

  // 選別フェーズ
  if (room.phase === 'selecting' && room.cards.length > 0 && !selecting) {
    return (
      <div className="page" role="main" style={{ padding: 'var(--space-md)' }}>
        {/* タイムアウト通知 */}
        <AnimatePresence>
          {showTimeout && (
            <motion.div
              initial={{ opacity: 0, y: -40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              style={{
                position: 'fixed',
                top: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--danger)',
                color: 'white',
                padding: '10px 20px',
                borderRadius: 'var(--radius-md)',
                fontWeight: 700,
                fontSize: 14,
                zIndex: 50,
                whiteSpace: 'nowrap',
              }}
            >
              {t('game.timeout')}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ヘッダー */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-md)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <span style={{ color: 'var(--text-sub)', fontSize: 14 }}>
              Round {room.round}
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              color: countdown <= 10 ? 'var(--danger)' : 'var(--text-sub)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {countdown}s
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => { sound.toggle(); setSoundOn(sound.enabled); }}
              aria-label={soundOn ? 'Sound ON' : 'Sound OFF'}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-full)',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                cursor: 'pointer',
                marginRight: 4,
              }}
              title={soundOn ? 'Sound ON' : 'Sound OFF'}
            >
              {soundOn ? '🔊' : '🔇'}
            </button>
            {room.players.map(p => (
              <div
                key={p.id}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: p.id === room.playerId ? 'var(--primary)' : 'var(--surface)',
                }}
              />
            ))}
          </div>
        </div>

        <SwipeArea cards={room.cards} onComplete={handleSwipeComplete} />
      </div>
    );
  }

  // 最終投票フェーズ
  if (room.phase === 'voting' && room.survivors.length > 0 && !voted) {
    return (
      <div className="page" role="main" style={{ justifyContent: 'flex-start', paddingTop: 'var(--space-2xl)' }}>
        <motion.h2
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ fontSize: 24, fontWeight: 700, marginBottom: 'var(--space-lg)', textAlign: 'center' }}
        >
          {t('game.final_vote')}
        </motion.h2>
        <p style={{ color: 'var(--text-sub)', fontSize: 14, marginBottom: 'var(--space-xl)' }}>
          {t('game.pick_one')}
        </p>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-md)',
          alignItems: 'center',
          width: '100%',
          overflowY: 'auto',
          paddingBottom: 'var(--space-2xl)',
        }}>
          <AnimatePresence>
            {room.survivors.map((card, i) => (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card card={card} onClick={() => handleVote(card.id)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // 待機状態
  return (
    <div className="page" role="main" style={{ justifyContent: 'center' }}>
      <motion.div
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
        style={{ textAlign: 'center' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-md)' }}>
          {selecting ? t('game.waiting_others') : t('game.dealing')}
        </p>
        {room.pending.length > 0 && (
          <p aria-live="polite" style={{ color: 'var(--text-sub)', fontSize: 14 }}>
            {t('game.selecting', room.pending.join('、'))}
          </p>
        )}
      </motion.div>
    </div>
  );
}
