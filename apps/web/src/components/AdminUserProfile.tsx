import React from 'react';
import { useParams } from 'react-router-dom';
import UserProfile from './UserProfile';

const AdminUserProfile: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const numericUserId = userId ? parseInt(userId, 10) : undefined;

  return <UserProfile userId={numericUserId} />;
};

export default AdminUserProfile;
