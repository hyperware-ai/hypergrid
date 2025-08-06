import React, { useState } from 'react';
import { useErrorLogStore } from '../store/errorLog';
import ErrorLogModal from './modals/ErrorLogModal';

const NotificationBell: React.FC = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { unreadCount, markAllAsRead } = useErrorLogStore();

    const handleBellClick = () => {
        setIsModalOpen(true);
        if (unreadCount > 0) {
            markAllAsRead();
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
    };

    return (
        <>
            <button
                onClick={handleBellClick}
                className="relative p-2 rounded-xl self-stretch bg-white shadow-xl"
                title="View error notifications"
            >
                {/* Bell Icon */}
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-gray-600"
                >
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path>
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>
                </svg>

                {/* Counter Badge */}
                {unreadCount > 0 && (
                    <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-cyan-500 text-white text-xs font-bold rounded-full flex items-center justify-center border-2 border-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </div>
                )}
            </button>

            <ErrorLogModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
            />
        </>
    );
};

export default NotificationBell;