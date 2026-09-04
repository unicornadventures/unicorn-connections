import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';

const Registration: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/register', { email, firstName, lastName, password, confirmPassword });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors';
  const labelClass = 'block text-sm font-semibold text-[#0E2240] mb-1.5';

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

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
      <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
        <BrandHeader />

        <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
          <h2 className="text-xl font-semibold text-[#0E2240] mb-7">Create your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>First name</label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
                  disabled={loading} placeholder="John" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Last name</label>
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                  disabled={loading} placeholder="Doe" className={inputClass} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                required disabled={loading} placeholder="your@email.com" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                required disabled={loading} placeholder="••••••••" className={inputClass} />
              <p className="text-xs text-[#94A3B8] mt-1">At least 6 characters</p>
            </div>

            <div>
              <label className={labelClass}>Confirm password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                required disabled={loading} placeholder="••••••••" className={inputClass} />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password || !confirmPassword}
              className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${
                loading || !email || !password || !confirmPassword
                  ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                  : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'
              }`}
            >
              {loading ? 'Creating account...' : 'Create account'}
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

        <p className="text-xs text-[#94A3B8]">Your data is secure and private</p>
      </div>
    </div>
  );
};

const BrandHeader: React.FC = () => (
  <div className="text-center w-full">
    <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
      Class Reunion
    </h1>
    <div className="h-px bg-[#E8A93E] mt-4" />
  </div>
);

export default Registration;
