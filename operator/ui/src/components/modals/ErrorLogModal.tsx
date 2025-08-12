import React from 'react';
import { useErrorLogStore, type ErrorLogEntry } from '../../store/errorLog';
import Modal from './Modal';
import classNames from 'classnames';

interface ErrorLogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ErrorLogModal: React.FC<ErrorLogModalProps> = ({ isOpen, onClose }) => {
    const { errors, clearErrors } = useErrorLogStore();

    if (!isOpen) {
        return null;
    }

    const formatTimestamp = (timestamp: Date) => {
        return timestamp.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    return (
        <Modal
            title="Error Notifications"
            onClose={onClose}
            titleChildren={<button
                onClick={clearErrors}
                className={classNames("px-3 py-1 text-sm text-red-500 hover:text-white hover:bg-red-600", {
                    hidden: errors.length === 0
                })}
            >
                Clear All
            </button>
            }>

            <div className="flex-grow overflow-y-auto pr-1">
                {errors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                        <svg
                            width="64"
                            height="64"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mb-4 opacity-50"
                        >
                            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
                            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
                        </svg>
                        <p className="text-lg">No error notifications</p>
                        <p className="text-sm">Error messages will appear here when they occur</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {errors.map((error: ErrorLogEntry) => (
                            <div
                                key={error.id}
                                className="p-4 bg-red-50 border border-red-200 rounded-lg"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-red-600 flex-shrink-0 mt-0.5"
                                        >
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="15" y1="9" x2="9" y2="15"></line>
                                            <line x1="9" y1="9" x2="15" y2="15"></line>
                                        </svg>
                                        <span className="text-sm text-red-600 font-medium">
                                            Error
                                        </span>
                                    </div>
                                    <span className="text-xs text-gray-500 flex-shrink-0">
                                        {formatTimestamp(error.timestamp)}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
                                    {error.message}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default ErrorLogModal;