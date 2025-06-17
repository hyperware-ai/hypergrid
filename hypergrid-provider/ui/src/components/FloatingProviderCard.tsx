import React, { useState, useRef, useEffect } from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface FloatingProviderCardProps {
  provider: RegisteredProvider;
  onEdit?: (provider: RegisteredProvider) => void;
  onCopyMetadata?: (provider: RegisteredProvider) => void;
  initialPosition?: { x: number; y: number };
}

const FloatingProviderCard: React.FC<FloatingProviderCardProps> = ({ 
  provider, 
  onEdit, 
  onCopyMetadata,
  initialPosition = { x: 50, y: 50 }
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isFlipButtonHovered, setIsFlipButtonHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const formatPrice = (price: number) => {
    if (typeof price !== 'number' || isNaN(price)) return 'N/A';
    if (price < 0.01) {
      return price.toFixed(6);
    } else {
      return price.toFixed(2);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Don't start dragging if clicking on interactive elements  
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    
    e.preventDefault(); // Prevent text selection and other default behaviors
    
    // Calculate offset from current position, not from rect
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
    setIsDragging(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset]);

  const cardContainerStyle: React.CSSProperties = {
    position: 'absolute',
    left: position.x,
    top: position.y,
    width: '400px',
    height: '500px',
    perspective: '1000px',
    cursor: isDragging ? 'grabbing' : 'grab',
    zIndex: isDragging ? 1000 : 10,
    userSelect: isDragging ? 'none' : 'auto', // Allow text selection when not dragging
  };

  const cardInnerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    textAlign: 'center',
    transition: isDragging ? 'none' : 'transform 0.6s', // Disable flip transition while dragging
    transformStyle: 'preserve-3d',
    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
  };

  const cardFaceStyle: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backfaceVisibility: 'hidden',
    borderRadius: '16px',
    boxShadow: isDragging 
      ? '0 16px 64px rgba(0, 0, 0, 0.4)' 
      : '0 8px 32px rgba(0, 0, 0, 0.2)',
    border: '1px solid var(--card-border)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    transform: isDragging ? 'scale(1.02)' : 'scale(1)',
    transition: isDragging ? 'none' : 'all 0.2s ease',
  };

  const cardFrontStyle: React.CSSProperties = {
    ...cardFaceStyle,
    background: 'linear-gradient(135deg, var(--card-bg) 0%, rgba(255, 255, 255, 0.05) 100%)',
  };

  const cardBackStyle: React.CSSProperties = {
    ...cardFaceStyle,
    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, var(--card-bg) 100%)',
    transform: 'rotateY(180deg)',
  };

  const cardHeaderStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(147, 51, 234, 0.2) 100%)',
    padding: '16px',
    borderBottom: '1px solid var(--card-border)',
  };

  const cardBodyStyle: React.CSSProperties = {
    padding: '16px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontSize: '0.9em',
  };

  const statusBadgeStyle: React.CSSProperties = {
    backgroundColor: '#10B981',
    color: 'white',
    padding: '4px 8px',
    borderRadius: '8px',
    fontSize: '0.7em',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    display: 'inline-block',
    marginTop: '8px',
  };

  const infoRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '6px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  };

  const labelStyle: React.CSSProperties = {
    color: 'var(--text-color)',
    opacity: 0.7,
    fontSize: '0.8em',
    fontWeight: '500',
  };

  const valueStyle: React.CSSProperties = {
    color: 'var(--text-color)',
    fontSize: '0.8em',
    fontFamily: 'monospace',
    textAlign: 'right',
    flex: 1,
    marginLeft: '8px',
    wordBreak: 'break-all',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.8em',
    fontWeight: '500',
    transition: 'all 0.2s ease',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
    color: 'white',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: 'var(--button-secondary-bg)',
    color: 'var(--button-secondary-text)',
    border: '1px solid var(--input-border)',
  };

  const getFlipButtonStyle = (isHovered: boolean): React.CSSProperties => ({
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: isHovered 
      ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.8) 0%, rgba(147, 51, 234, 0.8) 100%)'
      : 'linear-gradient(135deg, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.1) 100%)',
    border: isHovered 
      ? '1px solid rgba(59, 130, 246, 0.5)'
      : '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.3em',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 100,
    backdropFilter: 'blur(8px)',
    boxShadow: isHovered
      ? '0 8px 20px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3)'
      : '0 4px 12px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
    color: '#ffffff',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
    transform: isHovered ? 'scale(1.1) rotate(180deg)' : 'scale(1) rotate(0deg)',
  });

  return (
    <div 
      ref={cardRef}
      style={cardContainerStyle}
      onMouseDown={handleMouseDown}
    >
      <div style={cardInnerStyle}>
        {/* Front Side - Basic Info */}
        <div style={cardFrontStyle}>
          <button 
            className="no-drag"
            style={getFlipButtonStyle(isFlipButtonHovered)}
            onClick={(e) => {
              e.stopPropagation();
              setIsFlipped(!isFlipped);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setIsFlipButtonHovered(true)}
            onMouseLeave={() => setIsFlipButtonHovered(false)}
            title="Flip to see technical details"
          >
            🔄
          </button>
          
          <div style={cardHeaderStyle}>
            <h3 style={{ 
              margin: 0, 
              color: 'var(--heading-color)',
              fontSize: '1.1em',
              fontWeight: '600'
            }}>
              🔌 {provider.provider_name}
            </h3>
            <div style={{ fontSize: '0.7em', color: 'var(--text-color)', opacity: 0.8, marginTop: '4px' }}>
              {provider.provider_name}.grid-beta.hypr
            </div>
            <span style={statusBadgeStyle}>Active</span>
          </div>

          <div style={cardBodyStyle}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Price:</span>
              <span style={valueStyle}>{formatPrice(provider.price)} USDC</span>
            </div>
            
            <div style={infoRowStyle}>
              <span style={labelStyle}>Method:</span>
              <span style={valueStyle}>{provider.endpoint.method}</span>
            </div>
            
            <div style={infoRowStyle}>
              <span style={labelStyle}>Wallet:</span>
            </div>
            <div className="no-drag" style={{
              fontSize: '0.7em',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              padding: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '4px',
              border: '1px solid var(--card-border)',
              marginBottom: '8px',
            }}>
              {provider.registered_provider_wallet}
            </div>

            {provider.description && (
              <div className="no-drag" style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--card-border)',
                fontSize: '0.8em',
                lineHeight: '1.4',
                flex: 1,
                overflow: 'auto',
              }}>
                <div style={{ ...labelStyle, marginBottom: '6px' }}>Description:</div>
                {provider.description}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
              <button 
                className="no-drag"
                style={primaryButtonStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(provider);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                ✏️ Edit
              </button>
              <button 
                className="no-drag"
                style={secondaryButtonStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyMetadata?.(provider);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                📋 Copy
              </button>
            </div>
          </div>
        </div>

        {/* Back Side - Technical Details */}
        <div style={cardBackStyle}>
          <button 
            className="no-drag"
            style={getFlipButtonStyle(isFlipButtonHovered)}
            onClick={(e) => {
              e.stopPropagation();
              setIsFlipped(!isFlipped);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setIsFlipButtonHovered(true)}
            onMouseLeave={() => setIsFlipButtonHovered(false)}
            title="Flip to see basic info"
          >
            🔄
          </button>
          
          <div style={cardHeaderStyle}>
            <h3 style={{ 
              margin: 0, 
              color: 'var(--heading-color)',
              fontSize: '1.1em',
              fontWeight: '600'
            }}>
              🔧 Technical Details
            </h3>
            <div style={{ fontSize: '0.7em', color: 'var(--text-color)', opacity: 0.8, marginTop: '4px' }}>
              API Configuration
            </div>
          </div>

          <div style={cardBodyStyle}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Request Type:</span>
              <span style={valueStyle}>{provider.endpoint.request_structure.replace(/([A-Z])/g, ' $1').trim()}</span>
            </div>

            <div style={infoRowStyle}>
              <span style={labelStyle}>Provider ID:</span>
            </div>
            <div className="no-drag" style={{
              fontSize: '0.7em',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              padding: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '4px',
              border: '1px solid var(--card-border)',
              marginBottom: '8px',
            }}>
              {provider.provider_id || 'N/A'}
            </div>

            <div style={infoRowStyle}>
              <span style={labelStyle}>Base URL:</span>
            </div>
            <div className="no-drag" style={{
              fontSize: '0.7em',
              fontFamily: 'monospace',
              wordBreak: 'break-all',
              padding: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '4px',
              border: '1px solid var(--card-border)',
              marginBottom: '8px',
            }}>
              {provider.endpoint.base_url_template}
            </div>

            {/* Parameters */}
            <div style={{ fontSize: '0.8em' }}>
              {provider.endpoint.path_param_keys?.length > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  <span style={labelStyle}>Path Params: </span>
                  <span style={{ fontSize: '0.9em' }}>{provider.endpoint.path_param_keys.join(', ')}</span>
                </div>
              )}
              {provider.endpoint.query_param_keys?.length > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  <span style={labelStyle}>Query Params: </span>
                  <span style={{ fontSize: '0.9em' }}>{provider.endpoint.query_param_keys.join(', ')}</span>
                </div>
              )}
              {provider.endpoint.header_keys?.length > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  <span style={labelStyle}>Headers: </span>
                  <span style={{ fontSize: '0.9em' }}>{provider.endpoint.header_keys.join(', ')}</span>
                </div>
              )}
              {provider.endpoint.body_param_keys?.length > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  <span style={labelStyle}>Body Params: </span>
                  <span style={{ fontSize: '0.9em' }}>{provider.endpoint.body_param_keys.join(', ')}</span>
                </div>
              )}
            </div>

            {provider.endpoint.api_key && (
              <div style={infoRowStyle}>
                <span style={labelStyle}>API Key:</span>
                <span style={valueStyle}>••••••••{provider.endpoint.api_key.slice(-4)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloatingProviderCard; 