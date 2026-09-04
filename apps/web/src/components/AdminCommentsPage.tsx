import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { commentAPI } from '../apiClient';
import { Comment } from '../types';
import ConfirmModal from './ConfirmModal';

interface CommentWithProfile extends Comment {
  target_user_profile?: {
    first_name: string | null;
    last_name: string | null;
  };
}

const AdminCommentsPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const [comments, setComments] = useState<CommentWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: number | null }>({ isOpen: false, id: null });

  useEffect(() => {
    fetchAllUnpublishedComments();
  }, []);

  const fetchAllUnpublishedComments = async () => {
    if (!currentUser?.user_id) return;
    setLoading(true);
    try {
      const response = await commentAPI.getAllPendingComments(currentUser.user_id);
      const comments: CommentWithProfile[] = (response.data.comments || []).map((c: any) => ({
        ...c,
        target_user_profile: { first_name: c.target_first_name, last_name: c.target_last_name }
      }));

      setComments(comments);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load comments.');
    } finally {
      setLoading(false);
    }
  };

  const handlePublishComment = async (commentId: number) => {
    setActionLoading(commentId);
    try {
      await api.put(`/comments/${commentId}`, { published: true, requesterId: currentUser?.user_id });
      setComments(comments.filter(c => c.id !== commentId));
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to publish comment.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteComment = async () => {
    if (deleteModal.id === null) return;
    const commentId = deleteModal.id;
    setActionLoading(commentId);
    try {
      await api.delete(`/comments/${commentId}`, {
        params: { requesterId: currentUser?.user_id }
      });
      setComments(comments.filter(c => c.id !== commentId));
      setError(null);
      setDeleteModal({ isOpen: false, id: null });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete comment.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="max-w-[900px] mx-auto px-5 py-8">
      <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight mb-1">
        Pending Comments
      </h1>
      <p className="text-sm text-[#64748B] mb-6">Review and approve comments before they appear on user profiles</p>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-[#94A3B8] text-sm">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="py-12 text-center bg-white rounded-lg border border-[#E2E8F0]">
          <p className="text-[#64748B] font-semibold">All caught up</p>
          <p className="text-sm text-[#94A3B8] mt-1">No pending comments to moderate.</p>
        </div>
      ) : (
        <div className="space-y-4 max-h-[calc(100vh-250px)] overflow-y-auto">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-white rounded-lg border border-[#E8A93E]/30 p-5 hover:border-[#E8A93E] transition-colors"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-[#0E2240]">
                      {comment.target_user_profile?.first_name} {comment.target_user_profile?.last_name}
                    </span>
                    <span className="px-2 py-0.5 bg-[#E8A93E] text-[#0E2240] text-[10px] font-bold uppercase tracking-wide rounded">
                      Pending
                    </span>
                  </div>
                  <span className="text-xs text-[#94A3B8]">
                    {new Date(comment.created_at).toLocaleDateString()} at{' '}
                    {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              <div className="bg-[#F6F8FC] rounded px-4 py-3 mb-4 border border-[#E2E8F0]">
                <p className="text-sm text-[#64748B] leading-relaxed break-words">{comment.content}</p>
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeleteModal({ isOpen: true, id: comment.id })}
                  disabled={actionLoading === comment.id}
                  className={`px-4 py-2 rounded text-sm font-semibold border-none cursor-pointer transition-opacity ${
                    actionLoading === comment.id
                      ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                      : 'bg-[#f44336] text-white hover:opacity-90'
                  }`}
                >
                  Delete
                </button>
                <button
                  onClick={() => handlePublishComment(comment.id)}
                  disabled={actionLoading === comment.id}
                  className={`px-4 py-2 rounded text-sm font-semibold border-none cursor-pointer transition-opacity ${
                    actionLoading === comment.id
                      ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                      : 'bg-[#0E2240] text-white hover:opacity-90'
                  }`}
                >
                  {actionLoading === comment.id ? 'Publishing...' : 'Publish'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Delete Comment"
        message="Are you sure you want to delete this comment? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
        onConfirm={handleDeleteComment}
        onCancel={() => setDeleteModal({ isOpen: false, id: null })}
      />
    </div>
  );
};

export default AdminCommentsPage;
