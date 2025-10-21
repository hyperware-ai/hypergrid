import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface ProviderCardProps {
  provider: RegisteredProvider;
  onEdit?: (provider: RegisteredProvider) => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({ provider, onEdit }) => {

  const formatPrice = (price: number) => {
    if (typeof price !== 'number' || isNaN(price)) return 'N/A';

    // Convert to string and check if it's in scientific notation
    const priceStr = price.toString();
    let formatted: string;
    
    if (priceStr.includes('e') || priceStr.includes('E')) {
      // For scientific notation, use high precision to preserve the full value
      formatted = price.toFixed(20).replace(/\.?0+$/, '');
    } else {
      // For normal numbers, use appropriate precision
      if (price < 0.000001) {
        formatted = price.toFixed(8);
      } else if (price < 0.01) {
        formatted = price.toFixed(6);
      } else if (price < 1) {
        formatted = price.toFixed(4);
      } else {
        formatted = price.toFixed(2);
      }
      // Remove trailing zeros
      formatted = formatted.replace(/\.?0+$/, '');
    }

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
      className="bg-white dark:bg-black p-5 rounded-xl shadow-sm border border-gray-200 dark:border-white hover:shadow-md  transition-all cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex flex-col gap-3">
        {/* Top row with icon, name, and edit button */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-xl mt-0.5">🔌</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 break-words">
                {provider.provider_name}.grid.hypr
              </h3>
              {provider.description && (
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{provider.description}</p>
              )}
            </div>
          </div>

          <button
            className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg text-sm flex-shrink-0 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
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
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <span>💰 Price: </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{formatPrice(provider.price)}</span>
        </div>
      </div>
    </div>
  );
};

export default ProviderCard;