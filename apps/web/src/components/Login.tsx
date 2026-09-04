import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { CurrentUser } from '../types';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAppContext();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await api.post(`/auth/login`, { email, password });

      const { user: userData, token } = response.data;

      const user: CurrentUser = {
        id: userData.user_id,
        email: userData.email,
        is_admin: userData.is_admin,
        is_class_admin: userData.is_class_admin,
        created_at: userData.created_at,
        profile: userData.profile || null,
        user_id: userData.user_id,
        first_name: userData.profile?.first_name || '',
        last_name: userData.profile?.last_name || ''
      };

      localStorage.setItem('token', token);
      login(user);
      navigate('/');
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.response?.data?.error || 'Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-5">
      <div className="w-full max-w-[460px] flex flex-col items-center gap-8">

        {/* Brand Header */}
        <div className="text-center w-full">
          <h1 className="font-display text-5xl font-bold text-[#0E2240] uppercase leading-none tracking-tight">
            Class Reunion
          </h1>
          <div className="h-px bg-[#E8A93E] mt-4" />
        </div>

        {/* Login Card */}
        <div className="w-full bg-white rounded-lg px-10 py-10 shadow-sm border border-[#E2E8F0]">
          <h2 className="text-xl font-semibold text-[#0E2240] mb-7">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-[#0E2240]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                placeholder="your@email.com"
                className="w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-[#0E2240]">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                placeholder="••••••••"
                className="w-full border border-[#E2E8F0] rounded px-4 py-3 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] placeholder:text-[#CBD5E1] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className={`w-full font-semibold py-3 rounded text-sm transition-opacity mt-1 ${
                loading || !email || !password
                  ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                  : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'
              }`}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-[#E8A93E] text-sm font-medium hover:opacity-80 transition-opacity bg-transparent border-none cursor-pointer"
            >
              Forgot your password?
            </button>
          </div>
        </div>

        <p className="text-xs text-[#94A3B8]">
          Secure access for alumni only ·{' '}
          <Link to="/terms" className="text-[#E8A93E] font-semibold hover:opacity-80">Terms of Use</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
