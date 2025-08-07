import React, { useEffect } from 'react';
import Modal from './Modal';

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

  return (
    <Modal
      title={title || "Configuration"}
      onClose={onClose}
      preventAccidentalClose={true}
    >
      <div style={maxWidth ? { maxWidth } : {}}>
        {children}
      </div>
    </Modal>
  );
};

export default SelectionModal;
