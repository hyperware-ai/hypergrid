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
    <div className="bg-dark-gray self-stretch p-6 rounded-lg  grid grid-cols-3 gap-2 text-mid-gray ">

      <h3 className="text-lg font-semibold col-span-3">Hypergrid Registration Form</h3>
      <span className="pl-1 whitespace-pre flex-shrink-0 text-left">~provider-name:</span>
      <input
        autoFocus
        id="pform-providerName"
        type="text"
        value={providerName}
        onChange={(e) => setProviderName(e.target.value)}
        placeholder="provider-name"
        className="text-black bg-mid-gray dark:bg-black dark:text-white rounded px-2 py-1 h-full w-full "
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
        className="text-black  bg-mid-gray dark:bg-black dark:text-white rounded px-2 py-1 col-span-2"
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
        className="text-black  bg-mid-gray dark:bg-black dark:text-white rounded px-2 py-1 col-span-2"
      />


      <label htmlFor="pform-description" className="whitespace-pre text-left ">~description:</label>
      <textarea
        id="pform-description"
        value={providerDescription}
        onChange={(e) => setProviderDescription(e.target.value)}
        placeholder="Purpose of this provider (can be multiple lines)"
        rows={3}
        className="text-black  bg-mid-gray dark:bg-black dark:text-white rounded px-2 py-1 col-span-2"
      />

      <label htmlFor="pform-instructions" className=" whitespace-pre text-left">~instructions:</label>
      <textarea
        id="pform-instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Instructions for the provider"
        rows={3}
        className="text-black  bg-mid-gray dark:bg-black dark:text-white rounded px-2 py-1 col-span-2"
      />

    </div>
  );
};

export default HypergridEntryForm;
