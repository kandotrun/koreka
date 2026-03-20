import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'home' | 'join' | 'create'>('home');
  const [name, setName] = useState('');
  const [code, setCode] = useState(['', '', '', '']);
  const [loading, setLoading] = useState(false);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleCreateRoom = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: name }),
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

  return (
    <div className="page" style={{ justifyContent: 'center', gap: 'var(--space-xl)' }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ textAlign: 'center' }}
      >
        <h1 style={{
          fontSize: 48,
          fontWeight: 900,
          color: 'var(--accent)',
          letterSpacing: '-0.02em',
        }}>
          Koreka
        </h1>
        <p style={{ color: 'var(--text-sub)', marginTop: 8, fontSize: 14 }}>
          これか！と思える瞬間を。
        </p>
      </motion.div>

      {mode === 'home' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
        >
          <button className="btn-primary" onClick={() => setMode('create')}>
            ルームを作る 🎴
          </button>
          <button className="btn-secondary" onClick={() => setMode('join')}>
            コードで参加
          </button>
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
              なまえ
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ニックネーム"
              maxLength={10}
              autoFocus
              style={{
                width: '100%',
                height: 48,
                background: 'var(--surface)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text)',
                fontSize: 16,
                padding: '0 16px',
              }}
            />
          </div>

          {/* Code input (join mode only) */}
          {mode === 'join' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 4, display: 'block' }}>
                ルームコード
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
            {loading ? '...' : mode === 'create' ? 'ルームを作成' : '参加する'}
          </button>

          <button className="btn-ghost" onClick={() => setMode('home')} style={{ textAlign: 'center' }}>
            戻る
          </button>
        </motion.div>
      )}
    </div>
  );
}
