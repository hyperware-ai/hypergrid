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
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 dark:from-gray-800 dark:to-gray-900 self-stretch p-6 rounded-xl shadow-lg border border-gray-600/30 grid grid-cols-3 gap-3 text-gray-300 items-center">

      <h3 className="text-xl font-semibold col-span-3 mb-1 text-gray-100 border-b border-gray-600/50 pb-2">Hypergrid Registration Form</h3>
      <span className="pl-1 whitespace-pre flex-shrink-0 text-left">~provider-name:</span>
      <input
        autoFocus
        id="pform-providerName"
        type="text"
        value={providerName}
        onChange={(e) => setProviderName(e.target.value)}
        placeholder="provider-name"
        className="bg-gray-700 text-gray-100 rounded-lg px-3 py-1.5 h-full w-full border border-gray-600/50 focus:border-cyan focus:ring-1 focus:ring-cyan/50 transition-all"
      />
      <span className="">.obfusc-grid123.hypr</span>


      <span className="pl-1 whitespace-pre flex-shrink-0 text-left">~provider-id:</span>
      <span className="  flex-grow col-span-2">{nodeId || "(Node ID N/A)"}</span>

      <label
        htmlFor="pform-wallet"
        className=" pl-1 whitespace-pre flex-shrink-0 text-left">~wallet:</label>
      <input
        id="pform-wallet"
        type="text"
        value={registeredProviderWallet}
        onChange={(e) => setRegisteredProviderWallet(e.target.value)}
        placeholder="0x... (ETH Address on Base)"
        className="bg-gray-700 text-gray-100 rounded-lg px-3 py-1.5 col-span-2 border border-gray-600/50 focus:border-cyan focus:ring-1 focus:ring-cyan/50 transition-all"
      />

      <label htmlFor="pform-price" className=" pl-1 whitespace-pre text-left">~price:</label>
      <input
        id="pform-price"
        type="text"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="e.g., 0.01 (USDC)"
        inputMode="decimal"
        pattern="[0-9]*\.?[0-9]*"
        className="bg-gray-700 text-gray-100 rounded-lg px-3 py-1.5 col-span-2 border border-gray-600/50 focus:border-cyan focus:ring-1 focus:ring-cyan/50 transition-all"
      />


      <label htmlFor="pform-description" className="whitespace-pre text-left ">~description:</label>
      <textarea
        id="pform-description"
        value={providerDescription}
        onChange={(e) => setProviderDescription(e.target.value)}
        placeholder="Purpose of this provider (can be multiple lines)"
        rows={3}
        className="bg-gray-700 text-gray-100 rounded-lg px-3 py-1.5 col-span-2 border border-gray-600/50 focus:border-cyan focus:ring-1 focus:ring-cyan/50 transition-all"
      />

      <label htmlFor="pform-instructions" className=" whitespace-pre text-left">~instructions:</label>
      <textarea
        id="pform-instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Instructions for the provider"
        rows={3}
        className="bg-gray-700 text-gray-100 rounded-lg px-3 py-1.5 col-span-2 border border-gray-600/50 focus:border-cyan focus:ring-1 focus:ring-cyan/50 transition-all"
      />

    </div>
  );
};

export default HypergridEntryForm;
