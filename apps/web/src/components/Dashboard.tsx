import React from 'react';
import { useAppContext } from '../context/AppContext';
import { CurrentUser } from '../types';
import SchoolManager from './SchoolManager';
import ClassManager from './ClassManager';
import UserProfile from './UserProfile';

const Dashboard: React.FC<{ currentUser: CurrentUser }> = ({ currentUser }) => {
  const { logout } = useAppContext();

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-5 mb-6">
        <h1 className="font-display text-3xl font-bold text-[#0E2240] uppercase tracking-tight">
          Class Reunion Dashboard
        </h1>
        <button
          onClick={logout}
          className="px-4 py-2 bg-[#E2E8F0] text-[#0E2240] rounded text-sm font-semibold hover:opacity-80 cursor-pointer transition-opacity border-none"
        >
          Logout ({currentUser.first_name})
        </button>
      </div>

      <h2 className="text-lg font-semibold text-[#0E2240] mb-1">Welcome, {currentUser.first_name}!</h2>
      <p className="text-sm text-[#64748B] mb-8">{currentUser.email}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <h3 className="text-xs font-semibold text-[#94A3B8] tracking-[0.15em] uppercase pb-2 border-b border-[#E2E8F0] mb-4">
            School Management
          </h3>
          <SchoolManager />
        </div>
        <div>
          <h3 className="text-xs font-semibold text-[#94A3B8] tracking-[0.15em] uppercase pb-2 border-b border-[#E2E8F0] mb-4">
            Class Management
          </h3>
          <ClassManager />
        </div>
      </div>

      <div className="border-t border-[#E2E8F0] pt-8">
        <h3 className="text-xs font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-4">My Profile</h3>
        <UserProfile userId={currentUser.user_id} />
      </div>
    </div>
  );
};

export default Dashboard;
