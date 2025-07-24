import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface RegisteredProviderViewProps {
  provider: RegisteredProvider;
  onEdit?: (provider: RegisteredProvider) => void;
}

const RegisteredProviderView: React.FC<RegisteredProviderViewProps> = ({ provider, onEdit }) => {

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
      onClick={handleClick}
    >
      <div className="provider-left-section">
        <div className="provider-header">
          <h3 className="provider-name">
            <span className="provider-icon">🔌</span> {provider.provider_name}.obfusc-grid123.hypr
          </h3>
          <span className="provider-price">
            <span style={{ fontSize: '0.9em', opacity: 0.9 }}>💰 <span className="desktop-only">Price:</span></span>
            <strong>{formatPrice(provider.price)}</strong>
          </span>
        </div>
        {provider.description && (
          <p className="provider-description">{provider.description}</p>
        )}
      </div>
      
      <button 
        className="provider-edit-button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.(provider);
        }}
      >
        <span className="desktop-only">✏️ Edit</span>
        <span className="mobile-only">✏️</span>
      </button>
    </div>
  );
};

export default RegisteredProviderView; 