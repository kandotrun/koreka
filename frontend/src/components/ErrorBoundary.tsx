import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="main"
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-lg)',
            padding: 'var(--space-xl)',
            background: 'var(--bg)',
            color: 'var(--text)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48 }}>😵</div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>エラーが発生しました</h1>
          <p style={{ color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.6 }}>
            予期しないエラーが発生しました。
          </p>
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 32px',
              background: 'var(--primary)',
              color: 'white',
              borderRadius: 'var(--radius-md)',
              fontWeight: 700,
              fontSize: 15,
              textDecoration: 'none',
              border: 'none',
            }}
          >
            トップに戻る
          </a>
        </div>
      );
    }

    return this.props.children;
  }
}
