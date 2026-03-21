import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';

export default function NotFound({ code }: { code?: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="page" role="main" style={{ justifyContent: 'center', gap: 'var(--space-lg)', textAlign: 'center' }}>
      <div>
        <div style={{ fontSize: 48, marginBottom: 'var(--space-md)' }}>🔍</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
          ルームが見つかりません
        </h2>
        {code && (
          <p style={{
            color: 'var(--text-sub)',
            fontSize: 14,
            marginTop: 'var(--space-sm)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.1em',
          }}>
            コード: {code}
          </p>
        )}
      </div>
      <button className="btn-primary" onClick={() => navigate('/')} style={{ maxWidth: 240 }}>
        {t('lobby.go_home')}
      </button>
    </div>
  );
}
