//import React from 'react';
//import AccountManagerForModal from '../components/AccountManagerForModal'; // UPDATED IMPORT
//
//interface AccountManagerDisplayModalProps {
//    isOpen: boolean;
//    onClose: () => void;
//    // We might not need other props like operatorTbaAddress or nodeName directly for AccountManager
//    // as it manages its own state and API calls.
//    // However, onClose will trigger a refresh in HpnVisualManager.
//}
//
//const AccountManagerDisplayModal: React.FC<AccountManagerDisplayModalProps> = ({
//    isOpen,
//    onClose,
//}) => {
//    if (!isOpen) {
//        return null;
//    }
//
//    // Basic modal styling - can be adjusted
//    const modalStyle: React.CSSProperties = {
//        position: 'fixed',
//        top: 0,
//        left: 0,
//        width: '100%',
//        height: '100%',
//        backgroundColor: 'rgba(0, 0, 0, 0.7)',
//        display: 'flex',
//        alignItems: 'center',
//        justifyContent: 'center',
//        zIndex: 1000, // Ensure it's on top
//        overflowY: 'auto', // Allow scrolling if content is too tall
//    };
//
//    const contentStyle: React.CSSProperties = {
//        backgroundColor: '#282c34', // Dark background, similar to other components
//        color: 'white',
//        padding: '20px',
//        borderRadius: '8px',
//        width: '90%', // Responsive width
//        maxWidth: '800px', // Max width for larger screens
//        maxHeight: '90vh', // Max height
//        overflowY: 'auto', // Scrollable content area
//        position: 'relative', // For positioning the close button
//        border: '1px solid #444',
//    };
//
//    const closeButtonStyle: React.CSSProperties = {
//        position: 'absolute',
//        top: '10px',
//        right: '10px',
//        background: 'transparent',
//        border: 'none',
//        color: 'white',
//        fontSize: '1.5rem',
//        cursor: 'pointer',
//    };
//
//    return (
//        <div style={modalStyle} onClick={onClose}> {/* Optional: Close on overlay click */}
//            <div style={contentStyle} onClick={(e) => e.stopPropagation()}> {/* Prevent closing when clicking inside content */}
//                <button style={closeButtonStyle} onClick={onClose}>
//                    &times;
//                </button>
//                <AccountManagerForModal />
//            </div>
//        </div>
//    );
//};
//
//export default AccountManagerDisplayModal; 