import React from 'react';
import NodeElement from './NodeElement';

interface TreeContainerProps {
    node: any;
}

const TreeContainer: React.FC<TreeContainerProps> = ({ node }) => {
    return (
        <div className="tree-container">
            {node.child_names.map((name: string) => (
                <NodeElement key={name} name={name} />
            ))}
        </div>
    );
};

export default TreeContainer;