import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import api from '../api';

interface SchoolInfo {
  id: number;
  name: string;
  location: string;
}

interface ClassInfo {
  id: number;
  year: number;
}

const inputClass = 'w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors';
const labelClass = 'block text-sm font-semibold text-[#0E2240] mb-1.5';

const RegisterWithLink: React.FC = () => {
  const { hash } = useParams<{ hash: string }>();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkLoading, setLinkLoading] = useState(false);
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);

  useEffect(() => {
    if (hash) fetchRegistrationLink();
  }, [hash]);

  const fetchRegistrationLink = async () => {
    if (!hash) return;
    try {
      const response = await api.get(`/auth/registration-link/${hash}`);
      setSchool(response.data.school);
      setClassInfo(response.data.class);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid registration link.');
      setSchool(null);
      setClassInfo(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLinkLoading(true);
    try {
      await api.post('/auth/register', {
        email, firstName, lastName, password, confirmPassword,
        schoolId: school?.id, classId: classInfo?.id
      });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLinkLoading(false);
    }
  };

  const BrandHeader = () => (
    <div className="text-center w-full">
      <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
        {school ? school.name : 'Westbrook High School'}
      </h1>
      <div className="flex items-center gap-3 mt-4 px-2">
        <div className="h-px flex-1 bg-[#E8A93E]" />
        <span className="text-xs font-semibold text-[#64748B] tracking-[0.18em] uppercase">
          {classInfo ? `Class of ${classInfo.year}` : 'Alumni Community'}
        </span>
        <div className="h-px flex-1 bg-[#E8A93E]" />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
        <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
          <div className="text-center w-full">
            <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
              Westbrook High School
            </h1>
            <div className="flex items-center gap-3 mt-4 px-2">
              <div className="h-px flex-1 bg-[#E8A93E]" />
              <span className="text-xs font-semibold text-[#64748B] tracking-[0.18em] uppercase">Alumni Community</span>
              <div className="h-px flex-1 bg-[#E8A93E]" />
            </div>
          </div>
          <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
            <p className="text-sm text-[#94A3B8] text-center">Loading registration details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
        <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
          <BrandHeader />
          <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border-t-2 border-t-[#E8A93E] border border-[#E2E8F0]">
            <h2 className="text-xl font-semibold text-[#0E2240] mb-3">Registration Successful</h2>
            <p className="text-sm text-[#64748B] mb-2">
              Check your email to verify your account. You'll be redirected to sign in shortly.
            </p>
            <p className="text-xs text-[#94A3B8]">Redirecting to login...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!school || !classInfo) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
        <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
          <div className="text-center w-full">
            <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
              Westbrook High School
            </h1>
            <div className="flex items-center gap-3 mt-4 px-2">
              <div className="h-px flex-1 bg-[#E8A93E]" />
              <span className="text-xs font-semibold text-[#64748B] tracking-[0.18em] uppercase">Alumni Community</span>
              <div className="h-px flex-1 bg-[#E8A93E]" />
            </div>
          </div>
          <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
            <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
              {error || 'Invalid registration link.'}
            </div>
            <button
              onClick={() => navigate('/register')}
              className="w-full bg-[#0E2240] text-white font-semibold py-3 rounded text-sm hover:opacity-90 transition-opacity"
            >
              Go to standard registration
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
      <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
        <BrandHeader />

        <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
          <h2 className="text-xl font-semibold text-[#0E2240] mb-5">Create your account</h2>

          {/* Class info banner */}
          <div className="mb-6 px-4 py-3 bg-[#F6F8FC] border border-[#E2E8F0] rounded">
            <div className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-1.5">Joining</div>
            <div className="text-sm font-semibold text-[#0E2240]">
              {school.name}{school.location ? ` — ${school.location}` : ''}
            </div>
            <div className="text-xs text-[#64748B] mt-0.5">Class of {classInfo.year}</div>
          </div>

          {error && (
            <div className="mb-5 bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>First name</label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  placeholder="John" className={inputClass} disabled={linkLoading} />
              </div>
              <div>
                <label className={labelClass}>Last name</label>
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  placeholder="Doe" className={inputClass} disabled={linkLoading} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="john.doe@example.com" className={inputClass} disabled={linkLoading} />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" className={inputClass} disabled={linkLoading} />
              <p className="text-xs text-[#94A3B8] mt-1">At least 6 characters</p>
            </div>
            <div>
              <label className={labelClass}>Confirm password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••" className={inputClass} disabled={linkLoading} />
            </div>
            <button
              type="submit"
              disabled={linkLoading}
              className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${
                linkLoading
                  ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                  : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'
              }`}
            >
              {linkLoading ? 'Creating account...' : 'Create account'}
            </button>
            <p className="text-xs text-[#94A3B8] text-center">
              By creating an account, you agree to the{' '}
              <Link to="/terms" className="text-[#E8A93E] font-semibold hover:opacity-80">Terms of Use</Link>.
            </p>
          </form>

          <div className="mt-5 pt-5 border-t border-[#E2E8F0] text-center">
            <p className="text-sm text-[#64748B]">
              Already have an account?{' '}
              <button type="button" onClick={() => navigate('/login')}
                className="text-[#E8A93E] font-semibold hover:opacity-80 transition-opacity bg-transparent border-none cursor-pointer">
                Sign in
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterWithLink;
