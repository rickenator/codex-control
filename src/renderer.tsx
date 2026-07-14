import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Error boundary to catch render errors
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100%', width: '100%', background: '#070b14', color: '#f0f6fc',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 40, fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: 14,
        }}>
          <h2 style={{ marginBottom: 16 }}>Consiglio crashed on startup</h2>
          <pre style={{ background: '#0d1320', padding: 16, borderRadius: 8, maxWidth: 600, overflow: 'auto', border: '1px solid rgba(255,255,255,0.08)' }}>
            {this.state.error}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
