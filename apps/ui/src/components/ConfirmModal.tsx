interface ConfirmModalProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-dark border border-gray-600 rounded-lg p-6 max-w-sm mx-4">
        <p className="text-light mb-6">{message}</p>
        <div className="flex gap-4 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-500 text-gray-300 rounded hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 bg-accent text-light rounded hover:bg-red-700 transition-colors"
          >
            Restart
          </button>
        </div>
      </div>
    </div>
  );
}
