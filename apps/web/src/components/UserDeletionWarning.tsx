import React from 'react';

interface UserDeletionWarningProps {
  isOpen: boolean;
  userCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const UserDeletionWarning: React.FC<UserDeletionWarningProps> = ({
  isOpen,
  userCount,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1001]"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg p-8 max-w-[450px] w-full mx-4 shadow-xl border-l-4 border-[#f44336]"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-[#0E2240] text-center mb-4">Warning</h2>
        <p className="text-sm text-[#64748B] leading-relaxed mb-4">
          You are about to delete <strong className="text-[#0E2240]">{userCount} user{userCount !== 1 ? 's' : ''}</strong>. This will permanently remove:
        </p>

        <div className="mb-5 bg-[#FFF8EE] border border-[#E8A93E]/40 rounded p-4">
          <ul className="list-disc list-inside space-y-1.5">
            <li className="text-sm text-[#64748B]">All user profiles and account information</li>
            <li className="text-sm text-[#64748B]">All comments written by and received by these users</li>
            <li className="text-sm text-[#64748B]">All photographs stored in S3</li>
            <li className="text-sm text-[#64748B]">All class assignments</li>
            <li className="text-sm font-bold text-[#C62828] mt-1">This action CANNOT be undone</li>
          </ul>
        </div>

        <p className="text-sm text-[#C62828] font-semibold mb-5">
          Confirm permanent deletion of {userCount} user{userCount !== 1 ? 's' : ''}.
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 bg-[#E2E8F0] text-[#0E2240] rounded text-sm font-semibold hover:opacity-80 cursor-pointer transition-opacity border-none"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 bg-[#f44336] text-white rounded text-sm font-semibold hover:opacity-90 cursor-pointer transition-opacity border-none"
          >
            Yes, delete users
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserDeletionWarning;
