import React from 'react';
import EnhancedCurlImportModal from './EnhancedCurlImportModal';
import HypergridEntryForm from './HypergridEntryForm';

interface UnifiedTerminalInterfaceProps {
  // cURL props
  onCurlImport: (curlTemplateData: any) => void;
  onParseSuccess?: () => void;
  onParseClear?: () => void;
  originalCurlCommand?: string;
  onCurlStateChange?: (state: any) => void;
  preservedCurlState?: any;
  
  // Hypergrid form props
  configuredCurlTemplate: any;
  nodeId: string;
  providerName: string;
  setProviderName: (value: string) => void;
  providerDescription: string;
  setProviderDescription: (value: string) => void;
  instructions: string;
  setInstructions: (value: string) => void;
  registeredProviderWallet: string;
  setRegisteredProviderWallet: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
}

const UnifiedTerminalInterface: React.FC<UnifiedTerminalInterfaceProps> = ({
  onCurlImport,
  onParseSuccess,
  onParseClear,
  originalCurlCommand,
  onCurlStateChange,
  preservedCurlState,
  configuredCurlTemplate,
  nodeId,
  providerName,
  setProviderName,
  providerDescription,
  setProviderDescription,
  instructions,
  setInstructions,
  registeredProviderWallet,
  setRegisteredProviderWallet,
  price,
  setPrice,
}) => {
  return (
    <div className="bg-stone-100 dark:bg-gray-800 border border-stone-300 dark:border-gray-600 rounded-lg font-mono text-sm overflow-hidden">
      {/* Terminal Header */}
      <div className="flex items-center gap-2 p-4 pb-3 border-b border-stone-300 dark:border-gray-700 bg-stone-200 dark:bg-gray-900">
        <div className="w-3 h-3 rounded-full bg-red-500"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
        <div className="w-3 h-3 rounded-full bg-green-500"></div>
        <span className="ml-2 text-stone-600 dark:text-gray-400 text-xs">provider.config</span>
      </div>

      {/* API Configuration Section */}
      <div className="p-6 border-b border-stone-300 dark:border-gray-700">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-blue-600 dark:text-blue-400 font-medium">Configuration</span>
          <span className="text-stone-500 dark:text-gray-600 text-xs">offchain</span>
        </div>
        
        <div className="bg-stone-200 dark:bg-gray-900/50 rounded border border-stone-300 dark:border-gray-700 p-1">
          <EnhancedCurlImportModal
            isOpen={true}
            onClose={() => {}}
            onImport={onCurlImport}
            onParseSuccess={onParseSuccess}
            onParseClear={onParseClear}
            isInline={true}
            initialCurlCommand={originalCurlCommand}
            onStateChange={onCurlStateChange}
            preservedState={preservedCurlState}
          />
        </div>
      </div>

      {/* Provider Metadata Section */}
      {configuredCurlTemplate && (
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-cyan-600 dark:text-cyan font-medium">Metadata</span>
            <span className="text-stone-500 dark:text-gray-600 text-xs">onchain</span>
          </div>
          
          {/* Provider Name Header */}
          <div className="mb-4 pb-3 border-b border-stone-300 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <input
                id="pform-providerName"
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="provider-name"
                className="bg-transparent border-none outline-none text-yellow-600 dark:text-yellow-400 placeholder-stone-500 dark:placeholder-gray-600 font-mono text-lg font-medium"
              />
              <span className="text-stone-500 dark:text-gray-500">.obfusc-grid123.hypr</span>
              <span className="text-stone-500 dark:text-gray-600 text-xs ml-auto">provider namespace</span>
            </div>
          </div>

          {/* Provider Notes */}
          <div className="space-y-3 ml-4">
            {/* Provider ID (read-only) */}
            <div className="flex items-center gap-0">
              <span className="text-cyan-600 dark:text-cyan font-medium">~provider-id:</span>
              <span className="ml-2 text-stone-600 dark:text-gray-400">{nodeId || "(Node ID N/A)"}</span>
            </div>

            {/* Wallet */}
            <div className="flex items-center gap-0 group">
              <span className="text-cyan-600 dark:text-cyan font-medium">~wallet:</span>
              <input
                id="pform-wallet"
                type="text"
                value={registeredProviderWallet}
                onChange={(e) => setRegisteredProviderWallet(e.target.value)}
                placeholder="0x... (ETH Address on Base)"
                className="ml-2 bg-transparent border-none outline-none text-green-600 dark:text-green-400 placeholder-stone-500 dark:placeholder-gray-600 font-mono w-80"
              />
              {registeredProviderWallet && (
                <button
                  onClick={() => setRegisteredProviderWallet('')}
                  className="ml-2 p-0.5 rounded text-stone-500 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="Clear wallet address"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Price */}
            <div className="flex items-start gap-0">
              <span className="text-cyan-600 dark:text-cyan font-medium">~price:</span>
              <input
                id="pform-price"
                type="text"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.01"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                className="flex-1 ml-2 bg-transparent border-none outline-none text-green-600 dark:text-green-400 placeholder-stone-500 dark:placeholder-gray-600 font-mono"
              />
              <span className="text-stone-500 dark:text-gray-500 ml-1"># USDC</span>
            </div>

            {/* Description */}
            <div className="flex items-start gap-0">
              <span className="text-cyan-600 dark:text-cyan font-medium">~description:</span>
              <textarea
                id="pform-description"
                value={providerDescription}
                onChange={(e) => setProviderDescription(e.target.value)}
                placeholder="Purpose of this provider..."
                className="flex-1 ml-2 bg-transparent border-none outline-none resize-none text-green-600 dark:text-green-400 placeholder-stone-500 dark:placeholder-gray-600 font-mono text-sm min-h-[1.5rem]"
                rows={providerDescription ? Math.min(Math.max(1, Math.ceil(providerDescription.length / 80)), 4) : 1}
              />
            </div>

            {/* Instructions */}
            <div className="flex items-start gap-0">
              <span className="text-cyan-600 dark:text-cyan font-medium">~instructions:</span>
              <textarea
                id="pform-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Instructions for using this provider..."
                className="flex-1 ml-2 bg-transparent border-none outline-none resize-none text-green-600 dark:text-green-400 placeholder-stone-500 dark:placeholder-gray-600 font-mono text-sm min-h-[1.5rem]"
                rows={instructions ? Math.min(Math.max(1, Math.ceil(instructions.length / 80)), 4) : 1}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnifiedTerminalInterface;
