import { useState } from 'react';
import useSWR from 'swr';
import { useI18n } from '../contexts/I18nContext';
import { authFetcher } from '../lib/fetcher';

interface StatsData {
  totalCards: number;
  totalRooms: number;
  totalMemories: number;
  topCards: Array<{ text: string; category: string; timesSelected: number }>;
}

const categoryMeta: Record<string, { icon: string }> = {
  adventure: { icon: '🏔️' },
  chill: { icon: '☕' },
  food: { icon: '🍜' },
  night: { icon: '🌙' },
  creative: { icon: '🎨' },
  random: { icon: '🎲' },
  spicy: { icon: '🔥' },
  trending: { icon: '📰' },
  seasonal: { icon: '🌸' },
};

export default function Admin() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('adminToken'));
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = async () => {
    if (!password.trim()) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json() as { token: string };
        localStorage.setItem('adminToken', data.token);
        setToken(data.token);
        setPassword('');
      } else {
        setLoginError(t('admin.login_failed'));
      }
    } catch {
      setLoginError(t('admin.login_failed'));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setToken(null);
  };

  const { data: stats, error } = useSWR<StatsData>(
    token ? '/api/admin/stats' : null,
    (url: string) => authFetcher(url, token!),
    {
      onError: (err) => {
        if (err.message === 'Unauthorized') handleLogout();
      },
    },
  );

  // Login form
  if (!token) {
    return (
      <div className="page" role="main" style={{ justifyContent: 'center', gap: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, textAlign: 'center' }}>
          {t('admin.login_title')}
        </h1>
        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder={t('admin.password')}
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
          {loginError && (
            <p style={{ color: 'var(--danger)', fontSize: 14 }}>{loginError}</p>
          )}
          <button
            className="btn-primary"
            disabled={!password.trim() || loginLoading}
            onClick={handleLogin}
          >
            {loginLoading ? '...' : t('admin.login')}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page" role="main" style={{ justifyContent: 'center' }}>
        <p style={{ color: 'var(--danger)' }}>{error.message === 'Unauthorized' ? t('admin.auth_error') : t('admin.fetch_error')}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="page" role="main" style={{ justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-sub)' }}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="page" role="main" style={{ padding: 'var(--space-lg)', maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
        <h1 style={{ fontSize: 28, fontWeight: 900 }}>
          {t('admin.title')}
        </h1>
        <button
          className="btn-ghost"
          onClick={handleLogout}
          style={{ fontSize: 14 }}
        >
          {t('admin.logout')}
        </button>
      </div>

      {/* Summary Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 'var(--space-md)',
        marginBottom: 'var(--space-xl)',
      }}>
        {[
          { label: t('admin.total_cards'), value: stats.totalCards },
          { label: t('admin.total_rooms'), value: stats.totalRooms },
          { label: t('admin.total_memories'), value: stats.totalMemories },
        ].map(item => (
          <div key={item.label} style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-lg)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary)' }}>
              {item.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 'var(--space-xs)' }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Top Cards */}
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-md)' }}>
        {t('admin.top_cards')}
      </h2>
      {stats.topCards.length === 0 ? (
        <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>{t('admin.no_data')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {stats.topCards.map((card, i) => {
            const meta = categoryMeta[card.category] || { icon: '📋' };
            return (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                background: 'var(--surface)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-sm) var(--space-md)',
              }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-sub)', minWidth: 24 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{card.text}</span>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--primary)',
                  background: 'rgba(255,107,53,0.1)',
                  borderRadius: 'var(--radius-full)',
                  padding: '2px 8px',
                }}>
                  {t('admin.times', card.timesSelected)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
