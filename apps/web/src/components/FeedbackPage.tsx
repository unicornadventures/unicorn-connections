import React, { useEffect, useState } from 'react';
import { feedbackAPI } from '../apiClient';
import { Feedback } from '../types';

const FeedbackPage: React.FC = () => {
  const [feedbackList, setFeedbackList] = useState<Feedback[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadFeedback = async () => {
    try {
      const res = await feedbackAPI.getMyFeedback();
      setFeedbackList(res.data.feedback);
    } catch (err) {
      console.error('Failed to load feedback:', err);
      setError('Could not load your feedback.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedback();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await feedbackAPI.createFeedback(comment.trim());
      setComment('');
      setSuccess('Thanks! Your feedback has been submitted.');
      await loadFeedback();
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      setError('Could not submit your feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

  return (
    <div className="max-w-[800px] mx-auto px-5 py-10">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">Feedback</h1>
        <p className="text-sm text-[#64748B]">
          Have a suggestion or a general comment about the site? We'd love to hear it.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-[#E2E8F0] p-6 mb-8">
        <label htmlFor="feedback-comment" className="block font-display text-lg font-bold text-[#0E2240] uppercase tracking-tight mb-3">
          Leave feedback
        </label>
        <textarea
          id="feedback-comment"
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Share a suggestion or comment..."
          rows={4}
          className="w-full border border-[#E2E8F0] rounded-lg p-3 text-sm text-[#0E2240] placeholder-[#94A3B8] focus:outline-none focus:border-[#E8A93E] resize-y"
        />
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {success && <p className="text-sm text-green-700 mt-2">{success}</p>}
        <div className="flex justify-end mt-3">
          <button
            type="submit"
            disabled={!comment.trim() || submitting}
            className="bg-[#0E2240] text-white text-sm font-medium px-6 py-2 rounded-lg hover:bg-[#1a3358] transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </form>

      <div>
        <h2 className="font-display text-lg font-bold text-[#0E2240] uppercase tracking-tight mb-3">
          Your feedback
        </h2>
        {loading ? (
          <p className="text-sm text-[#64748B]">Loading...</p>
        ) : feedbackList.length === 0 ? (
          <p className="text-sm text-[#64748B]">You haven't left any feedback yet.</p>
        ) : (
          <div className="space-y-3">
            {feedbackList.map(item => (
              <div key={item.id} className="bg-white rounded-lg border border-[#E2E8F0] p-4">
                <p className="text-sm text-[#0E2240] leading-relaxed whitespace-pre-wrap">{item.comment}</p>
                <p className="text-xs text-[#94A3B8] mt-2">{formatDate(item.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbackPage;
