import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface RegisteredProviderViewProps {
  provider: RegisteredProvider;
  onEdit?: (provider: RegisteredProvider) => void;
}

const RegisteredProviderView: React.FC<RegisteredProviderViewProps> = ({ provider, onEdit }) => {

  const formatPrice = (price: number) => {
    if (typeof price !== 'number' || isNaN(price)) return 'N/A';
    
    // Format the number and remove trailing zeros
    let formatted: string;
    if (price < 0.01) {
      formatted = price.toFixed(8); // Use more decimals for very small numbers
    } else if (price < 1) {
      formatted = price.toFixed(6);
    } else {
      formatted = price.toFixed(2);
    }
    
    // Remove trailing zeros after decimal point
    formatted = formatted.replace(/\.?0+$/, '');
    
    return formatted + ' USDC';
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only trigger edit if not clicking the button itself
    if ((e.target as HTMLElement).tagName !== 'BUTTON') {
      onEdit?.(provider);
    }
  };

  return (
    <div
      className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex flex-col gap-3">
        {/* Top row with icon, name, and edit button */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-xl mt-0.5">🔌</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-gray-900 break-words">
                {provider.provider_name}.obfusc-grid123.hypr
              </h3>
              {provider.description && (
                <p className="text-gray-500 text-sm mt-1">{provider.description}</p>
              )}
            </div>
          </div>
          
          <button
            className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm transition-colors flex items-center gap-1.5 font-medium flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(provider);
            }}
          >
            <span>✏️</span>
            <span>Edit</span>
          </button>
        </div>
        
        {/* Bottom row with price */}
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-gray-500">💰 Price:</span>
          <span className="font-semibold text-gray-900">{formatPrice(provider.price)}</span>
        </div>
      </div>
    </div>
  );
};

export default RegisteredProviderView;