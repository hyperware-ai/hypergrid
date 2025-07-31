import React from 'react';
import { IndexedProvider } from '../types/hypergrid_provider';

export interface IndexedProviderViewProps {
  provider: IndexedProvider;
}

const IndexedProviderView: React.FC<IndexedProviderViewProps> = ({ provider }) => {

  const formatPrice = (price: number | string | undefined) => {
    // Handle string prices from database
    let numPrice: number;
    if (typeof price === 'string') {
      numPrice = parseFloat(price);
      if (isNaN(numPrice)) return 'Price: N/A';
    } else if (typeof price === 'number') {
      numPrice = price;
      if (isNaN(numPrice)) return 'Price: N/A';
    } else {
      return 'Price: N/A';
    }
    
    if (numPrice < 0.01) {
      return numPrice.toFixed(6) + ' USDC';
    } else {
      return numPrice.toFixed(2) + ' USDC';
    }
  };

  return (
    <div className="indexed-provider-card">
      <div className="provider-left-section">
        <div className="provider-header">
          <h3 className="provider-name">
            <span className="provider-icon">🌐</span> {provider.name}
            <span className="provider-type-badge">External</span>
          </h3>
          {provider.price !== undefined && (
            <span className="provider-price">
              <span style={{ fontSize: '0.9em', opacity: 0.9 }}>💰 <span className="desktop-only">Price:</span></span>
              <strong>{formatPrice(provider.price)}</strong>
            </span>
          )}
        </div>
        {provider.description && (
          <p className="provider-description">{provider.description}</p>
        )}
      </div>
    </div>
  );
};

export default IndexedProviderView;