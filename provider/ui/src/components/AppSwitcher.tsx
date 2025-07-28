import React, { useState, useRef, useEffect } from 'react';

interface AppSwitcherProps {
  currentApp?: 'operator' | 'provider';
}

const AppSwitcher: React.FC<AppSwitcherProps> = ({ currentApp = 'provider' }) => {
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
      ? `${origin}/operator:hypergrid:ware.hypr/`
      : `${origin}/provider:hypergrid:ware.hypr/`;
    
    window.location.href = url;
  };

  return (
    <div className="app-switcher-container" ref={dropdownRef}>
      <button 
        className="app-switcher-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="app-switcher-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5L8 10L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="app-switcher-label">
          {currentApp === 'operator' ? 'Operator' : 'Provider'}
        </span>
      </button>

      {isOpen && (
        <div className="app-switcher-dropdown">
          <div className="app-switcher-header">Switch Application</div>
          <button
            className={`app-switcher-option ${currentApp === 'operator' ? 'active' : ''}`}
            onClick={() => handleSwitch('operator')}
          >
            <span className="app-switcher-option-icon">🎯</span>
            <div className="app-switcher-option-content">
              <div className="app-switcher-option-title">Operator</div>
              <div className="app-switcher-option-description">Manage your hypergrid operations</div>
            </div>
          </button>
          <button
            className={`app-switcher-option ${currentApp === 'provider' ? 'active' : ''}`}
            onClick={() => handleSwitch('provider')}
          >
            <span className="app-switcher-option-icon">🔌</span>
            <div className="app-switcher-option-content">
              <div className="app-switcher-option-title">Provider</div>
              <div className="app-switcher-option-description">Configure hypergrid providers</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export default AppSwitcher; 