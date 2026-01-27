import { Toast } from '@/components/Toast';

const TOAST_DURATION = 3000;

interface ToastData {
  id: number;
  message: string;
}

interface ToastContainerProps {
  toasts: ToastData[];
  onRemove: (id: number) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="w-full md:w-auto fixed top-[162px] md:absolute md:bottom-2 md:top-auto left-1/2 -translate-x-1/2 flex flex-col-reverse gap-2 z-30 px-2 md:px-4">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          onRemove={onRemove}
          duration={TOAST_DURATION}
        />
      ))}
    </div>
  );
}
