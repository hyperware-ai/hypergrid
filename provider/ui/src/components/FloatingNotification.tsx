import React, { useState, useEffect } from 'react';

export type NotificationType = 'error' | 'warning';

interface FloatingNotificationProps {
  type: NotificationType;
  title: string;
  subtitle: string;
  loading?: boolean;
  onRetry: () => void;
  className?: string;
  show?: boolean;
  retryTooltip?: string;
}

const FloatingNotification: React.FC<FloatingNotificationProps> = ({
  type,
  title,
  subtitle,
  loading = false,
  onRetry,
  className = '',
  show = true,
  retryTooltip = 'Click to retry'
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (!show) {
    return null;
  }

  const getIcon = () => {
    if (loading) return '🔄';
    return type === 'error' ? '🔴' : '⚠️';
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isMobile && !isExpanded) {
      e.preventDefault();
      setIsExpanded(true);
    } else {
      onRetry();
      if (isMobile && isExpanded) {
        setIsExpanded(false);
      }
    }
  };

  const handleMobileClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(false);
  };

  // Mobile minimized view
  if (isMobile && !isExpanded) {
    return (
      <div className={`floating-notification ${className} mobile-minimized`}>
        <button 
          className={`notification-mini-button ${type}`}
          onClick={handleClick}
          disabled={loading}
          title={`${type === 'error' ? 'Error' : 'Warning'}: Click to view details`}
        >
          <span className="notification-mini-icon">
            ❓
          </span>
        </button>
      </div>
    );
  }

  // Full notification (desktop or mobile expanded)
  return (
    <div className={`floating-notification ${className} ${isMobile ? 'mobile-expanded' : ''}`}>
      <div className="notification-content">
        {isMobile && isExpanded && (
          <button 
            className="mobile-close-button"
            onClick={handleMobileClose}
            title="Minimize"
          >
            ✕
          </button>
        )}
        <button 
          className={`notification-button ${type}`}
          onClick={handleClick}
          disabled={loading}
          title={retryTooltip}
        >
          <span className="notification-icon">
            {getIcon()}
          </span>
          <div className="notification-text">
            <div className="notification-title">
              {title}
            </div>
            <div className="notification-subtitle">
              {subtitle}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
};

export default FloatingNotification;