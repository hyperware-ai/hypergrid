import React from 'react';

type Props = {
  onDone: () => void;
};

const SetupComplete: React.FC<Props> = ({ onDone }) => {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 520, maxWidth: 'min(520px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', border: '1px solid #e5e7eb' }}>
        <div style={{ padding: 16, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Operator setup complete</div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ color: '#4b5563', fontSize: 13, marginBottom: 12 }}>
            Your Hyperwallet is ready. All you need to do is send some USDC (be sure it's on Base) to your Hyperwallet address, configure an Operator client to connect to your AI via our MCP shim, and you're good to go.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={onDone}
              style={{ 
                background: '#111827', 
                color: '#ffffff', 
                padding: '8px 12px', 
                border: '1px solid #111827', 
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupComplete;