import React, { useState } from 'react';
import Modal from './Modal';
import { Variable } from '../types/hypergrid_provider';
import { FiCheckCircle } from 'react-icons/fi';
import { FaCopy } from 'react-icons/fa6';

interface CurlImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (template: string, variables: Variable[]) => void;
}

const CurlImportModal: React.FC<CurlImportModalProps> = ({
  isOpen,
  onClose,
  onImport
}) => {
  const [curlInput, setCurlInput] = useState('');

  const handleImport = () => {
    const trimmedCurl = curlInput.trim();
    if (!trimmedCurl) {
      alert('Please enter a curl command');
      return;
    }
    
    // Simply pass the curl command as-is
    // Variables will be selected later in the CurlTemplateEditor
    onImport(trimmedCurl, []);
    handleClose();
  };

  const handleClose = () => {
    setCurlInput('');
    onClose();
  };

  const exampleCurl = `curl -X GET \\
  -H "X-API-Key: your-api-key" \\
  -H "Content-Type: application/json" \\
  https://api.example.com/v1/data`;

  if (!isOpen) return null;

  return (
    <Modal title="Import from Curl" onClose={handleClose}>
      <div className="max-w-3xl">
        <div className="flex flex-col gap-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <FiCheckCircle className="text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-medium text-blue-900">Import Curl Command</h4>
                <p className="text-sm text-blue-700 mt-1">
                  Paste a curl command below to use it as a template. 
                  After importing, you can select parts of the command to turn into variables.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="curl-input" className="text-sm font-medium text-gray-700">
              Curl Command
            </label>
            <textarea
              id="curl-input"
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder="Paste your curl command here..."
              className="w-full h-32 p-3 border border-gray-300 rounded-lg font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h5 className="text-sm font-medium text-gray-700">Example:</h5>
              <button
                onClick={() => setCurlInput(exampleCurl)}
                className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded flex items-center gap-1"
              >
                <FaCopy className="text-xs" />
                Use Example
              </button>
            </div>
            <pre className="text-xs text-gray-600 overflow-x-auto">
              <code>{exampleCurl}</code>
            </pre>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              onClick={handleImport}
              disabled={!curlInput.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Import Curl Command
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CurlImportModal;