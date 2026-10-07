import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { classAPI } from '../apiClient';
import api from '../api';
import { ClassGalleryPhoto, GalleryOrder } from '../types';

/**
 * Every gallery photo in the signed-in user's class year, paginated.
 *
 * Gallery uploads only — not the then/now portraits the slideshow also shows.
 * Those have no upload timestamp in the schema, so they cannot be placed in a
 * list ordered by upload date; see `ClassesService.getGalleryPhotos`.
 *
 * The page size is the server's default rather than a number chosen here. The
 * API caps it anyway, and every photo on a page costs an S3 signature, so the
 * decision belongs on the side that pays for it.
 */
const PAGE_SIZE = 24;

/** How many numbered buttons the pager shows before it starts eliding. */
const PAGER_WINDOW = 7;

/**
 * The page numbers to render, windowed around the current page.
 *
 * `UsersManager` renders one button per page, which is fine for a 10-row admin
 * table and not for this: a class with a few thousand photos is a hundred-odd
 * buttons wrapping across the screen. Returns page numbers and `'gap'`
 * markers, always including the first and last page so they stay reachable.
 */
function pagerPages(current: number, total: number): (number | 'gap')[] {
  if (total <= PAGER_WINDOW) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const span = Math.floor((PAGER_WINDOW - 3) / 2);
  let start = Math.max(2, current - span);
  let end = Math.min(total - 1, current + span);

  // Keep the window a constant width when it runs into either end, so the
  // pager does not change size as you walk through the pages.
  if (current - span < 2) end = Math.min(total - 1, PAGER_WINDOW - 2);
  if (current + span > total - 1) start = Math.max(2, total - PAGER_WINDOW + 2);

  const pages: (number | 'gap')[] = [1];
  if (start > 2) pages.push('gap');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('gap');
  pages.push(total);
  return pages;
}

const uploaderName = (photo: ClassGalleryPhoto): string => {
  const name = [photo.firstName, photo.lastName].filter(Boolean).join(' ');
  return name || 'A classmate';
};

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
};

type Status = 'loading' | 'ready' | 'error';

const ClassPhotosPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const navigate = useNavigate();

  const [classId, setClassId] = useState<number | null>(null);
  const [classYear, setClassYear] = useState<number | null>(null);
  const [photos, setPhotos] = useState<ClassGalleryPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<GalleryOrder>('newest');
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<ClassGalleryPhoto | null>(null);

  // The user's class, resolved once. Every other page does this the same way.
  useEffect(() => {
    if (!currentUser?.user_id) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await api.get(`/users/${currentUser.user_id}/class`);
        if (cancelled) return;
        const userClass = response.data.class;
        if (!userClass?.id) {
          setError('You are not in a class year yet.');
          setStatus('error');
          return;
        }
        setClassId(userClass.id);
        setClassYear(userClass.year ?? null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Failed to load your class.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.user_id]);

  // One fetch per page/order change. `total` comes back with every page, so
  // the pager resizes without a second request.
  useEffect(() => {
    if (!classId) return;
    let cancelled = false;

    (async () => {
      setStatus('loading');
      try {
        const response = await classAPI.getGalleryPhotos(classId, {
          page,
          pageSize: PAGE_SIZE,
          order,
        });
        if (cancelled) return;
        setPhotos(response.data.photos || []);
        setTotal(response.data.total || 0);
        setError(null);
        setStatus('ready');
      } catch (err: any) {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Failed to load class photos.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [classId, page, order]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const changeOrder = (next: GalleryOrder) => {
    if (next === order) return;
    setOrder(next);
    // Page 3 of newest-first is a different set of photos from page 3 of
    // oldest-first, so staying on it would look like the sort did nothing.
    setPage(1);
  };

  const orderButton = (value: GalleryOrder, label: string) => (
    <button
      onClick={() => changeOrder(value)}
      aria-pressed={order === value}
      className={`px-4 py-2 rounded text-sm font-semibold border-none cursor-pointer transition-opacity ${
        order === value
          ? 'bg-[#0E2240] text-white'
          : 'bg-[#E2E8F0] text-[#64748B] hover:opacity-80'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">
        Class Photos
      </h1>
      <p className="text-sm text-[#64748B] mb-8">
        {classYear ? `Every photo the class of ${classYear} has uploaded.` : 'Every photo your class has uploaded.'}
        {total > 0 && ` ${total} in total.`}
      </p>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {status !== 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-[0.12em]">
              Order
            </span>
            {orderButton('newest', 'Newest first')}
            {orderButton('oldest', 'Oldest first')}
          </div>
          {totalPages > 1 && (
            <span className="text-sm text-[#64748B]">
              Page {page} of {totalPages}
            </span>
          )}
        </div>
      )}

      {status === 'loading' && (
        <p className="py-12 text-center text-sm text-[#94A3B8]">Loading photos…</p>
      )}

      {status === 'ready' && photos.length === 0 && (
        <div className="py-12 text-center text-[#94A3B8] text-sm bg-[#F6F8FC] rounded-lg border border-dashed border-[#E2E8F0]">
          No photos yet. Add some from your profile and they will show up here.
        </div>
      )}

      {status === 'ready' && photos.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
            {photos.map(photo => (
              <div
                key={photo.id}
                className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden"
              >
                {photo.url ? (
                  <button
                    onClick={() => setLightbox(photo)}
                    className="block w-full aspect-square bg-[#F6F8FC] border-none p-0 cursor-pointer"
                  >
                    <img
                      src={photo.url}
                      alt={photo.caption || `Photo from ${uploaderName(photo)}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ) : (
                  // The row exists but its object does not. Shown as a gap
                  // rather than skipped, so the grid matches the page count.
                  <div className="w-full aspect-square bg-[#F6F8FC] flex items-center justify-center text-xs text-[#94A3B8] px-2 text-center">
                    Photo unavailable
                  </div>
                )}
                <div className="p-3">
                  {photo.caption && (
                    <p className="text-sm text-[#0E2240] mb-1 break-words">{photo.caption}</p>
                  )}
                  <button
                    onClick={() => navigate(`/user/${photo.userId}`)}
                    className="text-xs font-semibold text-[#64748B] hover:text-[#0E2240] bg-transparent border-none p-0 cursor-pointer transition-colors"
                  >
                    {uploaderName(photo)}
                  </button>
                  <p className="text-xs text-[#94A3B8]">{formatDate(photo.created_at)}</p>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`px-4 py-2 rounded text-sm font-semibold border-none transition-opacity ${page === 1 ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}
              >
                Previous
              </button>
              {pagerPages(page, totalPages).map((entry, i) =>
                entry === 'gap' ? (
                  <span key={`gap-${i}`} className="px-1 text-sm text-[#94A3B8]">
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    onClick={() => setPage(entry)}
                    aria-current={entry === page ? 'page' : undefined}
                    className={`w-9 h-9 rounded text-sm font-semibold border-none cursor-pointer transition-opacity ${entry === page ? 'bg-[#0E2240] text-white' : 'bg-[#E2E8F0] text-[#64748B] hover:opacity-80'}`}
                  >
                    {entry}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className={`px-4 py-2 rounded text-sm font-semibold border-none transition-opacity ${page === totalPages ? 'bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#0E2240] text-white hover:opacity-90 cursor-pointer'}`}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Lightbox, matching the one on the profile gallery. */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            aria-label="Close photo"
            className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center text-xl font-bold border-none cursor-pointer transition-colors"
          >
            ×
          </button>
          <div className="flex flex-col items-center max-w-full" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox.url || ''}
              alt={lightbox.caption || 'Class photo'}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <p className="mt-3 text-sm text-white/80 text-center max-w-[600px]">
              {lightbox.caption && <span className="block">{lightbox.caption}</span>}
              <span className="text-white/60">
                {uploaderName(lightbox)} · {formatDate(lightbox.created_at)}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassPhotosPage;
