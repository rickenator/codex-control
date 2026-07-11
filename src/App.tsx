import { useState } from 'react'

// Three-pane layout: sessions | event timeline | diff/terminal tabs
export default function App() {
  const [activeTab, setActiveTab] = useState<'diff' | 'terminal'>('terminal')

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Left: Session list */}
      <aside style={{ width: 260, borderRight: '1px solid #333', padding: 12, overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#aaa' }}>Sessions</h3>
        <div style={{ color: '#666', fontSize: 13 }}>No sessions yet — M2</div>
      </aside>

      {/* Center: Event timeline */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 8, borderBottom: '1px solid #333', fontSize: 13, color: '#888' }}>
          Event timeline — M2
        </div>
        <div style={{ flex: 1, padding: 16, color: '#555', fontSize: 13 }}>
          Connect to a Codex session to see events here.
        </div>
      </main>

      {/* Right: Diff / Terminal tabs */}
      <aside style={{ width: 400, borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
          <button
            onClick={() => setActiveTab('terminal')}
            style={{
              flex: 1, padding: '6px 0', background: activeTab === 'terminal' ? '#222' : 'transparent',
              border: 'none', color: activeTab === 'terminal' ? '#fff' : '#888', cursor: 'pointer', fontSize: 12,
            }}
          >Terminal</button>
          <button
            onClick={() => setActiveTab('diff')}
            style={{
              flex: 1, padding: '6px 0', background: activeTab === 'diff' ? '#222' : 'transparent',
              border: 'none', color: activeTab === 'diff' ? '#fff' : '#888', cursor: 'pointer', fontSize: 12,
            }}
          >Diff</button>
        </div>
        <div style={{ flex: 1, background: '#0a0a0a', padding: 8, fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
          {activeTab === 'terminal' ? 'Raw terminal pane — xterm.js (M1)' : 'Unified diff viewer — M4'}
        </div>
      </aside>
    </div>
  )
}
