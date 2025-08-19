import { BsX } from "react-icons/bs";

export default function Modal({
    children,
    onClose,
    title,
    titleChildren,
    preventAccidentalClose = false
}: {
    children: React.ReactNode,
    onClose: () => void,
    title: string,
    titleChildren?: React.ReactNode,
    preventAccidentalClose?: boolean
}) {
    return (
        <div
            className="fixed inset-0 bg-black/20 dark:bg-black/70 backdrop-blur-sm flex place-items-center place-content-center z-50"
            onClick={preventAccidentalClose ? undefined : onClose}
        >
            <div
                className="ml-100 max-w-screen-xl grow self-stretch my-6 mr-6 bg-white dark:bg-gradient-to-br dark:from-gray-900 dark:to-gray-800 p-4 rounded-xl overflow-y-auto relative shadow-2xl dark:shadow-black/50 flex flex-col gap-1 border border-gray-200 dark:border-gray-700"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="flex items-center gap-2 mb-0.5 pb-0.5 border-b border-gray-200 dark:border-gray-700"
                >
                    <span className="font-bold text-xl text-cyan">{title}</span>
                    {titleChildren}
                    <button
                        onClick={onClose}
                        className="ml-auto"
                    >
                        <BsX className="text-5xl" />
                    </button>
                </div>

                {children}
            </div>
        </div>
    );
}