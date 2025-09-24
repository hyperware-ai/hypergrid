import React from 'react';
import { PUBLISHER } from '../../constants';

type Props = {
  onContinue: () => void;
};

const WelcomeIntro: React.FC<Props> = ({ onContinue }) => {
  const handleProviderSwitch = () => {
    const origin = window.location.origin;
    const url = `${origin}/provider:hypergrid:${PUBLISHER}/`;
    window.location.href = url;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 640, maxWidth: 'min(640px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', border: '1px solid #e5e7eb' }}>
        <div style={{ padding: 20, borderBottom: '1px solid #eee' }}>
          <div style={{ fontWeight: 600, fontSize: 20 }}>Welcome to Hypergrid</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            Hypergrid is fully decentralized p2p remote tool use protocol designed to give your AI access to anything it needs with a single MCP server.
            <br />
            <br />
            The Hypergrid client runs on your own personal Hyperware node (you're using it right now), a platform which allows for performant apps that don't compromise on decentralization.
            <br />
            <br />
            This client allows you to use Hypergrid as an Operator, connecting this node to your AI and giving it access to any data feed or tool on the network, or as a Provider, where you create services that allow others to access those feeds and tools in exchange for micropayments.
            <br />
            <br />
            If you're only interested in being a Provider on this node, there's no need to do this configuration.
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={handleProviderSwitch}
              style={{ 
                background: '#ffffff', 
                color: '#111827', 
                padding: '10px 16px', 
                border: '1px solid #d1d5db', 
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              go to Provider interface
            </button>
            <button
              onClick={onContinue}
              style={{ 
                background: '#111827', 
                color: '#ffffff', 
                padding: '10px 16px', 
                border: '1px solid #111827', 
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              Continue Operator configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeIntro;