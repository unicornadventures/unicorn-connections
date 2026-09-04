import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { adminSchoolAPI } from '../apiClient';
import ConfirmModal from './ConfirmModal';
import UserDeletionWarning from './UserDeletionWarning';

const inputClass = 'w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors';
const labelClass = 'block text-sm font-semibold text-[#0E2240] mb-1.5';

// IANA timezone names, e.g. "America/Chicago" — used so event/comment
// timestamps can be rendered in the school's local time instead of UTC.
const TIMEZONES: string[] = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : [];

const SchoolManager: React.FC = () => {
  const { currentUser } = useAppContext();
  const [schools, setSchools] = useState<any[]>([]);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolLocation, setNewSchoolLocation] = useState('');
  const [newSchoolTimezone, setNewSchoolTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: number | null }>({ isOpen: false, id: null });
  const [userDeletionWarning, setUserDeletionWarning] = useState<{ isOpen: boolean; schoolId: number | null; userCount: number }>({ isOpen: false, schoolId: null, userCount: 0 });
  const [pendingCascadeDelete, setPendingCascadeDelete] = useState(false);

  useEffect(() => { fetchSchools(); }, []);

  const fetchSchools = async () => {
    setLoading(true);
    try {
      const response = await adminSchoolAPI.getSchools();
      setSchools(response.data.schools);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch schools.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await adminSchoolAPI.updateSchool(editingId, newSchoolName, newSchoolLocation, newSchoolTimezone);
      } else {
        await adminSchoolAPI.createSchool(newSchoolName, newSchoolLocation, newSchoolTimezone);
      }
      setEditingId(null);
      setNewSchoolName('');
      setNewSchoolLocation('');
      setNewSchoolTimezone('');
      fetchSchools();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save school.');
    }
  };

  const handleEdit = (school: any) => {
    setEditingId(school.id);
    setNewSchoolName(school.name);
    setNewSchoolLocation(school.location || '');
    setNewSchoolTimezone(school.timezone || '');
  };

  const handleDelete = (id: number) => setDeleteModal({ isOpen: true, id });

  const handleConfirmDelete = async () => {
    if (deleteModal.id === null) return;
    try {
      await adminSchoolAPI.deleteSchool(deleteModal.id);
      setSchools(prev => prev.filter(s => s.id !== deleteModal.id));
      setDeleteModal({ isOpen: false, id: null });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete school.');
      setDeleteModal({ isOpen: false, id: null });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setNewSchoolName('');
    setNewSchoolLocation('');
    setNewSchoolTimezone('');
  };

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-8">
        <div className="text-center text-[#94A3B8] text-sm">Loading schools...</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight mb-6">
        School Management
      </h1>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Add/Edit form */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
        <h2 className="text-base font-semibold text-[#0E2240] mb-5">
          {editingId ? 'Edit School' : 'Add New School'}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className={labelClass}>School name</label>
              <input
                type="text"
                placeholder="Westbrook High School"
                value={newSchoolName}
                onChange={e => setNewSchoolName(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Location</label>
              <input
                type="text"
                placeholder="Springfield, IL"
                value={newSchoolLocation}
                onChange={e => setNewSchoolLocation(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Timezone</label>
              <select
                value={newSchoolTimezone}
                onChange={e => setNewSchoolTimezone(e.target.value)}
                className={inputClass}
              >
                <option value="">No timezone set (defaults to UTC)</option>
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              className="px-5 py-2.5 bg-[#0E2240] text-white rounded text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer border-none"
            >
              {editingId ? 'Update school' : 'Add school'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={handleCancel}
                className="px-5 py-2.5 bg-[#E2E8F0] text-[#0E2240] rounded text-sm font-semibold hover:opacity-80 transition-opacity cursor-pointer border-none"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Schools list */}
      <div>
        <p className="text-xs font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-3">
          Registered Schools ({schools.length})
        </p>
        <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
          {schools.length === 0 ? (
            <div className="py-10 text-center text-sm text-[#94A3B8]">No schools yet.</div>
          ) : (
            <ul>
              {schools.map((school, idx) => (
                <li
                  key={school.id}
                  className={`flex items-center justify-between px-5 py-4 ${idx < schools.length - 1 ? 'border-b border-[#E2E8F0]' : ''}`}
                >
                  <div>
                    <div className="text-sm font-semibold text-[#0E2240]">{school.name}</div>
                    {(school.location || school.timezone) && (
                      <div className="text-xs text-[#64748B] mt-0.5">
                        {[school.location, school.timezone].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(school)}
                      className="px-3 py-1.5 bg-[#E2E8F0] text-[#0E2240] rounded text-xs font-semibold hover:opacity-80 cursor-pointer transition-opacity border-none"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(school.id)}
                      className="px-3 py-1.5 bg-[#f44336] text-white rounded text-xs font-semibold hover:opacity-90 cursor-pointer transition-opacity border-none"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title={`Delete ${schools.find(s => s.id === deleteModal.id)?.name || 'School'}`}
        message="This is permanent and cannot be undone."
        details={[
          'All class years for this school',
          'All members assigned to those classes',
          'All member profiles and account information',
          'All comments written by or about those members',
          'All photographs uploaded by those members',
          'All events associated with those classes',
        ]}
        confirmText="Delete School"
        cancelText="Cancel"
        isDangerous={true}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, id: null })}
      />

      <UserDeletionWarning
        isOpen={userDeletionWarning.isOpen}
        userCount={userDeletionWarning.userCount || 1}
        onConfirm={() => { setUserDeletionWarning({ isOpen: false, schoolId: null, userCount: 0 }); setPendingCascadeDelete(false); }}
        onCancel={() => { setUserDeletionWarning({ isOpen: false, schoolId: null, userCount: 0 }); setPendingCascadeDelete(false); }}
      />
    </div>
  );
};

export default SchoolManager;
