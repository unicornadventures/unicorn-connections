import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string[];
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  showCheckbox?: boolean;
  checkboxLabel?: string;
  onConfirm: (cascadeUsers?: boolean) => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  details,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
  showCheckbox = false,
  checkboxLabel = 'Also delete related users',
  onConfirm,
  onCancel,
}) => {
  const [cascadeUsers, setCascadeUsers] = React.useState(false);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg p-8 max-w-[450px] w-full mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-[#0E2240] text-center mb-4">{title}</h2>
        <p className="text-sm text-[#64748B] leading-relaxed mb-4">{message}</p>

        {details && details.length > 0 && (
          <div className="mb-5 bg-[#F6F8FC] border border-[#E2E8F0] rounded p-4">
            <p className="text-xs font-bold text-[#0E2240] mb-2 uppercase tracking-wide">This will delete:</p>
            <ul className="list-disc list-inside space-y-1">
              {details.map((detail, index) => (
                <li key={index} className="text-sm text-[#64748B]">{detail}</li>
              ))}
            </ul>
          </div>
        )}

        {showCheckbox && (
          <div className="mb-5 flex items-center gap-3">
            <input
              type="checkbox"
              id="cascade-users-checkbox"
              checked={cascadeUsers}
              onChange={e => setCascadeUsers(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="cascade-users-checkbox" className="text-sm text-[#0E2240] cursor-pointer">
              {checkboxLabel}
            </label>
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 bg-[#E2E8F0] text-[#0E2240] rounded text-sm font-semibold hover:opacity-80 cursor-pointer transition-opacity border-none"
          >
            {cancelText}
          </button>
          <button
            onClick={() => onConfirm(cascadeUsers)}
            className={`px-5 py-2.5 rounded text-sm font-semibold hover:opacity-90 cursor-pointer transition-opacity border-none ${
              isDangerous ? 'bg-[#f44336] text-white' : 'bg-[#0E2240] text-white'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
