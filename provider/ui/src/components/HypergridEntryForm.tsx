import React from 'react';

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
    <div className="bg-dark-gray min-w-[67vw] p-6 rounded-lg font-mono text-sm flex flex-col gap-2 text-mid-gray">

      <h3 className="text-lg font-semibold">Hypergrid Registration Form</h3>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          id="pform-providerName"
          type="text"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
          placeholder="provider-name"
          className="text-white font-bold text-lg  !border-b !border-dashed border-gray"
          style={{
            width: `${providerName.length || 13}ch`, // Use actual length or placeholder length
          }}
        />
        <span className="text-gray-300">.obfusc-grid123.hypr</span>
      </div>

      {/* Trunk line from HNS name down to the first branch */}
      <div className="flex items-baseline h-3 mb-px pl-1">
        <span className="text-gray-500 w-5 mr-1 whitespace-pre text-left flex-shrink-0">│</span>
      </div>

      {/* Provider ID (Node ID) Display */}
      <div className="flex items-baseline min-h-[1.6em] mb-px pl-1 text-left">
        <span className="text-gray-500 w-5 mr-px whitespace-pre text-left flex-shrink-0">├─</span>
        <span className="text-gray-400 w-[105px] whitespace-pre flex-shrink-0 text-left">~provider-id:</span>
        <span className="font-mono text-sm text-gray-300 py-0.5 flex-grow border-b border-dashed border-gray-600">{nodeId || "(Node ID N/A)"}</span>
      </div>

      {/* Trunk Connector */}
      <div className="flex items-baseline h-3 mb-px pl-1">
        <span className="text-gray-500 w-5 mr-1 whitespace-pre text-left flex-shrink-0">│</span>
      </div>

      {/* Wallet Input */}
      <div className="flex items-baseline min-h-[1.6em] mb-px pl-1">
        <span className="text-gray-500 w-5 mr-px whitespace-pre text-left flex-shrink-0">├─</span>
        <label htmlFor="pform-wallet" className="text-gray-400 w-[105px] whitespace-pre flex-shrink-0 text-left">~wallet:</label>
        <input
          id="pform-wallet"
          type="text"
          value={registeredProviderWallet}
          onChange={(e) => setRegisteredProviderWallet(e.target.value)}
          placeholder="0x... (ETH Address on Base)"
          className="font-mono text-sm bg-transparent text-gray-300 border-none border-b border-dashed border-gray-500 py-0.5 flex-grow w-full outline-none"
        />
      </div>

      {/* Trunk Connector */}
      <div className="flex items-baseline h-3 mb-px pl-1">
        <span className="text-gray-500 w-5 mr-1 whitespace-pre text-left flex-shrink-0">│</span>
      </div>

      {/* Price Input */}
      <div className="flex items-baseline min-h-[1.6em] mb-px pl-1">
        <span className="text-gray-500 w-5 mr-px whitespace-pre text-left flex-shrink-0">├─</span>
        <label htmlFor="pform-price" className="text-gray-400 w-[105px] whitespace-pre flex-shrink-0 text-left">~price:</label>
        <input
          id="pform-price"
          type="text"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="e.g., 0.01 (USDC)"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          className="font-mono text-sm bg-transparent text-gray-300 border-none border-b border-dashed border-gray-500 py-0.5 flex-grow w-full outline-none"
        />
      </div>

      {/* Trunk Connector */}
      <div className="flex items-baseline h-3 mb-px pl-1">
        <span className="text-gray-500 w-5 mr-1 whitespace-pre text-left flex-shrink-0">│</span>
      </div>

      {/* Description Input - Changed to textarea */}
      <div className="flex items-start min-h-[1.6em] mb-px pl-1">
        <span className="text-gray-500 w-5 mr-px whitespace-pre text-left flex-shrink-0">├─</span>
        <label htmlFor="pform-description" className="text-gray-400 w-[105px] whitespace-pre flex-shrink-0 text-left pt-0.5">~description:</label>
        <textarea
          id="pform-description"
          value={providerDescription}
          onChange={(e) => setProviderDescription(e.target.value)}
          placeholder="Purpose of this provider (can be multiple lines)"
          rows={3}
          className="font-mono text-sm bg-transparent text-gray-300 border-none border-b border-dashed border-gray-500 py-0.5 flex-grow w-full resize-y outline-none h-[4em]"
        />
      </div>

      {/* Trunk Connector */}
      <div className="flex items-baseline h-3 mb-px pl-1">
        <span className="text-gray-500 w-5 mr-px whitespace-pre text-left flex-shrink-0">│</span>
      </div>

      {/* Instructions Input */}
      <div className="flex items-start min-h-[1.6em] mb-px pl-1">
        <span className="text-gray-500 w-5 mr-px whitespace-pre text-left flex-shrink-0">├─</span>
        <label htmlFor="pform-instructions" className="text-gray-400 w-[105px] whitespace-pre flex-shrink-0 text-left">~instructions:</label>
        <textarea
          id="pform-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Instructions for the provider"
          rows={3}
          className="font-mono text-sm bg-transparent text-gray-300 border-none border-b border-dashed border-gray-500 py-0.5 flex-grow w-full resize-y outline-none h-[4em]"
        />
      </div>

    </div>
  );
};

export default HypergridEntryForm;