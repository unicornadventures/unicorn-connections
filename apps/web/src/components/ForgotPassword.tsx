import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const BrandHeader: React.FC = () => (
  <div className="text-center w-full">
    <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
      Class Reunion
    </h1>
    <div className="h-px bg-[#E8A93E] mt-4" />
  </div>
);

const ForgotPassword: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 5000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
        <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
          <BrandHeader />
          <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border-t-2 border-t-[#E8A93E] border border-[#E2E8F0]">
            <h2 className="text-xl font-semibold text-[#0E2240] mb-3">Check Your Email</h2>
            <p className="text-sm text-[#64748B] mb-2">
              If an account exists with that address, we've sent a password reset link.
            </p>
            <p className="text-xs text-[#94A3B8] mb-5">The link expires in 1 hour. Redirecting to login shortly.</p>
            <button type="button" onClick={() => navigate('/login')}
              className="text-[#E8A93E] text-sm font-semibold hover:opacity-80 transition-opacity bg-transparent border-none cursor-pointer">
              Back to login
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
          <h2 className="text-xl font-semibold text-[#0E2240] mb-2">Forgot your password?</h2>
          <p className="text-sm text-[#64748B] mb-7">
            Enter your email and we'll send you a reset link.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">
                {error}
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-[#0E2240] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="your@email.com"
                className="w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email}
              className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${
                loading || !email
                  ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                  : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'
              }`}
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-[#E2E8F0] text-center">
            <button type="button" onClick={() => navigate('/login')}
              className="text-[#E8A93E] text-sm font-semibold hover:opacity-80 transition-opacity bg-transparent border-none cursor-pointer">
              Back to login
            </button>
          </div>
        </div>
        <p className="text-xs text-[#94A3B8]">Your account is safe with us</p>
      </div>
    </div>
  );
};

export default ForgotPassword;
