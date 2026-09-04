import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';

const BrandHeader: React.FC = () => (
  <div className="text-center w-full">
    <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
      Class Reunion
    </h1>
    <div className="h-px bg-[#E8A93E] mt-4" />
  </div>
);

const VerifyEmail: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifyToken = async () => {
      const verificationToken = searchParams.get('token');
      if (!verificationToken) {
        setError('Invalid or missing verification token. Please request a new verification link.');
        setLoading(false);
        return;
      }
      try {
        await api.post('/auth/verify-email', { token: verificationToken });
        setSuccess(true);
        setTimeout(() => navigate('/login'), 3000);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to verify email. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    verifyToken();
  }, [searchParams, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
        <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
          <BrandHeader />
          <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
            <h2 className="text-xl font-semibold text-[#0E2240] mb-3">Verifying your email</h2>
            <div className="flex gap-1.5 mt-4">
              <div className="w-2 h-2 rounded-full bg-[#E8A93E] animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#E8A93E] animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#E8A93E] animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
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
            <h2 className="text-xl font-semibold text-[#0E2240] mb-3">Email verified</h2>
            <p className="text-sm text-[#64748B] mb-2">
              Your email has been verified. You can now sign in to your account.
            </p>
            <p className="text-xs text-[#94A3B8]">Redirecting to login...</p>
          </div>
          <p className="text-xs text-[#94A3B8]">Your account is now fully activated</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
      <div className="w-full max-w-[460px] flex flex-col items-center gap-8">
        <BrandHeader />
        <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
          <h2 className="text-xl font-semibold text-[#0E2240] mb-3">Verification failed</h2>
          <p className="text-sm text-[#64748B] mb-6">{error}</p>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/register')}
              className="w-full bg-[#0E2240] text-white font-semibold py-3 rounded text-sm hover:opacity-90 transition-opacity"
            >
              Create new account
            </button>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-[#E2E8F0] text-[#0E2240] font-semibold py-3 rounded text-sm hover:opacity-90 transition-opacity"
            >
              Back to login
            </button>
          </div>
        </div>
        <p className="text-xs text-[#94A3B8]">Your account is safe with us</p>
      </div>
    </div>
  );
};

export default VerifyEmail;
