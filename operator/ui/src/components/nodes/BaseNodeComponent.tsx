import React from 'react';
import { Handle, Position } from 'reactflow';
import { NODE_WIDTH } from '../BackendDrivenHypergridVisualizer';

interface BaseNodeProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    onClick?: (_: any) => void;
    title?: string;
    variant?: 'default' | 'action' | 'accent';
    showHandles?: {
        target?: boolean;
        source?: boolean;
    };
}

const BaseNodeComponent: React.FC<BaseNodeProps> = ({
    children,
    className = '',
    style = {},
    onClick,
    title,
    variant = 'default',
    showHandles = { target: true, source: false }
}) => {
    const getVariantClasses = () => {
        switch (variant) {
            case 'action':
                return 'bg-dark-gray hover:bg-cyan hover:text-black transition-all duration-300 text-white border-2 border-transparent hover:border-cyan';
            case 'accent':
                return 'bg-gray border border-cyan text-dark-gray';
            default:
                return 'bg-gray border border-black text-dark-gray';
        }
    };

    const baseClasses = `
        px-6 py-4 rounded-lg box-border font-sans flex flex-col gap-2 text-left
        ${onClick ? 'cursor-pointer' : ''}
        ${getVariantClasses()}
        ${className}
    `.trim().replace(/\s+/g, ' ');

    return (
        <div
            className={baseClasses}
            style={{
                maxWidth: NODE_WIDTH,
                ...style
            }}
            onClick={onClick}
            title={title}
        >
            {showHandles.target && (
                <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
            )}

            {children}

            {showHandles.source && (
                <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
            )}
        </div>
    );
};

export default BaseNodeComponent;