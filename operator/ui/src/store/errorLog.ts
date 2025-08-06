import { toast } from 'react-toastify';
import { create } from 'zustand';
import { truncate } from '../utils/truncate';

export interface ErrorLogEntry {
    id: string;
    message: string;
    timestamp: Date;
    isRead: boolean;
}

interface ErrorLogState {
    errors: ErrorLogEntry[];
    unreadCount: number;
    addError: (message: string) => void;
    markAllAsRead: () => void;
    clearErrors: () => void;
    showToast: (type: 'success' | 'error', message: string, duration?: number) => void;
}

export const useErrorLogStore = create<ErrorLogState>((set, get) => ({
    errors: [],
    unreadCount: 0,

    addError: (message: string) => {
        const newError: ErrorLogEntry = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            message,
            timestamp: new Date(),
            isRead: false,
        };

        set((state) => ({
            errors: [newError, ...state.errors],
            unreadCount: state.unreadCount + 1,
        }));
    },

    markAllAsRead: () => {
        set((state) => ({
            errors: state.errors.map(error => ({ ...error, isRead: true })),
            unreadCount: 0,
        }));
    },

    clearErrors: () => {
        set({
            errors: [],
            unreadCount: 0,
        });
    },

    showToast: (type: 'success' | 'error', message: string, duration = 3000) => {
        const { addError } = get();
        // Log errors to the error store
        if (type === 'error') {
            addError(message);
        }

        toast(truncate(message, 280, 0), {
            type,
            position: "top-right",
            autoClose: duration,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
        });
    },
}));