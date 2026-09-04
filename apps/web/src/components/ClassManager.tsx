import React, { useState, useEffect } from 'react';
import { adminClassAPI, classAPI, schoolAPI } from '../apiClient';
import ConfirmModal from './ConfirmModal';
import { SchoolClass } from '../types';

/** Only the fields this screen holds — it builds one locally on add. */
type LinkedClass = Pick<SchoolClass, 'id' | 'year' | 'member_count'>;

interface AvailableYear {
  id: number;
  year: number;
}

const ClassManager: React.FC = () => {
  const [allYears, setAllYears] = useState<AvailableYear[]>([]);
  const [linkedClasses, setLinkedClasses] = useState<LinkedClass[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedYearId, setSelectedYearId] = useState('');
  const [addingYear, setAddingYear] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LinkedClass | null>(null);
  const [setupStartYear, setSetupStartYear] = useState('');
  const [settingUp, setSettingUp] = useState(false);

  useEffect(() => {
    Promise.all([schoolAPI.getSchools(), classAPI.getAllClasses()])
      .then(([schoolsRes, classesRes]) => {
        setSchools(schoolsRes.data.schools || []);
        setAllYears(classesRes.data.classes || []);
      })
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoadingSchools(false));
  }, []);

  useEffect(() => {
    if (!selectedSchoolId) { setLinkedClasses([]); return; }
    setLoadingClasses(true);
    setError(null);
    setSetupStartYear('');
    adminClassAPI.getClasses(selectedSchoolId)
      .then(res => setLinkedClasses(res.data.classes || []))
      .catch(() => setError('Failed to fetch class years.'))
      .finally(() => setLoadingClasses(false));
  }, [selectedSchoolId]);

  const selectedSchool = schools.find(s => s.id === selectedSchoolId);
  const linkedIds = new Set(linkedClasses.map(c => c.id));
  const availableYears = allYears.filter(c => !linkedIds.has(c.id));

  const handleAddYear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedYearId || !selectedSchoolId) return;
    const yearObj = availableYears.find(c => c.id === parseInt(selectedYearId));
    if (!yearObj) return;
    setAddingYear(true);
    setError(null);
    try {
      await adminClassAPI.createClass(selectedSchoolId, yearObj.year);
      setLinkedClasses(prev =>
        [...prev, { id: yearObj.id, year: yearObj.year, member_count: 0 }]
          .sort((a, b) => b.year - a.year)
      );
      setSelectedYearId('');
    } catch (err: any) {
      setError(err?.response?.data?.error || `Failed to link class year ${yearObj.year}.`);
    } finally {
      setAddingYear(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupStartYear || !selectedSchoolId) return;
    const year = parseInt(setupStartYear);
    if (isNaN(year) || year < 1950 || year > new Date().getFullYear()) return;
    setSettingUp(true);
    setError(null);
    try {
      const res = await adminClassAPI.bulkLinkClasses(selectedSchoolId, year);
      setLinkedClasses(res.data.classes || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to set up class years.');
    } finally {
      setSettingUp(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || !selectedSchoolId) return;
    try {
      await adminClassAPI.unlinkClass(selectedSchoolId, pendingDelete.id);
      setLinkedClasses(prev => prev.filter(c => c.id !== pendingDelete.id));
    } catch {
      setError(`Failed to remove class year ${pendingDelete.year}.`);
    } finally {
      setPendingDelete(null);
    }
  };

  if (loadingSchools) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-8">
        <div className="text-center text-[#94A3B8] text-sm py-16">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">
        Class Management
      </h1>
      <p className="text-sm text-[#64748B] mb-8">
        Link class years to schools. Each year is drawn from a shared pool (1950–present).
      </p>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {/* School selector */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6 flex items-center gap-6 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-2">
            School
          </label>
          <select
            value={selectedSchoolId || ''}
            onChange={e => {
              setError(null);
              setSelectedYearId('');
              setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null);
            }}
            className="w-full border border-[#E2E8F0] rounded px-4 py-2.5 text-sm text-[#0E2240] focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] bg-white transition-colors"
          >
            <option value="">— Select a school —</option>
            {schools.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {selectedSchool && (
          <div className="flex gap-6 text-center">
            <div>
              <div className="text-2xl font-bold text-[#0E2240]">{linkedClasses.length}</div>
              <div className="text-xs text-[#94A3B8] uppercase tracking-wide">Class Years</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#0E2240]">
                {linkedClasses.reduce((sum, c) => sum + (c.member_count || 0), 0)}
              </div>
              <div className="text-xs text-[#94A3B8] uppercase tracking-wide">Total Members</div>
            </div>
          </div>
        )}
      </div>

      {selectedSchoolId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Linked class years — 2/3 width */}
          <div className="lg:col-span-2">
            <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0E2240]">
                  Linked Class Years
                  {selectedSchool && (
                    <span className="text-[#94A3B8] font-normal ml-1">— {selectedSchool.name}</span>
                  )}
                </h2>
                {linkedClasses.length > 0 && (
                  <span className="text-xs bg-[#F1F5F9] text-[#64748B] rounded-full px-2.5 py-1 font-medium">
                    {linkedClasses.length} year{linkedClasses.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {loadingClasses ? (
                <div className="py-12 text-center text-sm text-[#94A3B8]">Loading...</div>
              ) : linkedClasses.length === 0 ? (
                <div className="px-8 py-10">
                  <p className="text-sm font-semibold text-[#0E2240] mb-1">No class years set up yet</p>
                  <p className="text-sm text-[#64748B] mb-6">
                    Enter the first graduating class year for <strong>{selectedSchool?.name}</strong>. All years from that year through {new Date().getFullYear()} will be linked automatically.
                  </p>
                  <form onSubmit={handleSetup} className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-2">
                        First class year
                      </label>
                      <input
                        type="number"
                        min={1950}
                        max={new Date().getFullYear()}
                        value={setupStartYear}
                        onChange={e => setSetupStartYear(e.target.value)}
                        placeholder={`e.g. ${new Date().getFullYear() - 10}`}
                        disabled={settingUp}
                        className="w-full border border-[#E2E8F0] rounded px-4 py-2.5 text-sm text-[#0E2240] focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors placeholder:text-[#CBD5E1]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={settingUp || !setupStartYear}
                      className={`px-5 py-2.5 rounded text-sm font-semibold border-none transition-opacity whitespace-nowrap ${
                        settingUp || !setupStartYear
                          ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                          : 'bg-[#E8A93E] text-[#0E2240] hover:opacity-90 cursor-pointer'
                      }`}
                    >
                      {settingUp ? 'Setting up…' : 'Set up years'}
                    </button>
                  </form>
                  {setupStartYear && parseInt(setupStartYear) >= 1950 && parseInt(setupStartYear) <= new Date().getFullYear() && (
                    <p className="text-xs text-[#94A3B8] mt-3">
                      This will link <strong className="text-[#64748B]">{new Date().getFullYear() - parseInt(setupStartYear) + 1}</strong> class years ({setupStartYear}–{new Date().getFullYear()}).
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  {linkedClasses.map((c, i) => (
                    <div
                      key={c.id}
                      className={`flex items-center px-6 py-4 ${i < linkedClasses.length - 1 ? 'border-b border-[#E2E8F0]' : ''} hover:bg-[#F8FAFC] transition-colors group`}
                    >
                      <div className="flex-1 flex items-center gap-4">
                        <span className="font-display text-2xl font-bold text-[#0E2240] w-16">
                          {c.year}
                        </span>
                        <div className="flex items-center gap-1.5 text-sm text-[#64748B]">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                          <span>{c.member_count ?? 0} {c.member_count === 1 ? 'member' : 'members'}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setPendingDelete(c)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-[#94A3B8] hover:text-[#f44336] transition-all bg-transparent border-none cursor-pointer px-2 py-1 rounded"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add year — 1/3 width */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
              <h2 className="text-sm font-semibold text-[#0E2240] mb-4">Add Class Year</h2>

              {availableYears.length === 0 ? (
                <div className="text-center py-6">
                  <div className="text-[#CBD5E1] text-2xl mb-2">✓</div>
                  <p className="text-xs text-[#94A3B8]">
                    All available class years are already linked to this school.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleAddYear} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-2">
                      Year
                    </label>
                    <select
                      value={selectedYearId}
                      onChange={e => setSelectedYearId(e.target.value)}
                      className="w-full border border-[#E2E8F0] rounded px-4 py-2.5 text-sm text-[#0E2240] focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] bg-white transition-colors"
                    >
                      <option value="">— Select year —</option>
                      {availableYears.map(c => (
                        <option key={c.id} value={c.id}>{c.year}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={addingYear || !selectedYearId}
                    className={`w-full py-2.5 rounded text-sm font-semibold border-none transition-opacity ${
                      addingYear || !selectedYearId
                        ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                        : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'
                    }`}
                  >
                    {addingYear ? 'Linking...' : 'Link Year'}
                  </button>
                </form>
              )}

              <div className="mt-6 pt-5 border-t border-[#E2E8F0]">
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  Years are drawn from a shared pool (1950–{new Date().getFullYear()}). Linking a year makes it available for alumni to register under <strong className="text-[#64748B]">{selectedSchool?.name}</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedSchoolId && (
        <div className="bg-white border border-[#E2E8F0] rounded-lg py-16 text-center">
          <div className="text-[#CBD5E1] text-4xl mb-4">▽</div>
          <p className="text-sm text-[#64748B]">Select a school above to manage its class years.</p>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingDelete}
        title={`Remove Class Year ${pendingDelete?.year}`}
        message={`Remove the class of ${pendingDelete?.year} from ${selectedSchool?.name}?`}
        details={[
          `${pendingDelete?.member_count ?? 0} member${(pendingDelete?.member_count ?? 0) !== 1 ? 's' : ''} in this class year will lose their class assignment`,
          'Member accounts will not be deleted',
        ]}
        confirmText="Remove Year"
        isDangerous
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default ClassManager;
