import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoomContext } from '../contexts/RoomContext';
import SwipeArea from '../components/SwipeArea';
import Card from '../components/Card';
import { sound } from '../lib/sound';

export default function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const room = useRoomContext();
  const [selecting, setSelecting] = useState(false);

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
      <div className="page" style={{ padding: 'var(--space-md)' }}>
        {/* ヘッダー */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-md)',
        }}>
          <span style={{ color: 'var(--text-sub)', fontSize: 14 }}>
            Round {room.round}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
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
      <div className="page" style={{ justifyContent: 'flex-start', paddingTop: 'var(--space-2xl)' }}>
        <motion.h2
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ fontSize: 24, fontWeight: 700, marginBottom: 'var(--space-lg)', textAlign: 'center' }}
        >
          最終投票
        </motion.h2>
        <p style={{ color: 'var(--text-sub)', fontSize: 14, marginBottom: 'var(--space-xl)' }}>
          1枚だけ選んでください
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
    <div className="page" style={{ justifyContent: 'center' }}>
      <motion.div
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
        style={{ textAlign: 'center' }}
      >
        <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-md)' }}>
          {selecting ? '他のプレイヤーを待っています...' : 'カードを配布中...'}
        </p>
        {room.pending.length > 0 && (
          <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>
            {room.pending.join('、')} が選択中
          </p>
        )}
      </motion.div>
    </div>
  );
}
