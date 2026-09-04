import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { authAPI } from '../apiClient';
import api from '../api';
import { CurrentUser } from '../types';

interface School { id: number; name: string; }
interface Class  { id: number; year: number; }
interface Match {
  id: number;
  first_name: string;
  last_name: string;
  maiden_name: string | null;
  class_year: number | null;
  school_name: string | null;
}

type Step = 'school' | 'search' | 'results' | 'claim';

const inputClass = 'w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors';
const labelClass = 'block text-sm font-semibold text-[#0E2240] mb-1.5';
const selectClass = 'w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] bg-white transition-colors text-[#0E2240]';

const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAppContext();
  const [step, setStep] = useState<Step>('school');

  // Step 1: school + class
  const [schools, setSchools] = useState<School[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  const [classesLoading, setClassesLoading] = useState(false);

  // Step 2: name search
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);

  // Step 3: selected match
  const [selected, setSelected] = useState<Match | null>(null);

  // Step 4: claim
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [claiming, setClaiming]       = useState(false);
  const [claimError, setClaimError]   = useState<string | null>(null);

  useEffect(() => {
    api.get('/schools')
      .then(r => setSchools(r.data.schools || []))
      .catch(() => {})
      .finally(() => setSchoolsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSchoolId) { setClasses([]); setSelectedClassId(null); return; }
    setClassesLoading(true);
    api.get(`/schools/${selectedSchoolId}/classes`)
      .then(r => setClasses(r.data.classes || []))
      .catch(() => {})
      .finally(() => setClassesLoading(false));
  }, [selectedSchoolId]);

  const selectedSchool = schools.find(s => s.id === selectedSchoolId);
  const selectedClass  = classes.find(c => c.id === selectedClassId);

  const handleSchoolNext = () => {
    if (selectedSchoolId && selectedClassId) setStep('search');
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId) return;
    setSearchError(null);
    setSearching(true);
    try {
      const res = await authAPI.claimSearch(firstName.trim(), lastName.trim(), selectedClassId);
      const found = res.data.matches;
      setMatches(found);
      if (found.length === 0) {
        setSearchError('No unregistered record found matching that name. Check your spelling or try your maiden name.');
      } else if (found.length === 1) {
        setSelected(found[0]);
        setStep('claim');
      } else {
        setStep('results');
      }
    } catch {
      setSearchError('Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (match: Match) => {
    setSelected(match);
    setStep('claim');
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setClaimError(null);
    if (password !== confirmPassword) { setClaimError('Passwords do not match.'); return; }
    if (password.length < 6) { setClaimError('Password must be at least 6 characters.'); return; }
    setClaiming(true);
    try {
      const res = await authAPI.claimAccount(selected.id, email.trim(), password);
      const { token, user: userData } = res.data;
      const user: CurrentUser = {
        id: userData.user_id,
        email: userData.email,
        is_admin: userData.is_admin,
        is_class_admin: userData.is_class_admin,
        created_at: '',
        profile: userData.profile || null,
        user_id: userData.user_id,
        first_name: userData.profile?.first_name || '',
        last_name: userData.profile?.last_name || '',
      };
      localStorage.setItem('token', token);
      login(user);
      navigate('/');
    } catch (err: any) {
      setClaimError(err.response?.data?.error || 'Failed to create account. Please try again.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
      <div className="w-full max-w-[480px] flex flex-col items-center gap-8">

        {/* Brand */}
        <div className="text-center w-full">
          <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
            Class Reunion
          </h1>
          <div className="h-px bg-[#E8A93E] mt-4" />
        </div>

        <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">

          {/* Step 1: School + class year */}
          {step === 'school' && (
            <>
              <h2 className="text-xl font-semibold text-[#0E2240] mb-2">Get started</h2>
              <p className="text-sm text-[#64748B] mb-7">Select your school and graduation year.</p>
              <div className="space-y-5">
                <div>
                  <label className={labelClass}>School</label>
                  {schoolsLoading ? (
                    <div className="text-sm text-[#94A3B8]">Loading…</div>
                  ) : (
                    <select
                      value={selectedSchoolId ?? ''}
                      onChange={e => { setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null); setSelectedClassId(null); }}
                      className={selectClass}
                    >
                      <option value="">— Select school —</option>
                      {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
                {selectedSchoolId && (
                  <div>
                    <label className={labelClass}>Graduation year</label>
                    {classesLoading ? (
                      <div className="text-sm text-[#94A3B8]">Loading…</div>
                    ) : (
                      <select
                        value={selectedClassId ?? ''}
                        onChange={e => setSelectedClassId(e.target.value ? parseInt(e.target.value) : null)}
                        className={selectClass}
                      >
                        <option value="">— Select year —</option>
                        {classes.map(c => <option key={c.id} value={c.id}>Class of {c.year}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <button
                  onClick={handleSchoolNext}
                  disabled={!selectedSchoolId || !selectedClassId}
                  className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${!selectedSchoolId || !selectedClassId ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {/* Step 2: Name search */}
          {step === 'search' && (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-[#0E2240]">Find your name</h2>
                  <p className="text-xs text-[#94A3B8] mt-0.5">{selectedSchool?.name} · Class of {selectedClass?.year}</p>
                </div>
                <button onClick={() => setStep('school')} className="text-xs text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer">Change</button>
              </div>
              <form onSubmit={handleSearch} className="space-y-5">
                {searchError && (
                  <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">{searchError}</div>
                )}
                <div>
                  <label className={labelClass}>First name</label>
                  <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                    required placeholder="Jane" className={inputClass} disabled={searching} />
                </div>
                <div>
                  <label className={labelClass}>Last name</label>
                  <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                    required placeholder="Smith" className={inputClass} disabled={searching} />
                  <p className="text-xs text-[#94A3B8] mt-1.5">Try your maiden name if you've changed your last name.</p>
                </div>
                <button type="submit" disabled={searching || !firstName.trim() || !lastName.trim()}
                  className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${searching || !firstName.trim() || !lastName.trim() ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                  {searching ? 'Searching…' : 'Find my name'}
                </button>
              </form>
            </>
          )}

          {/* Step 3: Multiple results */}
          {step === 'results' && (
            <>
              <h2 className="text-xl font-semibold text-[#0E2240] mb-2">Is this you?</h2>
              <p className="text-sm text-[#64748B] mb-6">Select your name from the list below.</p>
              <div className="space-y-2 mb-6">
                {matches.map(m => (
                  <button key={m.id} onClick={() => handleSelect(m)}
                    className="w-full text-left border border-[#E2E8F0] rounded-lg px-4 py-3.5 hover:border-[#E8A93E] hover:bg-[#FFFBF2] transition-colors cursor-pointer bg-white">
                    <div className="text-sm font-semibold text-[#0E2240]">
                      {m.first_name} {m.last_name}
                      {m.maiden_name && <span className="font-normal text-[#64748B] ml-1">(née {m.maiden_name})</span>}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => { setStep('search'); setMatches([]); }}
                className="text-sm text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer transition-colors">
                ← Search again
              </button>
            </>
          )}

          {/* Step 4: Claim */}
          {step === 'claim' && selected && (
            <>
              <div className="bg-[#F6F8FC] border border-[#E2E8F0] rounded-lg px-4 py-3 mb-6">
                <p className="text-xs text-[#94A3B8] font-semibold uppercase tracking-widest mb-0.5">Creating account for</p>
                <p className="text-sm font-semibold text-[#0E2240]">
                  {selected.first_name} {selected.last_name}
                  {selected.maiden_name && <span className="font-normal text-[#64748B] ml-1">(née {selected.maiden_name})</span>}
                </p>
                {(selected.school_name || selected.class_year) && (
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    {selected.school_name}{selected.school_name && selected.class_year ? ' · ' : ''}{selected.class_year ? `Class of ${selected.class_year}` : ''}
                  </p>
                )}
              </div>
              <form onSubmit={handleClaim} className="space-y-5">
                {claimError && (
                  <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">{claimError}</div>
                )}
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    required placeholder="your@email.com" className={inputClass} disabled={claiming} />
                </div>
                <div>
                  <label className={labelClass}>Password</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    required placeholder="••••••••" className={inputClass} disabled={claiming} />
                </div>
                <div>
                  <label className={labelClass}>Confirm password</label>
                  <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    required placeholder="••••••••" className={inputClass} disabled={claiming} />
                </div>
                <button type="submit" disabled={claiming || !email || !password || !confirmPassword}
                  className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${claiming || !email || !password || !confirmPassword ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}>
                  {claiming ? 'Creating account…' : 'Create my account'}
                </button>
                <p className="text-xs text-[#94A3B8] text-center">
                  By creating an account, you agree to the{' '}
                  <Link to="/terms" className="text-[#E8A93E] font-semibold hover:opacity-80">Terms of Use</Link>.
                </p>
              </form>
              <button onClick={() => setStep(matches.length > 1 ? 'results' : 'search')}
                className="mt-4 text-sm text-[#94A3B8] hover:text-[#0E2240] bg-transparent border-none cursor-pointer transition-colors">
                ← {matches.length > 1 ? 'Choose a different name' : 'Search again'}
              </button>
            </>
          )}
        </div>

        <p className="text-sm text-[#94A3B8]">
          Already have an account?{' '}
          <Link to="/login" className="text-[#E8A93E] font-semibold hover:opacity-80">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default JoinPage;
