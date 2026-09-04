import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { adminAPI } from '../apiClient';
import { getColorForInitials } from '../avatarColors';
import ConfirmModal from './ConfirmModal';
import UserDeletionWarning from './UserDeletionWarning';

interface DirectoryUser {
  id: number;
  email: string | null;
  is_deceased: boolean;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  former_first_name: string | null;
  former_last_name: string | null;
  now_photo_url: string | null;
  avatar_color: string | null;
  tags: string[] | null;
}

interface ClassInfo {
  id: number;
  year: number;
  school_id?: number;
  school_name?: string;
}

const getInitials = (firstName?: string | null, lastName?: string | null): string => {
  const first = (firstName || '').charAt(0).toUpperCase();
  const last = (lastName || '').charAt(0).toUpperCase();
  return (first + last) || '?';
};

const getDisplayName = (user: DirectoryUser): { first: string | null; last: string | null } => ({
  first: user.former_first_name || user.first_name,
  last: user.former_last_name || user.last_name,
});

const DirectoryPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const navigate = useNavigate();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editingUser, setEditingUser] = useState<DirectoryUser | null>(null);
  const [editForm, setEditForm] = useState({
    first_name: '', last_name: '', former_first_name: '', former_last_name: '', is_deceased: false,
  });
  const [savingUser, setSavingUser] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteWarningOpen, setDeleteWarningOpen] = useState(false);
  const canEditUsers = !!currentUser?.is_admin || !!currentUser?.is_class_admin;

  useEffect(() => {
    if (currentUser?.user_id) {
      fetchClassAndUsers();
    }
  }, [currentUser?.user_id]);

  const fetchClassAndUsers = async () => {
    if (!currentUser?.user_id) return;

    setLoading(true);
    try {
      const classResponse = await api.get(`/users/${currentUser.user_id}/class`);
      const userClass = classResponse.data.class;
      setClassInfo(userClass);

      const usersResponse = await api.get(`/classes/${userClass.id}/directory`, {
        params: { userId: currentUser.user_id }
      });
      setUsers(usersResponse.data.users || []);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching directory:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Failed to load directory.';
      setError(errorMsg);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const searchLower = search.toLowerCase();
  const filtered = users.filter(u =>
    (u.first_name?.toLowerCase() || '').includes(searchLower) ||
    (u.last_name?.toLowerCase() || '').includes(searchLower) ||
    (u.former_first_name?.toLowerCase() || '').includes(searchLower) ||
    (u.former_last_name?.toLowerCase() || '').includes(searchLower) ||
    (u.email?.toLowerCase() || '').includes(searchLower) ||
    (u.tags || []).some(tag => tag.toLowerCase().includes(searchLower))
  );
  const handleSaveUser = async () => {
    if (!editingUser) return;
    setSavingUser(true);
    setEditError(null);
    try {
      await adminAPI.updateUserProfile(editingUser.id, {
        is_deceased: editForm.is_deceased,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        former_first_name: editForm.former_first_name || undefined,
        former_last_name: editForm.former_last_name || undefined,
      });
      setUsers(prev => prev.map(u => u.id === editingUser.id ? {
        ...u,
        is_deceased: editForm.is_deceased,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        former_first_name: editForm.former_first_name || null,
        former_last_name: editForm.former_last_name || null,
      } : u));
      setEditingUser(null);
    } catch (err: any) {
      setEditError(err.response?.data?.error || 'Failed to update user.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleConfirmDelete = () => {
    setDeleteModalOpen(false);
    setDeleteWarningOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!editingUser) return;
    try {
      await api.delete(`/admin/users/${editingUser.id}`);
      setUsers(prev => prev.filter(u => u.id !== editingUser.id));
      setDeleteWarningOpen(false);
      setEditingUser(null);
    } catch (err: any) {
      setDeleteWarningOpen(false);
      setEditError(err.response?.data?.error || 'Failed to delete user.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-8">
        <div className="text-center text-[#94A3B8] text-sm">Loading directory...</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
        <div>
          {classInfo && (
            <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-1">
              {classInfo.school_name} · Class of {classInfo.year}
            </p>
          )}
          <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight">
            Alumni Directory
          </h1>
          <p className="text-sm text-[#64748B] mt-1">
            {users.length} classmates · {users.filter(u => u.email).length} have claimed their profile
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search classmates or tags..."
          className="border border-[#E2E8F0] rounded px-4 py-2.5 text-sm w-64 focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors"
        />
      </div>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-5">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E2E8F0] p-10 text-center text-[#94A3B8] text-sm">
          {search ? `No classmates match "${search}"` : 'No classmates found yet.'}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))' }}>
          {filtered.map((user) => {
            const displayName = getDisplayName(user);
            const deceased = user.is_deceased;
            return (
              <button
                key={user.id}
                onClick={() => navigate(`/user/${user.id}`)}
                className={`relative rounded-lg border p-2 text-center hover:shadow-sm transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-2 min-h-[140px] ${
                  deceased
                    ? 'bg-[#F8FAFC] border-[#E2E8F0] hover:border-[#94A3B8] opacity-75'
                    : 'bg-white border-[#E2E8F0] hover:border-[#E8A93E]'
                }`}
              >
                {canEditUsers && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingUser(user);
                      setEditForm({
                        first_name: user.first_name || '',
                        last_name: user.last_name || '',
                        former_first_name: user.former_first_name || '',
                        former_last_name: user.former_last_name || '',
                        is_deceased: user.is_deceased,
                      });
                      setEditError(null);
                      setDeleteModalOpen(false);
                      setDeleteWarningOpen(false);
                    }}
                    title="Edit name / deceased status"
                    className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-white border border-[#E2E8F0] text-[#94A3B8] text-xs hover:text-[#0E2240] hover:border-[#E8A93E] cursor-pointer"
                  >
                    ✎
                  </button>
                )}
                {user.now_photo_url ? (
                  <img
                    src={user.now_photo_url}
                    alt={`${displayName.first} ${displayName.last}`}
                    className={`w-24 h-24 rounded-full object-cover ${deceased ? 'grayscale' : ''}`}
                  />
                ) : (
                  <div
                    className="flex items-center justify-center rounded-full font-bold flex-shrink-0"
                    style={{
                      width: 96,
                      height: 96,
                      fontSize: 30,
                      background: deceased ? '#CBD5E1' : (user.avatar_color || getColorForInitials(getInitials(displayName.first, displayName.last))),
                      color: deceased ? '#64748B' : '#FFFFFF',
                    }}
                  >
                    {getInitials(displayName.first, displayName.last)}
                  </div>
                )}
                <div className="w-full">
                  {displayName.first && displayName.last && (
                    <div className={`text-xs ${deceased ? 'text-[#94A3B8]' : 'text-[#64748B]'}`}>{displayName.first}</div>
                  )}
                  <div className={`font-display text-sm font-bold uppercase tracking-wide leading-tight ${deceased ? 'text-[#64748B]' : 'text-[#0E2240]'} ${displayName.first && displayName.last ? 'mt-0.5' : ''}`}>
                    {displayName.last || displayName.first || 'Alumni'}
                  </div>
                  {deceased && (
                    <div className="text-[10px] mt-0.5 text-[#94A3B8]">Deceased</div>
                  )}
                  {user.nickname && (
                    <div className={`text-[10px] mt-0.5 ${deceased ? 'text-[#CBD5E1]' : 'text-[#94A3B8]'}`}>"{user.nickname}"</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editingUser && (
        <>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingUser(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-[#0E2240]">
                Edit {getDisplayName(editingUser).first} {getDisplayName(editingUser).last}
              </h2>
              <button onClick={() => setEditingUser(null)} className="text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer text-lg leading-none">✕</button>
            </div>
            {editError && (
              <div className="bg-[#FFF8F8] text-[#C62828] border border-[#FFCDD2] rounded px-4 py-3 text-sm mb-4">{editError}</div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-1.5">Original first name</label>
                <input type="text" value={editForm.former_first_name}
                  onChange={e => setEditForm(f => ({ ...f, former_first_name: e.target.value }))}
                  placeholder="As it appears in the yearbook" disabled={savingUser}
                  className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors placeholder:text-[#CBD5E1]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-1.5">Original last name</label>
                <input type="text" value={editForm.former_last_name}
                  onChange={e => setEditForm(f => ({ ...f, former_last_name: e.target.value }))}
                  placeholder="Maiden or birth name" disabled={savingUser}
                  className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors placeholder:text-[#CBD5E1]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-1.5">Current first name <span className="text-[#f44336]">*</span></label>
                <input type="text" value={editForm.first_name} required
                  onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="Current legal name" disabled={savingUser}
                  className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors placeholder:text-[#CBD5E1]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-1.5">Current last name <span className="text-[#f44336]">*</span></label>
                <input type="text" value={editForm.last_name} required
                  onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Current last name" disabled={savingUser}
                  className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors placeholder:text-[#CBD5E1]" />
              </div>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none mb-5">
              <input type="checkbox" checked={editForm.is_deceased}
                onChange={e => setEditForm(f => ({ ...f, is_deceased: e.target.checked }))}
                disabled={savingUser} className="w-4 h-4 rounded border-[#E2E8F0] accent-[#0E2240] cursor-pointer" />
              <span className="text-sm text-[#64748B]">Mark as deceased</span>
            </label>
            <div className="flex items-center justify-between gap-3">
              {editingUser.id !== currentUser?.user_id ? (
                <button type="button" onClick={() => setDeleteModalOpen(true)} disabled={savingUser}
                  className="px-5 py-2.5 rounded text-sm font-semibold border-none bg-[#f44336] text-white hover:opacity-90 cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                  Delete user
                </button>
              ) : <span />}
              <div className="flex gap-3">
                <button onClick={handleSaveUser} disabled={savingUser || !editForm.first_name || !editForm.last_name}
                  className={`px-5 py-2.5 rounded text-sm font-semibold border-none transition-opacity ${savingUser || !editForm.first_name || !editForm.last_name ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                  {savingUser ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditingUser(null)}
                  className="px-5 py-2.5 rounded text-sm font-semibold border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] cursor-pointer transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>

        <ConfirmModal
          isOpen={deleteModalOpen}
          title="Delete User"
          message={`Are you sure you want to delete ${getDisplayName(editingUser).first || ''} ${getDisplayName(editingUser).last || ''}?`}
          details={['All user profiles and data', 'All comments written by and about this user', 'All S3 photographs']}
          confirmText="Delete" cancelText="Cancel" isDangerous
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteModalOpen(false)}
        />
        <UserDeletionWarning
          isOpen={deleteWarningOpen} userCount={1}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteWarningOpen(false)}
        />
        </>
      )}
    </div>
  );
};

export default DirectoryPage;
