import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import Login from './Login';
import Registration from './Registration';
import RegisterWithLink from './RegisterWithLink';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import VerifyEmail from './VerifyEmail';
import Header from './Header';
import AdminHeader from './AdminHeader';
import WelcomePage from './WelcomePage';
import SchoolManager from './SchoolManager';
import ClassManager from './ClassManager';
import UsersManager from './UsersManager';
import AdminUserProfile from './AdminUserProfile';
import AdminCommentsPage from './AdminCommentsPage';
import UserProfile from './UserProfile';
import CommentSection from './CommentSection';
import DirectoryPage from './DirectoryPage';
import UserCommentsPage from './UserCommentsPage';
import EventsPage from './EventsPage';
import EventsManager from './EventsManager';
import SlideshowPage from './SlideshowPage';
import JoinPage from './JoinPage';
import HelpPage from './HelpPage';
import FeedbackPage from './FeedbackPage';
import TermsPage from './TermsPage';
import { FEEDBACK_ENABLED } from '../featureFlags';

const AppRouter: React.FC = () => {
  const { currentUser, isAuthenticated } = useAppContext();

  const isSuperAdmin = currentUser?.is_admin || false;
  const isClassAdmin = currentUser?.is_class_admin || false;

  // Public auth routes (accessible when not authenticated)
  // Narrowed on currentUser itself, not on isAuthenticated: the latter is a
  // boolean TypeScript cannot use to prove currentUser is non-null below.
  if (!isAuthenticated || !currentUser) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/register" element={<Registration />} />
        <Route path="/register/:hash" element={<RegisterWithLink />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Authenticated routes
  return (
    <div className="min-h-screen bg-[#F6F8FC]">
      {isSuperAdmin || isClassAdmin ? <AdminHeader /> : <Header />}

      <div className="max-w-[1200px] mx-auto">
        <Routes>
          <Route path="/" element={<WelcomePage currentUser={currentUser} />} />
          <Route path="/directory" element={!isSuperAdmin ? <DirectoryPage /> : <Navigate to="/" replace />} />
          <Route path="/events" element={!isSuperAdmin ? <EventsPage /> : <Navigate to="/" replace />} />
          <Route path="/slideshow" element={!isSuperAdmin ? <SlideshowPage /> : <Navigate to="/" replace />} />
          <Route path="/user/:userId" element={!isSuperAdmin ? <UserCommentsPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/user/:userId" element={isSuperAdmin ? <AdminUserProfile /> : <Navigate to="/" replace />} />
          <Route path="/admin/comments" element={isSuperAdmin || isClassAdmin ? <AdminCommentsPage /> : <Navigate to="/" replace />} />
          <Route path="/admin/schools" element={isSuperAdmin ? <SchoolManager /> : <Navigate to="/" replace />} />
          <Route path="/admin/classes" element={isSuperAdmin ? <ClassManager /> : <Navigate to="/" replace />} />
          <Route path="/admin/users" element={isSuperAdmin ? <UsersManager /> : <Navigate to="/" replace />} />
          <Route path="/admin/events" element={isSuperAdmin || isClassAdmin ? <EventsManager /> : <Navigate to="/" replace />} />
          <Route path="/profile" element={!isSuperAdmin ? <UserProfile /> : <Navigate to="/" replace />} />
          <Route path="/comments" element={!isSuperAdmin ? <CommentSection /> : <Navigate to="/" replace />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/feedback" element={FEEDBACK_ENABLED ? <FeedbackPage /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
};

export default AppRouter;