import React, { useState, useCallback } from 'react';

interface CopyToClipboardTextProps {
    textToCopy: string;
    children: React.ReactNode; // The text to display
    style?: React.CSSProperties;
    className?: string;
}

const CopyToClipboardText: React.FC<CopyToClipboardTextProps> = ({ 
    textToCopy, 
    children, 
    style = {}, 
    className = '' 
}) => {
    const [showCheckmark, setShowCheckmark] = useState(false);
    const [isHovering, setIsHovering] = useState(false);

    const handleCopy = useCallback((event: React.MouseEvent) => {
        event.stopPropagation(); // Prevent click from bubbling up (e.g., to select row)
        navigator.clipboard.writeText(textToCopy).then(() => {
            setShowCheckmark(true);
            setTimeout(() => setShowCheckmark(false), 1500); // Hide checkmark after 1.5s
        }, (err) => {
            console.error('Failed to copy: ', err);
            // Optionally show an error state?
        });
    }, [textToCopy]);

    return (
        <span 
            className={`copy-to-clipboard ${className}`}
            style={{ ...style, cursor: 'pointer', position: 'relative' }} 
            onClick={handleCopy}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            title={``} // Remove default browser title tooltip
        >
            {children} 
            {showCheckmark && (
                <span 
                    className="copy-checkmark"
                    style={{
                        position: 'absolute', 
                        right: '-1.2em', // Position relative to the text span
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'green',
                        fontSize: '0.9em'
                    }}
                >
                    ✓
                </span>
            )}
            {/* Custom Hover Tooltip */} 
            {isHovering && (
                <span 
                    className="hover-tooltip"
                    style={{ 
                        position: 'absolute',
                        bottom: '125%', // Position above the text
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: '#333',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.85em',
                        whiteSpace: 'nowrap',
                        zIndex: 10 // Ensure it's above other elements
                    }}
                >
                    {textToCopy} 
                </span>
            )}
        </span>
    );
};

export default CopyToClipboardText; 