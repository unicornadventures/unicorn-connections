import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { adminAPI, adminClassAPI } from '../apiClient';
import ConfirmModal from './ConfirmModal';
import UserDeletionWarning from './UserDeletionWarning';

interface User {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  former_first_name: string | null;
  former_last_name: string | null;
  is_deceased: boolean;
}

interface School { id: number; name: string; }
interface Class  { id: number; year: number; }

interface CsvRow {
  original_first_name: string;
  original_last_name: string;
  first_name: string;
  last_name: string;
  email: string;
  is_deceased: boolean;
  _valid: boolean;
  _error?: string;
}


const STORAGE_KEY = 'usersManagerState';
const inputClass = 'w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors placeholder:text-[#CBD5E1]';
const labelClass = 'block text-xs font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-1.5';

// ── CSV helpers ────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

const DECEASED_SUFFIX = ' (DECEASED)';
const HEADER_WORDS = ['last', 'last name', 'lastname', 'surname'];

function parseCSV(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  let dataLines = lines;
  const firstCell = parseCSVLine(lines[0])[0]?.toLowerCase().trim() ?? '';
  if (HEADER_WORDS.includes(firstCell)) dataLines = lines.slice(1);
  return dataLines.filter(l => l.trim()).map(line => {
    const vals = parseCSVLine(line);
    const last_name = (vals[0] || '').trim();
    let first_name = (vals[1] || '').trim();
    const maiden = (vals[2] || '').trim();
    let is_deceased = false;
    if (first_name.toUpperCase().endsWith(DECEASED_SUFFIX)) {
      is_deceased = true;
      first_name = first_name.slice(0, -DECEASED_SUFFIX.length).trim();
    }
    const original_last_name = maiden;
    const original_first_name = maiden ? first_name : '';
    const email = '';
    const missing = !first_name || !last_name;
    return {
      original_first_name, original_last_name, first_name, last_name, email, is_deceased,
      _valid: !missing,
      _error: missing ? 'Missing first or last name' : undefined,
    };
  });
}

function downloadTemplate() {
  const csv = `last,first,maiden\nSmith,John,\nJones,Mary (DECEASED),Smith\nDavis,Robert,\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'users-import-template.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────
const UsersManager: React.FC = () => {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingClassId = useRef<number | null>(null);

  // Filter state
  const [schools, setSchools] = useState<School[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [searchLastName, setSearchLastName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // List state
  const [users, setUsers] = useState<User[]>([]);

  // Set-password link state
  const [pwLink, setPwLink] = useState<{ userId: number; url: string } | null>(null);
  const [pwLinkLoading, setPwLinkLoading] = useState<number | null>(null);
  const [pwLinkCopied, setPwLinkCopied] = useState(false);

  const handlePasswordLink = async (userId: number) => {
    setPwLinkLoading(userId);
    setPwLinkCopied(false);
    try {
      const res = await adminAPI.createPasswordLink(userId);
      setPwLink({ userId, url: res.data.passwordSetupUrl });
    } catch {
      setError('Failed to generate password link.');
      setPwLink(null);
    } finally {
      setPwLinkLoading(null);
    }
  };
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Add-user form state
  const [addForm, setAddForm] = useState({
    original_first_name: '', original_last_name: '',
    first_name: '', last_name: '', email: '', is_deceased: false,
  });
  const [addLoading, setAddLoading] = useState(false);

  // CSV import state
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: any[] } | null>(null);

  // Delete modals
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; userId: number | null }>({ isOpen: false, userId: null });
  const [warningModal, setWarningModal] = useState<{ isOpen: boolean; userId: number | null }>({ isOpen: false, userId: null });

  // Move-class state
  const [moveUserId, setMoveUserId] = useState<number | null>(null);
  const [moveTargetClassId, setMoveTargetClassId] = useState<number | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);

  // Edit-user state (name fields + deceased status)
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    first_name: '', last_name: '', former_first_name: '', former_last_name: '', is_deceased: false,
  });
  const [editLoading, setEditLoading] = useState(false);

  // Session restore
  useEffect(() => {
    api.get('/schools').then(r => setSchools(r.data.schools || [])).catch(() => {});
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const s = JSON.parse(saved);
        setSelectedSchoolId(s.selectedSchoolId);
        pendingClassId.current = s.selectedClassId || null;
        setSearchLastName(s.searchLastName || '');
        setCurrentPage(s.currentPage || 1);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!selectedSchoolId) { setClasses([]); setSelectedClassId(null); return; }
    api.get(`/schools/${selectedSchoolId}/classes`)
      .then(r => {
        setClasses(r.data.classes || []);
        if (pendingClassId.current !== null) {
          setSelectedClassId(pendingClassId.current);
          pendingClassId.current = null;
        }
      })
      .catch(() => {});
  }, [selectedSchoolId]);

  useEffect(() => {
    if (selectedClassId) fetchUsers();
  }, [selectedClassId, currentPage, searchLastName]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedSchoolId, selectedClassId, searchLastName, currentPage }));
  }, [selectedSchoolId, selectedClassId, searchLastName, currentPage]);

  const fetchUsers = async () => {
    if (!selectedClassId) return;
    setLoading(true);
    try {
      const r = await api.get(`/admin/classes/${selectedClassId}/users`, {
        params: { page: currentPage, pageSize, lastName: searchLastName },
      });
      setUsers(r.data.users || []);
      setTotalUsers(r.data.total || 0);
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to fetch users.');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  // ── Add single user ──────────────────────────────────────────────
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchoolId || !selectedClassId) return;
    setAddLoading(true);
    setError(null);
    try {
      await adminClassAPI.createUser(selectedSchoolId, selectedClassId, {
        first_name: addForm.first_name,
        last_name: addForm.last_name,
        original_first_name: addForm.original_first_name || undefined,
        original_last_name: addForm.original_last_name || undefined,
        email: addForm.email || undefined,
        is_deceased: addForm.is_deceased,
      });
      setAddForm({ original_first_name: '', original_last_name: '', first_name: '', last_name: '', email: '', is_deceased: false });
      setShowAddModal(false);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to add user.');
    } finally {
      setAddLoading(false);
    }
  };

  // ── CSV import ───────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = ev => setCsvRows(parseCSV(ev.target?.result as string));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!selectedSchoolId || !selectedClassId) return;
    const valid = csvRows.filter(r => r._valid);
    if (!valid.length) return;
    setImporting(true);
    setError(null);
    try {
      const res = await adminClassAPI.importUsers(selectedSchoolId, selectedClassId, valid);
      setImportResult(res.data);
      setCsvRows([]);
      fetchUsers();
      if (!res.data.skipped?.length) {
        setTimeout(() => { setShowImportModal(false); setImportResult(null); }, 1500);
      }
    } catch (e: any) {
      setError(e.response?.data?.error || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────
  const handleConfirmDelete = () => {
    setDeleteModal({ isOpen: false, userId: null });
    setWarningModal({ isOpen: true, userId: deleteModal.userId });
  };

  const handleDeleteConfirmed = async () => {
    if (warningModal.userId === null) return;
    try {
      await api.delete(`/admin/users/${warningModal.userId}`);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to delete user.');
    } finally {
      setWarningModal({ isOpen: false, userId: null });
    }
  };

  const handleMoveClass = async () => {
    if (moveUserId === null || moveTargetClassId === null) return;
    setMoveLoading(true);
    setError(null);
    try {
      await adminAPI.moveUserClass(moveUserId, moveTargetClassId);
      setMoveUserId(null);
      setMoveTargetClassId(null);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to move user.');
    } finally {
      setMoveLoading(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!editUser) return;
    setEditLoading(true);
    setError(null);
    try {
      await adminAPI.updateUserProfile(editUser.id, {
        is_deceased: editForm.is_deceased,
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        former_first_name: editForm.former_first_name || undefined,
        former_last_name: editForm.former_last_name || undefined,
      });
      setEditUser(null);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to update user.');
    } finally {
      setEditLoading(false);
    }
  };

  const totalPages = Math.ceil(totalUsers / pageSize);
  const validRows = csvRows.filter(r => r._valid);
  const invalidRows = csvRows.filter(r => !r._valid);
  const selectedClass = classes.find(c => c.id === selectedClassId);
  const selectedSchool = schools.find(s => s.id === selectedSchoolId);

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">
        User Management
      </h1>
      <p className="text-sm text-[#64748B] mb-8">Browse, add, or import alumni by school and class year.</p>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
          {error}
          <button onClick={() => setError(null)} className="float-right text-[#C62828] bg-transparent border-none cursor-pointer font-bold">×</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
        <p className={labelClass}>Filter</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>School</label>
            <select
              value={selectedSchoolId || ''}
              onChange={e => { setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null); setSelectedClassId(null); }}
              className="w-full border border-[#E2E8F0] rounded px-3 py-2.5 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] bg-white"
            >
              <option value="">— Select school —</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {selectedSchoolId && (
            <div>
              <label className={labelClass}>Class year</label>
              <select
                value={selectedClassId || ''}
                onChange={e => { setSelectedClassId(e.target.value ? parseInt(e.target.value) : null); setCurrentPage(1); }}
                className="w-full border border-[#E2E8F0] rounded px-3 py-2.5 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] bg-white"
              >
                <option value="">— Select year —</option>
                {classes.map(c => <option key={c.id} value={c.id}>Class of {c.year}</option>)}
              </select>
            </div>
          )}
          {selectedClassId && (
            <div>
              <label className={labelClass}>Search last name</label>
              <input
                type="text"
                placeholder="Last name…"
                value={searchLastName}
                onChange={e => { setSearchLastName(e.target.value); setCurrentPage(1); }}
                className={inputClass}
              />
            </div>
          )}
        </div>
      </div>

      {selectedClassId && (
        <>
          {/* Action bar */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-[#94A3B8] tracking-[0.15em] uppercase">
              {selectedSchool?.name}
              <span className="block normal-case tracking-normal font-normal text-[#64748B] mt-0.5">
                Class of {selectedClass?.year} — {totalUsers} member{totalUsers !== 1 ? 's' : ''}{searchLastName && ` matching "${searchLastName}"`}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 rounded text-xs font-semibold border-none cursor-pointer transition-colors bg-[#E2E8F0] text-[#0E2240] hover:bg-[#CBD5E1]"
              >
                + Add user
              </button>
              <button
                onClick={() => { setImportResult(null); setCsvRows([]); setShowImportModal(true); }}
                className="px-4 py-2 rounded text-xs font-semibold border-none cursor-pointer transition-colors bg-[#E2E8F0] text-[#0E2240] hover:bg-[#CBD5E1]"
              >
                ↑ Import CSV
              </button>
            </div>
          </div>

          {/* User list */}
          {loading ? (
            <div className="text-center text-[#94A3B8] text-sm py-8">Loading…</div>
          ) : users.length === 0 ? (
            <div className="bg-white border border-[#E2E8F0] rounded-lg py-10 text-center text-sm text-[#94A3B8]">
              No users found.
            </div>
          ) : (
            <>
              <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden mb-5">
                {users.map((user, idx) => (
                  <div key={user.id} className={idx < users.length - 1 ? 'border-b border-[#E2E8F0]' : ''}>
                    <div className="flex items-center justify-between px-5 py-4">
                      <button onClick={() => navigate(`/admin/user/${user.id}`)}
                        className="text-left bg-transparent border-none cursor-pointer hover:opacity-80 transition-opacity">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#0E2240]">
                            {user.last_name}, {user.first_name}
                          </span>
                          {user.is_deceased && (
                            <span className="text-[10px] font-semibold text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded tracking-wide">DECEASED</span>
                          )}
                          {!user.email && !user.is_deceased && (
                            <span className="text-[10px] font-semibold text-[#94A3B8] bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded tracking-wide">NOT REGISTERED</span>
                          )}
                        </div>
                        <div className="text-xs text-[#94A3B8] mt-0.5">{user.email || 'No email on file'}</div>
                      </button>
                      <div className="flex gap-2">
                        {user.email && !user.is_deceased && (
                          <button onClick={() => handlePasswordLink(user.id)} disabled={pwLinkLoading === user.id}
                            className="px-3 py-1.5 bg-[#0E2240] text-white rounded text-xs font-semibold hover:opacity-90 cursor-pointer transition-opacity border-none">
                            {pwLinkLoading === user.id ? 'Generating…' : 'Password Link'}
                          </button>
                        )}
                        <button onClick={() => navigate(`/admin/user/${user.id}`)}
                          className="px-3 py-1.5 bg-[#E2E8F0] text-[#0E2240] rounded text-xs font-semibold hover:opacity-80 cursor-pointer transition-opacity border-none">
                          View
                        </button>
                        <button
                          onClick={() => {
                            setEditUser(user);
                            setEditForm({
                              first_name: user.first_name || '',
                              last_name: user.last_name || '',
                              former_first_name: user.former_first_name || '',
                              former_last_name: user.former_last_name || '',
                              is_deceased: user.is_deceased,
                            });
                          }}
                          className="px-3 py-1.5 bg-[#E2E8F0] text-[#0E2240] rounded text-xs font-semibold hover:opacity-80 cursor-pointer transition-opacity border-none">
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setMoveUserId(moveUserId === user.id ? null : user.id);
                            setMoveTargetClassId(null);
                          }}
                          className={`px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-opacity border-none ${moveUserId === user.id ? 'bg-[#0E2240] text-white' : 'bg-[#E8A93E] text-white hover:opacity-90'}`}>
                          Move
                        </button>
                        <button onClick={() => setDeleteModal({ isOpen: true, userId: user.id })}
                          className="px-3 py-1.5 bg-[#f44336] text-white rounded text-xs font-semibold hover:opacity-90 cursor-pointer transition-opacity border-none">
                          Delete
                        </button>
                      </div>
                    </div>
                    {pwLink?.userId === user.id && (
                      <div className="mx-5 mb-4 p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded">
                        <div className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-1.5">
                          Set-password link — valid 7 days
                        </div>
                        <div className="flex items-center gap-2">
                          <input readOnly value={pwLink.url} onFocus={e => e.target.select()}
                            className="flex-1 text-xs text-[#0E2240] bg-white border border-[#E2E8F0] rounded px-2 py-1.5 font-mono" />
                          <button onClick={() => { navigator.clipboard.writeText(pwLink.url); setPwLinkCopied(true); }}
                            className="px-3 py-1.5 bg-[#0E2240] text-white rounded text-xs font-semibold hover:opacity-90 cursor-pointer transition-opacity border-none">
                            {pwLinkCopied ? 'Copied!' : 'Copy'}
                          </button>
                          <button onClick={() => setPwLink(null)}
                            className="px-2 py-1.5 bg-transparent text-[#94A3B8] text-xs font-bold cursor-pointer border-none hover:opacity-70">
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                    {moveUserId === user.id && (
                      <div className="mx-5 mb-4 p-3 bg-[#FFF8E8] border border-[#E8A93E] rounded">
                        <div className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.1em] uppercase mb-2">
                          Move to class year
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={moveTargetClassId ?? ''}
                            onChange={e => setMoveTargetClassId(e.target.value ? parseInt(e.target.value) : null)}
                            className="border border-[#E2E8F0] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#E8A93E] bg-white"
                          >
                            <option value="">— Select year —</option>
                            {classes
                              .filter(c => c.id !== selectedClassId)
                              .map(c => <option key={c.id} value={c.id}>Class of {c.year}</option>)}
                          </select>
                          <button
                            onClick={handleMoveClass}
                            disabled={moveLoading || moveTargetClassId === null}
                            className={`px-3 py-1.5 rounded text-xs font-semibold border-none transition-opacity ${moveLoading || moveTargetClassId === null ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#E8A93E] text-white hover:opacity-90 cursor-pointer'}`}>
                            {moveLoading ? 'Moving…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => { setMoveUserId(null); setMoveTargetClassId(null); }}
                            className="px-2 py-1.5 bg-transparent text-[#94A3B8] text-xs font-bold cursor-pointer border-none hover:opacity-70">
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className={`px-4 py-2 rounded text-sm font-semibold border-none transition-opacity ${currentPage === 1 ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <button key={page} onClick={() => setCurrentPage(page)}
                      className={`w-9 h-9 rounded text-sm font-semibold border-none cursor-pointer transition-opacity ${page === currentPage ? 'bg-[#0E2240] text-white' : 'bg-[#E2E8F0] text-[#64748B] hover:opacity-80'}`}>
                      {page}
                    </button>
                  ))}
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className={`px-4 py-2 rounded text-sm font-semibold border-none transition-opacity ${currentPage === totalPages ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Add user modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-[#0E2240]">Add user to Class of {selectedClass?.year}</h2>
              <button onClick={() => setShowAddModal(false)} className="text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer text-lg leading-none">✕</button>
            </div>
            {error && (
              <div className="bg-[#FFF8F8] text-[#C62828] border border-[#FFCDD2] rounded px-4 py-3 text-sm mb-4">{error}</div>
            )}
            <form onSubmit={handleAddSubmit}>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className={labelClass}>Original first name</label>
                  <input type="text" value={addForm.original_first_name}
                    onChange={e => setAddForm(f => ({ ...f, original_first_name: e.target.value }))}
                    placeholder="As it appears in the yearbook" className={inputClass} disabled={addLoading} />
                </div>
                <div>
                  <label className={labelClass}>Original last name</label>
                  <input type="text" value={addForm.original_last_name}
                    onChange={e => setAddForm(f => ({ ...f, original_last_name: e.target.value }))}
                    placeholder="Maiden or birth name" className={inputClass} disabled={addLoading} />
                </div>
                <div>
                  <label className={labelClass}>Current first name <span className="text-[#f44336]">*</span></label>
                  <input type="text" value={addForm.first_name} required
                    onChange={e => setAddForm(f => ({ ...f, first_name: e.target.value }))}
                    placeholder="Current legal name" className={inputClass} disabled={addLoading} />
                </div>
                <div>
                  <label className={labelClass}>Current last name <span className="text-[#f44336]">*</span></label>
                  <input type="text" value={addForm.last_name} required
                    onChange={e => setAddForm(f => ({ ...f, last_name: e.target.value }))}
                    placeholder="Current last name" className={inputClass} disabled={addLoading} />
                </div>
                <div>
                  <label className={labelClass}>Email <span className="text-[#94A3B8] font-normal normal-case tracking-normal">(optional)</span></label>
                  <input type="email" value={addForm.email}
                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="alumni@example.com" className={inputClass} disabled={addLoading} />
                </div>
                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input type="checkbox" checked={addForm.is_deceased}
                      onChange={e => setAddForm(f => ({ ...f, is_deceased: e.target.checked }))}
                      disabled={addLoading} className="w-4 h-4 rounded border-[#E2E8F0] accent-[#0E2240] cursor-pointer" />
                    <span className="text-sm text-[#64748B]">Mark as deceased</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={addLoading || !addForm.first_name || !addForm.last_name}
                  className={`px-5 py-2.5 rounded text-sm font-semibold border-none transition-opacity ${addLoading || !addForm.first_name || !addForm.last_name ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                  {addLoading ? 'Adding…' : 'Add user'}
                </button>
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded text-sm font-semibold border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] cursor-pointer transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditUser(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-[#0E2240]">
                Edit {editUser.first_name} {editUser.last_name}
              </h2>
              <button onClick={() => setEditUser(null)} className="text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer text-lg leading-none">✕</button>
            </div>
            {error && (
              <div className="bg-[#FFF8F8] text-[#C62828] border border-[#FFCDD2] rounded px-4 py-3 text-sm mb-4">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelClass}>Original first name</label>
                <input type="text" value={editForm.former_first_name}
                  onChange={e => setEditForm(f => ({ ...f, former_first_name: e.target.value }))}
                  placeholder="As it appears in the yearbook" className={inputClass} disabled={editLoading} />
              </div>
              <div>
                <label className={labelClass}>Original last name</label>
                <input type="text" value={editForm.former_last_name}
                  onChange={e => setEditForm(f => ({ ...f, former_last_name: e.target.value }))}
                  placeholder="Maiden or birth name" className={inputClass} disabled={editLoading} />
              </div>
              <div>
                <label className={labelClass}>Current first name <span className="text-[#f44336]">*</span></label>
                <input type="text" value={editForm.first_name} required
                  onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="Current legal name" className={inputClass} disabled={editLoading} />
              </div>
              <div>
                <label className={labelClass}>Current last name <span className="text-[#f44336]">*</span></label>
                <input type="text" value={editForm.last_name} required
                  onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Current last name" className={inputClass} disabled={editLoading} />
              </div>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none mb-5">
              <input type="checkbox" checked={editForm.is_deceased}
                onChange={e => setEditForm(f => ({ ...f, is_deceased: e.target.checked }))}
                disabled={editLoading} className="w-4 h-4 rounded border-[#E2E8F0] accent-[#0E2240] cursor-pointer" />
              <span className="text-sm text-[#64748B]">Mark as deceased</span>
            </label>
            <div className="flex gap-3">
              <button onClick={handleUpdateUser} disabled={editLoading || !editForm.first_name || !editForm.last_name}
                className={`px-5 py-2.5 rounded text-sm font-semibold border-none transition-opacity ${editLoading || !editForm.first_name || !editForm.last_name ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                {editLoading ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditUser(null)}
                className="px-5 py-2.5 rounded text-sm font-semibold border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] cursor-pointer transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import CSV modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { setShowImportModal(false); setCsvRows([]); setImportResult(null); }}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold text-[#0E2240]">Import from CSV — Class of {selectedClass?.year}</h2>
                  <button onClick={downloadTemplate} className="text-xs text-[#E8A93E] font-semibold bg-transparent border-none cursor-pointer hover:opacity-80 whitespace-nowrap">↓ Download template</button>
                </div>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Columns: <code className="bg-[#F1F5F9] px-1 py-0.5 rounded text-[#0E2240]">last, first, maiden</code>
                  <span className="ml-2">— append <code className="bg-[#F1F5F9] px-1 py-0.5 rounded text-[#0E2240]"> (DECEASED)</code> to first name to flag deceased</span>
                </p>
              </div>
              <button onClick={() => { setShowImportModal(false); setCsvRows([]); setImportResult(null); }} className="text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer text-lg leading-none ml-4 shrink-0">✕</button>
            </div>

            {importResult ? (
              <div>
                <div className="bg-[#E8F5E9] text-[#2E7D32] border border-[#A5D6A7] rounded px-4 py-3 text-sm mb-4">
                  <strong>{importResult.created}</strong> user{importResult.created !== 1 ? 's' : ''} imported successfully.
                  {importResult.skipped.length > 0 && <span className="text-[#C62828] ml-2"><strong>{importResult.skipped.length}</strong> skipped.</span>}
                </div>
                {importResult.skipped.length > 0 && (
                  <>
                    <div className="text-xs text-[#64748B] space-y-1 mb-4">
                      {importResult.skipped.map((s: any, i: number) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-[#f44336]">✕</span>
                          <span><strong>{s.name}</strong> — {s.reason}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => { setImportResult(null); setCsvRows([]); }}
                        className="text-xs text-[#E8A93E] font-semibold bg-transparent border-none cursor-pointer hover:opacity-80">
                        Import another file
                      </button>
                      <button onClick={() => { setShowImportModal(false); setImportResult(null); }}
                        className="text-xs text-[#64748B] font-semibold bg-transparent border-none cursor-pointer hover:opacity-80">
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : csvRows.length === 0 ? (
              <div onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-[#E2E8F0] rounded-lg py-10 text-center cursor-pointer hover:border-[#E8A93E] transition-colors">
                <div className="text-2xl text-[#CBD5E1] mb-2">↑</div>
                <p className="text-sm font-semibold text-[#0E2240] mb-1">Click to select a CSV file</p>
                <p className="text-xs text-[#94A3B8]">Up to 500 rows per import</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-[#64748B]">
                    <span className="text-[#2E7D32] font-semibold">{validRows.length} valid</span>
                    {invalidRows.length > 0 && <span className="text-[#C62828] font-semibold ml-2">{invalidRows.length} invalid</span>}
                    <span className="text-[#94A3B8] ml-2">— {csvRows.length} rows total</span>
                  </p>
                  <button onClick={() => { setCsvRows([]); fileRef.current?.click(); }}
                    className="text-xs text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer">
                    Change file
                  </button>
                </div>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                        <th className="text-left px-3 py-2 text-[#94A3B8] font-semibold w-6"></th>
                        <th className="text-left px-3 py-2 text-[#94A3B8] font-semibold">Original name</th>
                        <th className="text-left px-3 py-2 text-[#94A3B8] font-semibold">Current name</th>
                        <th className="text-left px-3 py-2 text-[#94A3B8] font-semibold">Deceased</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 20).map((row, i) => (
                        <tr key={i} className={`border-b border-[#E2E8F0] last:border-0 ${!row._valid ? 'bg-[#FFF8F8]' : ''}`}>
                          <td className="px-3 py-2">
                            {row._valid ? <span className="text-[#2E7D32]">✓</span> : <span className="text-[#f44336]" title={row._error}>✕</span>}
                          </td>
                          <td className="px-3 py-2 text-[#64748B]">
                            {row.original_first_name || row.original_last_name
                              ? `${row.original_first_name} ${row.original_last_name}`.trim()
                              : <span className="text-[#CBD5E1]">—</span>}
                          </td>
                          <td className="px-3 py-2 font-medium text-[#0E2240]">
                            {row.first_name || row.last_name
                              ? `${row.first_name} ${row.last_name}`.trim()
                              : <span className="text-[#f44336]">Missing</span>}
                          </td>
                          <td className="px-3 py-2">{row.is_deceased ? <span className="text-xs text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded">Deceased</span> : <span className="text-[#CBD5E1]">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvRows.length > 20 && (
                    <div className="px-3 py-2 text-xs text-[#94A3B8] bg-[#F8FAFC] border-t border-[#E2E8F0]">
                      … and {csvRows.length - 20} more rows
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={handleImport} disabled={importing || validRows.length === 0}
                    className={`px-5 py-2.5 rounded text-sm font-semibold border-none transition-opacity ${importing || validRows.length === 0 ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                    {importing ? 'Importing…' : `Import ${validRows.length} user${validRows.length !== 1 ? 's' : ''}`}
                  </button>
                  <button onClick={() => { setShowImportModal(false); setCsvRows([]); }}
                    className="px-5 py-2.5 rounded text-sm font-semibold border border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC] cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Delete User"
        message="Are you sure you want to delete this user?"
        details={['All user profiles and data', 'All comments written by and about this user', 'All S3 photographs']}
        confirmText="Delete" cancelText="Cancel" isDangerous
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, userId: null })}
      />
      <UserDeletionWarning
        isOpen={warningModal.isOpen} userCount={1}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setWarningModal({ isOpen: false, userId: null })}
      />
    </div>
  );
};

export default UsersManager;
