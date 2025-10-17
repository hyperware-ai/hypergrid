import React from 'react';
import { RegisteredProvider } from '../types/hypergrid_provider';

export interface RegisteredProviderViewProps {
  provider: RegisteredProvider;
  onEdit?: (provider: RegisteredProvider) => void;
  onToggleLive?: (provider: RegisteredProvider) => void;
}

const RegisteredProviderView: React.FC<RegisteredProviderViewProps> = ({ provider, onEdit, onToggleLive }) => {

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
    // Only trigger edit if not clicking a button
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON' && !target.closest('button')) {
      onEdit?.(provider);
    }
  };

  const handleToggleLive = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleLive?.(provider);
  };

  return (
    <div
      className="bg-white dark:bg-black p-5 rounded-xl shadow-sm border border-gray-200 dark:border-white hover:shadow-md  transition-all cursor-pointer"
      onClick={handleClick}
    >
      <div className="flex flex-col gap-3">
        {/* Top row with icon, name, status, and edit button */}
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

        {/* Bottom row with price and toggle */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span>💰 Price: </span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{formatPrice(provider.price)}</span>
          </div>
          
          {/* Toggle switch - legacy providers default to "on" */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {provider.is_live === false ? 'Off' : 'On'}
            </span>
            <button
              onClick={handleToggleLive}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 ${
                provider.is_live === false
                  ? 'bg-gray-300 dark:bg-gray-600 justify-start'
                  : 'bg-green-500 dark:bg-green-600 justify-end'
              }`}
              aria-label={provider.is_live === false ? 'Turn provider on' : 'Turn provider off'}
            >
              <span className={`h-3 w-3 m-1 bg-white transition-all ${
                provider.is_live === false ? 'rounded-sm' : 'rounded-full'
              }`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisteredProviderView;