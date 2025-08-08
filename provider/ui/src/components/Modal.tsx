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
            className="fixed inset-0 bg-black/5 backdrop-blur-xs flex place-items-center place-content-center z-50"
            onClick={preventAccidentalClose ? undefined : onClose}
        >
            <div
                className="ml-100 max-w-screen-xl grow self-stretch my-8 mr-8 bg-white p-6 rounded-lg overflow-y-auto relative shadow-xl flex flex-col gap-2"
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