import React from 'react';
import { HYPR_SUFFIX } from '../constants';

export interface HypergridEntryFormProps {
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

const HypergridEntryForm: React.FC<HypergridEntryFormProps> = ({
  nodeId,
  providerName, setProviderName,
  providerDescription, setProviderDescription,
  instructions, setInstructions,
  registeredProviderWallet, setRegisteredProviderWallet,
  price, setPrice,
}) => {
  return (
    <div className="bg-black border border-gray-600 rounded-lg p-6 font-mono text-sm">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-700">
        <div className="w-3 h-3 rounded-full bg-red-500"></div>
        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
        <div className="w-3 h-3 rounded-full bg-green-500"></div>
        <span className="ml-2 text-gray-400 text-xs">hypergrid.config</span>
      </div>
      
      <div className="space-y-3">
        {/* Provider Name */}
        <div className="flex items-start gap-0">
          <span className="text-cyan font-medium">~provider-name:</span>
          <div className="flex-1 ml-2">
            <input
              id="pform-providerName"
              type="text"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="provider-name"
              className="bg-transparent border-none outline-none text-green-400 placeholder-gray-600 w-full font-mono"
            />
            <span className="text-gray-500">.obfusc-grid123.hypr</span>
          </div>
        </div>

        {/* Provider ID (read-only) */}
        <div className="flex items-center gap-0">
          <span className="text-cyan font-medium">~provider-id:</span>
          <span className="ml-2 text-gray-400">{nodeId || "(Node ID N/A)"}</span>
        </div>

        {/* Wallet */}
        <div className="flex items-start gap-0">
          <span className="text-cyan font-medium">~wallet:</span>
          <input
            id="pform-wallet"
            type="text"
            value={registeredProviderWallet}
            onChange={(e) => setRegisteredProviderWallet(e.target.value)}
            placeholder="0x... (ETH Address on Base)"
            className="flex-1 ml-2 bg-transparent border-none outline-none text-green-400 placeholder-gray-600 font-mono"
          />
        </div>

        {/* Price */}
        <div className="flex items-start gap-0">
          <span className="text-cyan font-medium">~price:</span>
          <input
            id="pform-price"
            type="text"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.01"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            className="flex-1 ml-2 bg-transparent border-none outline-none text-green-400 placeholder-gray-600 font-mono"
          />
          <span className="text-gray-500 ml-1"># USDC</span>
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <span className="text-cyan font-medium">~description:</span>
          <textarea
            id="pform-description"
            value={providerDescription}
            onChange={(e) => setProviderDescription(e.target.value)}
            placeholder="Purpose of this provider..."
            rows={3}
            className="ml-2 bg-transparent border border-gray-700 rounded px-2 py-1 text-green-400 placeholder-gray-600 font-mono text-sm resize-none focus:border-cyan focus:outline-none"
          />
        </div>

        {/* Instructions */}
        <div className="flex flex-col gap-1">
          <span className="text-cyan font-medium">~instructions:</span>
          <textarea
            id="pform-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instructions for using this provider..."
            rows={4}
            className="ml-2 bg-transparent border border-gray-700 rounded px-2 py-1 text-green-400 placeholder-gray-600 font-mono text-sm resize-none focus:border-cyan focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
};

export default HypergridEntryForm;
