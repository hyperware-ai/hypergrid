import React, { useEffect } from 'react';

interface SelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
}

const SelectionModal: React.FC<SelectionModalProps> = ({ isOpen, onClose, title, children, maxWidth }) => {
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const modalContentStyle = maxWidth ? { maxWidth: maxWidth } : {};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {title && <h2 className="modal-title">{title}</h2>}
          <button className="modal-close-button" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
};

export default SelectionModal;
