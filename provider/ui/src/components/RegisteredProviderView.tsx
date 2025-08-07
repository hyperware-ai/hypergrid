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
      className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer flex items-center justify-between"
      onClick={handleClick}
    >
      <div className="flex-1">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-dark-gray flex items-center gap-2">
            <span>🔌</span> {provider.provider_name}.obfusc-grid123.hypr
          </h3>
          <span className="text-sm text-gray-600 flex items-center gap-1">
            <span className="text-base">💰</span>
            <span className="hidden md:inline">Price:</span>
            <strong>{formatPrice(provider.price)}</strong>
          </span>
        </div>
        {provider.description && (
          <p className="text-gray-600 text-sm">{provider.description}</p>
        )}
      </div>

      <button
        className="ml-4 px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md text-sm transition-colors flex items-center gap-1"
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.(provider);
        }}
      >
        <span className="hidden md:inline">✏️ Edit</span>
        <span className="md:hidden">✏️</span>
      </button>
    </div>
  );
};

export default RegisteredProviderView;