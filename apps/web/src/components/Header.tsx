import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { FEEDBACK_ENABLED } from '../featureFlags';
import { SITE_BRAND } from '../branding';

const NAV_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/directory', label: 'Directory' },
  { to: '/events', label: 'Events' },
  { to: '/slideshow', label: 'Slideshow' },
  { to: '/comments', label: 'My Comments' },
  { to: '/help', label: 'Help' },
  ...(FEEDBACK_ENABLED ? [{ to: '/feedback', label: 'Feedback' }] : []),
];

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, currentUser } = useAppContext();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const getInitials = () => {
    const profile = currentUser?.profile;
    const firstName = profile?.former_first_name || profile?.first_name || '';
    const lastName = profile?.former_last_name || profile?.last_name || '';
    return ((firstName.charAt(0) + lastName.charAt(0)).toUpperCase()) || '?';
  };

  const avatarColor = currentUser?.profile?.avatar_color;

  const linkClass = (to: string) =>
    `text-sm font-medium transition-colors duration-200 ${
      location.pathname === to ? 'text-[#E8A93E]' : 'text-white/70 hover:text-[#E8A93E]'
    }`;

  return (
    <header className="sticky top-0 z-[100] bg-[#0E2240]">
      <div className="max-w-[1200px] mx-auto px-5 h-16 flex items-center justify-between">
        <Link
          to="/"
          className="font-display text-xl font-bold text-[#E8A93E] tracking-tight hover:opacity-90 transition-opacity"
        >
          {SITE_BRAND}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map(({ to, label }) => (
            <Link key={to} to={to} className={linkClass(to)}>{label}</Link>
          ))}
        </nav>

        {/* Right side: profile avatar + sign out (desktop) + hamburger (mobile) */}
        <div className="flex items-center gap-3">
          <Link
            to="/profile"
            className="flex items-center gap-2 text-sm font-medium text-white/70 hover:text-[#E8A93E] transition-colors duration-200"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: avatarColor || '#E8A93E', color: avatarColor ? '#FFFFFF' : '#0E2240' }}
            >
              {getInitials()}
            </div>
            <span className="hidden sm:inline">Profile</span>
          </Link>
          <button
            onClick={handleLogout}
            className="hidden md:inline text-xs text-white/40 hover:text-white/70 transition-colors duration-200 font-medium ml-2"
          >
            Sign out
          </button>

          {/* Hamburger */}
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 bg-transparent border-none cursor-pointer ml-1"
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-0.5 bg-white/70 transition-all duration-200 ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-white/70 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-white/70 transition-all duration-200 ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden bg-[#0a1a30] border-t border-white/10 px-5 py-4 flex flex-col gap-4">
          {NAV_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`text-sm font-medium transition-colors duration-200 ${
                location.pathname === to ? 'text-[#E8A93E]' : 'text-white/70'
              }`}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
          <div className="border-t border-white/10 pt-3 mt-1">
            <button
              onClick={() => { handleLogout(); setMenuOpen(false); }}
              className="text-sm text-white/40 hover:text-white/70 transition-colors duration-200 font-medium bg-transparent border-none cursor-pointer p-0"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
