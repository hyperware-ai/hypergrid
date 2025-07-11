import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface RegisteredProviderViewProps {
  provider: RegisteredProvider;
  onEdit?: (provider: RegisteredProvider) => void;
}

const RegisteredProviderView: React.FC<RegisteredProviderViewProps> = ({ provider, onEdit }) => {
  const containerStyle: React.CSSProperties = {
    padding: '16px 20px',
    border: '1px solid var(--card-border)',
    background: 'var(--card-bg)',
    borderRadius: '8px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    transition: 'all 0.2s ease',
    cursor: 'pointer',
  };

  const containerHoverStyle: React.CSSProperties = {
    ...containerStyle,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    transform: 'translateY(-2px)',
  };

  const [isHovered, setIsHovered] = React.useState(false);

  const leftSectionStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    flexWrap: 'wrap',
  };

  const providerNameStyle: React.CSSProperties = {
    fontSize: '1.1em',
    fontWeight: '600',
    color: 'var(--heading-color)',
    margin: 0,
  };

  const priceStyle: React.CSSProperties = {
    fontSize: '0.95em',
    fontWeight: '600',
    color: 'var(--primary-color)',
    padding: '4px 12px',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: '6px',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const descriptionStyle: React.CSSProperties = {
    fontSize: '0.9em',
    color: 'var(--text-color)',
    opacity: 0.8,
    lineHeight: '1.4',
    margin: 0,
  };

  const editButtonStyle: React.CSSProperties = {
    padding: '6px 16px',
    backgroundColor: 'var(--button-primary-bg)',
    color: 'var(--button-primary-text)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9em',
    fontWeight: '500',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  };

  const formatPrice = (price: number) => {
    if (typeof price !== 'number' || isNaN(price)) return 'Price: N/A';
    if (price < 0.01) {
      return price.toFixed(6) + ' USDC';
    } else {
      return price.toFixed(2) + ' USDC';
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only trigger edit if not clicking the button itself
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      onEdit?.(provider);
    }
  };

  return (
    <div 
      className="registered-provider-card"
      style={isHovered ? containerHoverStyle : containerStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      <div style={leftSectionStyle}>
        <div style={headerStyle}>
          <h3 className="provider-name" style={providerNameStyle}>
            <span className="provider-icon">🔌</span> {provider.provider_name}.grid-beta.hypr
          </h3>
          <span className="provider-price" style={priceStyle}>
            <span style={{ fontSize: '0.9em', opacity: 0.9 }}>💰 <span className="desktop-only">Price:</span></span>
            <strong>{formatPrice(provider.price)}</strong>
          </span>
        </div>
        {provider.description && (
          <p style={descriptionStyle}>{provider.description}</p>
        )}
      </div>
      
      <button 
        className="provider-edit-button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.(provider);
        }}
        style={editButtonStyle}
      >
        <span className="desktop-only">✏️ Edit</span>
        <span className="mobile-only">✏️</span>
      </button>
    </div>
  );
};

export default RegisteredProviderView; 