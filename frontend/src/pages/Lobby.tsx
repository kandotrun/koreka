import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoomContext } from '../contexts/RoomContext';

const avatarColors = ['#FF6B35', '#4ECDC4', '#FFE66D', '#A855F7', '#EC4899', '#EF4444'];

export default function Lobby() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const room = useRoomContext();
  const [joined, setJoined] = useState(false);

  // 接続 + 自動join
  useEffect(() => {
    if (!joined) {
      const name = sessionStorage.getItem('playerName') || 'ゲスト';
      room.connect(name);
      setJoined(true);
    }
  }, [joined, room.connect]);

  // ゲーム開始でGame画面に遷移
  useEffect(() => {
    if (room.phase === 'selecting') {
      navigate(`/${code}/game`);
    }
  }, [room.phase, code, navigate]);

  const isHost = room.playerId === room.hostId;
  const allReady = room.players.length >= 2 && room.players.every(p => p.id === room.hostId || p.ready);

  return (
    <div className="page" style={{ justifyContent: 'flex-start', paddingTop: 'var(--space-2xl)' }}>
      <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>ルーム</p>

      {/* ルームコード */}
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 48,
        fontWeight: 700,
        letterSpacing: '0.2em',
        marginTop: 'var(--space-sm)',
        color: 'var(--text)',
      }}>
        {code}
      </div>

      <p style={{ color: 'var(--text-sub)', fontSize: 12, marginTop: 'var(--space-sm)' }}>
        このコードを友達にシェアしよう
      </p>

      {/* 区切り線 */}
      <div style={{
        width: '100%',
        maxWidth: 320,
        height: 1,
        background: 'rgba(255,255,255,0.08)',
        margin: 'var(--space-lg) 0',
      }} />

      {/* 参加者一覧 */}
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <AnimatePresence>
          {room.players.map((player, i) => (
            <motion.div
              key={player.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-md)',
                padding: 'var(--space-md)',
                background: 'var(--surface)',
                borderRadius: 'var(--radius-md)',
                border: player.ready
                  ? '1px solid var(--success)'
                  : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {/* アバター */}
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: avatarColors[i % avatarColors.length],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 700,
                color: 'white',
                flexShrink: 0,
                boxShadow: player.ready ? `0 0 12px ${avatarColors[i % avatarColors.length]}60` : 'none',
              }}>
                {player.name.charAt(0)}
              </div>

              {/* 名前 */}
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700 }}>{player.name}</span>
                {player.id === room.hostId && (
                  <span style={{ fontSize: 12, color: 'var(--text-sub)', marginLeft: 8 }}>ホスト</span>
                )}
              </div>

              {/* ステータス */}
              <span style={{ fontSize: 14, color: player.ready ? 'var(--success)' : 'var(--text-sub)' }}>
                {player.ready ? '準備OK' : '待機中'}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* アクション */}
      <div style={{
        width: '100%',
        maxWidth: 320,
        marginTop: 'auto',
        paddingBottom: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
      }}>
        {!isHost && (
          <button className="btn-primary" onClick={() => room.ready()}>
            {room.players.find(p => p.id === room.playerId)?.ready ? '待機に戻す' : '準備OK ✓'}
          </button>
        )}
        {isHost && (
          <button
            className="btn-primary"
            disabled={!allReady}
            onClick={() => room.start()}
          >
            {allReady ? 'ゲーム開始 ▶' : '全員の準備を待っています...'}
          </button>
        )}
      </div>
    </div>
  );
}
