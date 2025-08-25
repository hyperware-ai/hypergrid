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
            className="fixed inset-0 bg-black/5 bg-white/5 backdrop-blur-sm flex place-items-center place-content-center z-50"
            onClick={preventAccidentalClose ? undefined : onClose}
        >
            <div
                className="bg-gray dark:bg-dark-gray p-6 rounded-lg md:max-w-screen lg:mx-16  lg:max-w-[80vw] max-h-[90vh] overflow-y-auto relative shadow-xl dark:shadow-white/10 flex flex-col gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className="flex items-center gap-2"
                >
                    <span className="font-bold text-xl">{title}</span>
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