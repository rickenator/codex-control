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
      const preloadErr = window.__PRELOAD_ERROR__ as Error | undefined;
      return (
        <div style={{
          height: '100%', width: '100%', background: '#1a1a2e', color: '#ff6b6b',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 40, fontFamily: 'monospace', fontSize: 14,
        }}>
          <h2 style={{ marginBottom: 16 }}>Consiglio crashed on startup</h2>
          <pre style={{ background: '#0d1117', padding: 16, borderRadius: 8, maxWidth: 600, overflow: 'auto' }}>
            {this.state.error}
          </pre>
          {preloadErr && (
            <div style={{ marginTop: 20, color: '#ffa500' }}>
              <strong>Preload error:</strong> {preloadErr.message}
            </div>
          )}
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
