import classNames from 'classnames';
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
            className={classNames(`copy-to-clipboard cursor-pointer relative`, className)}
            style={{ ...style }}
            onClick={handleCopy}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            title={``} // Remove default browser title tooltip
        >
            {children}
            {showCheckmark && (
                <span
                    className="copy-checkmark absolute -right-6 top-1/2 -translate-y-1/2 text-green-400"
                >
                    ✓
                </span>
            )}
            {isHovering && (
                <span
                    className="hover-tooltip absolute bottom-[125%] left-1/2 -translate-x-1/2 bg-dark-gray text-white px-2 py-1 rounded whitespace-nowrap z-10"
                >
                    {textToCopy}
                </span>
            )}
        </span>
    );
};

export default CopyToClipboardText;