import React, { useState, useRef, useEffect } from 'react';

interface AppSwitcherProps {
  currentApp?: 'operator' | 'provider';
}

const AppSwitcher: React.FC<AppSwitcherProps> = ({ currentApp = 'operator' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitch = (app: 'operator' | 'provider') => {
    if (app === currentApp) {
      setIsOpen(false);
      return;
    }

    // Use the current origin and construct the URL dynamically
    const origin = window.location.origin;
    const url = app === 'operator'
      ? `${origin}/operator:hypergrid:grid-beta.hypr/`
      : `${origin}/provider:hypergrid:grid-beta.hypr/`;

    window.location.href = url;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm font-medium text-gray-900 cursor-pointer transition-all hover:bg-gray-200 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-25"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className={`flex items-center justify-center transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5L8 10L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>
          {currentApp === 'operator' ? 'Operator' : 'Provider'}
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 min-w-70 bg-white border border-gray-300 rounded-md shadow-lg z-50 p-2">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-300 mb-2">Switch Application</div>
          <button
            className={`flex items-center gap-3 w-full px-3 py-3 bg-none border-none rounded text-left cursor-pointer transition-colors ${currentApp === 'operator'
              ? 'bg-blue-50 pointer-events-none'
              : 'hover:bg-gray-50'
              }`}
            onClick={() => handleSwitch('operator')}
          >
            <span className="text-2xl flex-shrink-0">🎯</span>
            <div className="flex-grow">
              <div className="font-medium text-gray-900 mb-1">Operator</div>
              <div className="text-sm text-gray-500 leading-tight">Manage your hypergrid operations</div>
            </div>
          </button>
          <button
            className={`flex items-center gap-3 w-full px-3 py-3 bg-none border-none rounded text-left cursor-pointer transition-colors ${currentApp === 'provider'
              ? 'bg-blue-50 pointer-events-none'
              : 'hover:bg-gray-50'
              }`}
            onClick={() => handleSwitch('provider')}
          >
            <span className="text-2xl flex-shrink-0">🔌</span>
            <div className="flex-grow">
              <div className="font-medium text-gray-900 mb-1">Provider</div>
              <div className="text-sm text-gray-500 leading-tight">Configure hypergrid providers</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export default AppSwitcher; 