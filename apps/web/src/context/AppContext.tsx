import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { CurrentUser } from '../types';
import api from '@/api';

interface AppContextType {
  currentUser: CurrentUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (user: CurrentUser) => void;
  logout: () => void;
  updateCurrentUser: (updates: Partial<CurrentUser>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const isAuthenticated = !!currentUser;

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('currentUser');
    if (token && savedUser) {
      try {
        setCurrentUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
      }
    }
    setLoading(false);
  }, []);

  const login = (user: CurrentUser) => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
  };

  const updateCurrentUser = (updates: Partial<CurrentUser>) => {
    setCurrentUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem('currentUser', JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AppContext.Provider value={{ currentUser, isAuthenticated, loading, login, logout, updateCurrentUser }}>
      {loading ? (
        <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
          🔄 Securing session context...
        </div>
      ) : (
        children
      )}
    </AppContext.Provider>
  );
};

export default AppProvider;

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};