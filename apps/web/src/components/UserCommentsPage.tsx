import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { galleryAPI } from '../apiClient';
import { Comment, GalleryPhoto } from '../types';

interface UserProfile {
  user: { id: number; email: string };
  profile: {
    first_name: string | null;
    last_name: string | null;
    bio: string | null;
    then_photo_url: string | null;
    now_photo_url: string | null;
    tags: string[] | null;
  };
}

const UserCommentsPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const { currentUser } = useAppContext();
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [lightboxPhoto, setLightboxPhoto] = useState<GalleryPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState<'then' | 'now' | null>(null);

  const isOwnPage = currentUser?.user_id === parseInt(userId || '0');
  // Class admins only ever reach this page for classmates (the profile fetch below
  // 403s otherwise), so this is safe to enable without a separate same-class check.
  const canManagePhotos = isOwnPage || !!currentUser?.is_admin || !!currentUser?.is_class_admin;

  useEffect(() => {
    if (userId && currentUser?.user_id) fetchUserProfileAndComments();
  }, [userId, currentUser?.user_id]);

  const fetchUserProfileAndComments = async () => {
    if (!userId || !currentUser?.user_id) return;
    setLoading(true);
    try {
      const profileResponse = await api.get(`/users/${userId}`, {
        params: { requesterId: currentUser.user_id }
      });
      setUserProfile(profileResponse.data);

      try {
        const galleryResponse = await galleryAPI.list(parseInt(userId), currentUser.user_id);
        setGalleryPhotos(galleryResponse.data.photos || []);
      } catch {
        setGalleryPhotos([]);
      }

      // Directory pages are read-only: everyone sees only published comments.
      // Moderation, editing, and PDF download live on the profile page.
      const commentsResponse = await api.get(`/users/${userId}/comments`);
      setComments(commentsResponse.data.comments || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load user profile.');
      setUserProfile(null);
      setComments([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (photoType: 'then' | 'now', file: File) => {
    if (!file || !canManagePhotos || !userId) return;
    setUploadingPhoto(photoType);
    try {
      const response = await api.post(`/users/${userId}/photo/${photoType}`, undefined, {
        params: { requesterId: currentUser?.user_id }
      });
      const { presignedUrl } = response.data;

      const putRes = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'image/jpeg' }
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

      await fetchUserProfileAndComments();
      setError(null);
    } catch (err: any) {
      setError(`Photo upload failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setUploadingPhoto(null);
    }
  };

  const handlePhotoDelete = async (photoType: 'then' | 'now') => {
    if (!canManagePhotos || !userId) return;
    setUploadingPhoto(photoType);
    try {
      await api.delete(`/users/${userId}/photo/${photoType}`, {
        params: { requesterId: currentUser?.user_id }
      });
      await fetchUserProfileAndComments();
      setError(null);
    } catch (err: any) {
      setError(`Photo delete failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setUploadingPhoto(null);
    }
  };

  const handleAddComment = async () => {
    if (!newCommentText.trim()) { setError('Comment cannot be empty.'); return; }
    if (!currentUser?.user_id || !userId) { setError('User not authenticated.'); return; }
    setSubmitting(true);
    try {
      const response = await api.post(`/users/${userId}/comments`, {
        commenterId: currentUser.user_id,
        content: newCommentText
      });
      setComments([...comments, response.data.comment]);
      setNewCommentText('');
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-5 py-8">
        <div className="text-center text-[#94A3B8] text-sm py-10">Loading profile...</div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="max-w-[900px] mx-auto px-5 py-8">
        <button onClick={() => navigate('/directory')}
          className="mb-5 text-sm text-[#64748B] hover:text-[#0E2240] bg-transparent border-none cursor-pointer transition-colors">
          ← Back to Directory
        </button>
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm">
          {error || 'User not found.'}
        </div>
      </div>
    );
  }

  const { user, profile } = userProfile;
  const displayName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ''}`
    : user.email;

  return (
    <div className="max-w-[900px] mx-auto px-5 py-8">
      <button onClick={() => navigate('/directory')}
        className="mb-6 text-sm text-[#64748B] hover:text-[#0E2240] bg-transparent border-none cursor-pointer transition-colors">
        ← Back to Directory
      </button>

      <div className="bg-white rounded-lg border border-[#E2E8F0] p-8 mb-6">
        <h2 className="font-display text-3xl font-bold text-[#0E2240] uppercase tracking-tight mb-6">
          {displayName}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            { key: 'then' as const, label: 'Then', url: profile?.then_photo_url },
            { key: 'now' as const, label: 'Now', url: profile?.now_photo_url }
          ].map((photo) => (
            <div key={photo.key}>
              {canManagePhotos && (
                <input
                  type="file"
                  id={`comments-photo-${photo.key}`}
                  accept="image/*"
                  onChange={e => { const file = e.target.files?.[0]; if (file) handlePhotoUpload(photo.key, file); e.target.value = ''; }}
                  className="hidden"
                  disabled={uploadingPhoto !== null}
                />
              )}
              <label
                htmlFor={`comments-photo-${photo.key}`}
                style={{ cursor: canManagePhotos ? 'pointer' : 'default' }}
                className={`relative rounded-lg overflow-hidden bg-[#F6F8FC] border border-[#E2E8F0] block group ${canManagePhotos ? 'hover:opacity-80 transition-opacity' : ''}`}
              >
                <div className="absolute top-2 left-2 z-10 bg-[#0E2240]/80 px-2 py-0.5 rounded">
                  <span className="font-display text-xs font-bold text-[#E8A93E] uppercase tracking-wide">{photo.label}</span>
                </div>
                {canManagePhotos && photo.url && (
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); handlePhotoDelete(photo.key); }}
                    disabled={uploadingPhoto !== null}
                    className="absolute top-2 right-2 z-10 w-7 h-7 bg-black/60 text-white rounded-full text-sm font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none disabled:cursor-not-allowed"
                  >
                    ×
                  </button>
                )}
                {photo.url ? (
                  <img src={photo.url} alt={photo.label} className="w-full h-72 object-cover" />
                ) : (
                  <div className="h-72 flex items-center justify-center">
                    <span className="text-sm text-[#94A3B8]">
                      {uploadingPhoto === photo.key ? 'Uploading...' : canManagePhotos ? 'Click to add photo' : 'No photo'}
                    </span>
                  </div>
                )}
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E2E8F0] p-6 mb-6">
        <p className="text-sm text-[#64748B] leading-relaxed whitespace-pre-wrap">
          {profile?.bio || "Tell your classmates what you've been up to for the past 20 years!"}
        </p>
        {profile?.tags && profile.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {profile.tags.map(tag => (
              <span key={tag} className="px-2.5 py-1 bg-[#F6F8FC] border border-[#E2E8F0] text-[#0E2240] rounded-full text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-5">{error}</div>
      )}

      {galleryPhotos.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E2E8F0] p-6 mb-6">
          <h3 className="font-display text-xl font-bold text-[#0E2240] uppercase tracking-tight mb-5">
            Gallery ({galleryPhotos.length})
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {galleryPhotos.map(photo => (
              <div key={photo.id}>
                <div className="relative aspect-square rounded-lg overflow-hidden bg-[#F6F8FC]">
                  {photo.url ? (
                    <img
                      src={photo.url}
                      alt={photo.caption || 'Gallery'}
                      className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setLightboxPhoto(photo)}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#94A3B8] text-xs">No image</div>
                  )}
                </div>
                {photo.caption && (
                  <p className="mt-1.5 text-xs text-[#64748B]">{photo.caption}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E2E8F0] p-6">
        <h3 className="font-display text-xl font-bold text-[#0E2240] uppercase tracking-tight mb-5">
          Comments ({comments.length})
        </h3>

        {!isOwnPage && (
          <div className="bg-[#F6F8FC] border border-[#E2E8F0] rounded-lg p-5 mb-6">
            <h4 className="text-sm font-semibold text-[#0E2240] mb-3">Leave a comment</h4>
            <textarea
              value={newCommentText}
              onChange={e => setNewCommentText(e.target.value)}
              placeholder="Share your message..."
              className="w-full min-h-24 px-3 py-3 border border-[#E2E8F0] rounded text-sm resize-vertical mb-3 focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] disabled:bg-[#F6F8FC] transition-colors"
              disabled={submitting}
            />
            <div className="flex items-center gap-4">
              <button
                onClick={handleAddComment}
                disabled={submitting || !newCommentText.trim()}
                className={`px-5 py-2 rounded text-sm font-semibold transition-opacity ${
                  submitting || !newCommentText.trim()
                    ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed'
                    : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'
                }`}
              >
                {submitting ? 'Posting...' : 'Post comment'}
              </button>
              <p className="text-xs text-[#94A3B8]">Comments appear after review.</p>
            </div>
          </div>
        )}

        {comments.length === 0 ? (
          <div className="py-10 text-center text-[#94A3B8] text-sm bg-[#F6F8FC] rounded-lg border border-[#E2E8F0]">
            No comments yet. Be the first to leave one!
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => {
              const commenterName = comment.commenter_first_name
                ? `${comment.commenter_first_name} ${comment.commenter_last_name || ''}`.trim()
                : null;

              return (
                <div
                  key={comment.id}
                  className={`rounded-lg border p-4 ${!comment.published ? 'bg-[#FFF8EE] border-[#E8A93E]/40' : 'bg-white border-[#E2E8F0]'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {commenterName && (
                      <span className="text-xs font-semibold text-[#0E2240]">{commenterName}</span>
                    )}
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
                  <p className="text-sm text-[#64748B] leading-relaxed break-words">{comment.content}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <button
            onClick={() => setLightboxPhoto(null)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl font-bold border-none cursor-pointer transition-colors"
          >
            ×
          </button>
          <div className="flex flex-col items-center max-w-full" onClick={e => e.stopPropagation()}>
            <img
              src={lightboxPhoto.url || ''}
              alt={lightboxPhoto.caption || 'Gallery photo'}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            {lightboxPhoto.caption && (
              <p className="mt-3 text-sm text-white/80 text-center max-w-[600px]">{lightboxPhoto.caption}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UserCommentsPage;
