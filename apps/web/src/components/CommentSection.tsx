import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { Comment } from '../types';
import ConfirmModal from './ConfirmModal';

// "My Comments" page: every comment the signed-in user has left on classmates'
// pages, with edit and delete. Directory pages are read-only, so this is the
// one place authors manage their own comments.
const CommentSection: React.FC = () => {
  const { currentUser } = useAppContext();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: number | null }>({ isOpen: false, id: null });

  const fetchComments = async () => {
    if (!currentUser?.user_id) return;
    setLoading(true);
    try {
      const response = await api.get(`/comments/my-comments/${currentUser.user_id}`);
      setComments(response.data.comments || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load comments.');
      setComments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser?.user_id) fetchComments();
  }, [currentUser?.user_id]);

  const handleUpdateComment = async (commentId: number) => {
    if (!editingText.trim()) { setError('Comment cannot be empty.'); return; }
    setSubmitting(true);
    try {
      const response = await api.put(`/comments/${commentId}`, { content: editingText, requesterId: currentUser?.user_id });
      setComments(comments.map(c => c.id === commentId ? { ...c, ...response.data.comment } : c));
      setEditingId(null);
      setEditingText('');
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update comment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async () => {
    if (deleteModal.id === null) return;
    const commentId = deleteModal.id;
    try {
      await api.delete(`/comments/${commentId}`, {
        params: { requesterId: currentUser?.user_id }
      });
      setComments(comments.filter(c => c.id !== commentId));
      setError(null);
      setDeleteModal({ isOpen: false, id: null });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete comment.');
    }
  };

  const targetName = (comment: Comment) =>
    comment.target_first_name
      ? `${comment.target_first_name} ${comment.target_last_name || ''}`.trim()
      : 'a classmate';

  const inputClass = 'w-full border border-[#E2E8F0] rounded text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] transition-colors disabled:bg-[#F6F8FC]';

  return (
    <div className="max-w-[800px] mx-auto px-5 py-8">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">
          My Comments ({comments.length})
        </h1>
        <p className="text-sm text-[#64748B]">
          Comments you've left on classmates' pages. Edits go back for review before reappearing.
        </p>
      </div>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="py-5 text-center text-[#94A3B8] text-sm">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="py-10 text-center bg-white rounded-lg border border-[#E2E8F0]">
            <p className="text-sm text-[#94A3B8] mb-1">You haven't posted any comments yet.</p>
            <p className="text-sm text-[#94A3B8]">
              Visit the <Link to="/directory" className="text-[#E8A93E] font-semibold hover:opacity-70">Directory</Link> to leave one on a classmate's page.
            </p>
          </div>
        ) : (
          comments.map(comment => (
            <div
              key={comment.id}
              className={`rounded-lg border p-4 ${!comment.published ? 'bg-[#FFF8EE] border-[#E8A93E]/40' : 'bg-white border-[#E2E8F0]'}`}
            >
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-xs font-semibold text-[#0E2240]">
                  On{' '}
                  <Link to={`/user/${comment.target_user_id}`} className="text-[#E8A93E] hover:opacity-70 transition-opacity">
                    {targetName(comment)}
                  </Link>
                  's page
                </span>
                <span className="text-xs text-[#94A3B8]">
                  {new Date(comment.created_at).toLocaleDateString()} at{' '}
                  {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {!comment.published && (
                  <span className="px-2 py-0.5 bg-[#E8A93E] text-[#0E2240] text-[10px] font-bold uppercase tracking-wide rounded">
                    Pending
                  </span>
                )}
              </div>

              {editingId === comment.id ? (
                <div className="mt-2">
                  <textarea
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    className={`${inputClass} min-h-20 resize-vertical p-3 mb-3`}
                    disabled={submitting}
                    autoFocus
                  />
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => handleUpdateComment(comment.id)}
                      disabled={submitting}
                      className="px-4 py-2 bg-[#0E2240] text-white rounded text-xs font-semibold hover:opacity-90 disabled:bg-[#E2E8F0] disabled:text-[#94A3B8] disabled:cursor-not-allowed transition-opacity cursor-pointer"
                    >
                      {submitting ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditingText(''); }}
                      className="px-4 py-2 bg-[#E2E8F0] text-[#64748B] rounded text-xs font-semibold hover:opacity-80 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <span className="text-[10px] text-[#94A3B8]">Edits require re-approval</span>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[#64748B] leading-relaxed break-words mt-1 mb-3">
                    {comment.content}
                  </p>
                  <div className="flex gap-4">
                    <button
                      onClick={() => { setEditingId(comment.id); setEditingText(comment.content); }}
                      className="text-xs font-semibold text-[#E8A93E] hover:opacity-70 bg-transparent border-none cursor-pointer p-0 transition-opacity"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteModal({ isOpen: true, id: comment.id })}
                      className="text-xs font-semibold text-[#f44336] hover:opacity-70 bg-transparent border-none cursor-pointer p-0 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

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

export default CommentSection;
