import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useRoomContext } from '../contexts/RoomContext';
import { sound } from '../lib/sound';
import { useTheme } from '../hooks/useTheme';
import { useI18n } from '../contexts/I18nContext';

const avatarColors = ['#FF6B35', '#4ECDC4', '#FFE66D', '#A855F7', '#EC4899', '#EF4444'];

export default function Lobby() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const room = useRoomContext();
  const { t } = useI18n();
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [prevPlayerCount, setPrevPlayerCount] = useState(0);
  const [joinName, setJoinName] = useState('');
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const needsName = !room.playerId && !sessionStorage.getItem('playerName');

  // ゲーム開始でGame画面に遷移
  useEffect(() => {
    if (room.phase === 'selecting') {
      navigate(`/${code}/game`);
    }
  }, [room.phase, code, navigate]);

  // プレイヤー参加時のサウンド
  useEffect(() => {
    if (room.players.length > prevPlayerCount && prevPlayerCount > 0) {
      sound.play('playerJoin');
    }
    setPrevPlayerCount(room.players.length);
  }, [room.players.length, prevPlayerCount]);

  // 準備OK時のサウンド
  const handleReady = () => {
    sound.play('ready');
    room.ready();
  };

  const { resolved } = useTheme();
  const isLight = resolved === 'light';
  const isHost = room.playerId === room.hostId;
  const allReady = room.players.length >= 2 && room.players.every(p => p.id === room.hostId || p.ready);
  const roomUrl = typeof window !== 'undefined' ? window.location.href : '';

  // エラー画面（満員 or ゲーム中）
  if (room.error) {
    const errorMessages: Record<string, { title: string; desc: string }> = {
      room_full: { title: t('lobby.room_full_title'), desc: t('lobby.room_full_desc') },
      game_in_progress: { title: t('lobby.game_in_progress_title'), desc: t('lobby.game_in_progress_desc') },
    };
    const err = errorMessages[room.error] || { title: t('common.error'), desc: room.error };
    return (
      <div className="page" style={{ justifyContent: 'center', gap: 'var(--space-lg)', textAlign: 'center' }}>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div style={{ fontSize: 48, marginBottom: 'var(--space-md)' }}>🚫</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{err.title}</h2>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, marginTop: 'var(--space-sm)', lineHeight: 1.6 }}>
            {err.desc}
          </p>
        </motion.div>
        <button className="btn-primary" onClick={() => navigate('/')} style={{ maxWidth: 240 }}>
          {t('lobby.go_home')}
        </button>
      </div>
    );
  }

  // QRから来た参加者用の名前入力画面
  if (needsName) {
    const handleJoin = () => {
      const name = joinName.trim() || t('common.guest');
      sessionStorage.setItem('playerName', name);
      room.connect(name);
    };
    return (
      <div className="page" style={{ justifyContent: 'center', gap: 'var(--space-xl)' }}>
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>{t('lobby.join_room', code || '')}</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}
        >
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>{t('home.name_label')}</label>
            <input
              type="text"
              value={joinName}
              onChange={e => setJoinName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder={t('home.name_placeholder')}
              maxLength={10}
              autoFocus
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
          <button className="btn-primary" onClick={handleJoin}>
            {t('lobby.join_btn')}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="page" style={{ justifyContent: 'flex-start', paddingTop: 'var(--space-2xl)' }}>
      <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>{t('lobby.room')}</p>

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

      {/* QRコード */}
      <button
        type="button"
        onClick={() => setQrModalOpen(true)}
        style={{
          marginTop: 'var(--space-md)',
          padding: 'var(--space-sm)',
          background: 'white',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          display: 'inline-flex',
          border: 'none',
        }}
      >
        <QRCodeSVG
          value={roomUrl}
          size={80}
          bgColor={isLight ? '#F5F5F0' : '#FFFFFF'}
          fgColor={isLight ? '#1A1A2E' : '#0A0A0F'}
          level="M"
        />
      </button>

      <p style={{ color: 'var(--text-sub)', fontSize: 12, marginTop: 'var(--space-sm)' }}>
        {t('lobby.qr_hint')}
      </p>

      {/* QRモーダル */}
      <AnimatePresence>
        {qrModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setQrModalOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--overlay)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              cursor: 'pointer',
            }}
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={e => e.stopPropagation()}
              style={{
                padding: 'var(--space-xl)',
                background: 'white',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <QRCodeSVG
                value={roomUrl}
                size={240}
                bgColor={isLight ? '#F5F5F0' : '#FFFFFF'}
                fgColor={isLight ? '#1A1A2E' : '#0A0A0F'}
                level="M"
              />
            </motion.div>
            <p style={{
              color: 'var(--text)',
              fontSize: 14,
              marginTop: 'var(--space-lg)',
            }}>
              {t('lobby.tap_close')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 区切り線 */}
      <div style={{
        width: '100%',
        maxWidth: 320,
        height: 1,
        background: 'var(--border)',
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
                  : '1px solid var(--border)',
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
                  <span style={{ fontSize: 12, color: 'var(--text-sub)', marginLeft: 8 }}>{t('common.host')}</span>
                )}
              </div>

              {/* ステータス */}
              <span style={{ fontSize: 14, color: player.ready ? 'var(--success)' : 'var(--text-sub)' }}>
                {player.ready ? t('lobby.ready') : t('lobby.waiting')}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* サウンド切り替え */}
      <div style={{ width: '100%', maxWidth: 320, display: 'flex', justifyContent: 'center', marginTop: 'var(--space-md)' }}>
        <button
          onClick={() => { sound.toggle(); setSoundOn(sound.enabled); }}
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
          title={soundOn ? 'Sound ON' : 'Sound OFF'}
        >
          {soundOn ? '🔊' : '🔇'}
        </button>
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
          <button type="button" className="btn-primary" onClick={handleReady}>
            {room.players.find(p => p.id === room.playerId)?.ready ? t('lobby.unready') : t('lobby.ready_btn')}
          </button>
        )}
        {isHost && (
          <button
            type="button"
            className="btn-primary"
            disabled={!allReady}
            onClick={() => room.start()}
          >
            {allReady ? t('lobby.start_game') : t('lobby.waiting_all')}
          </button>
        )}
      </div>
    </div>
  );
}
