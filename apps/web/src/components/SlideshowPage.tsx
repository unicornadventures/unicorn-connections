import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { classAPI } from '../apiClient';
import api from '../api';
import { SlideshowPhoto } from '../types';

const DISPLAY_DURATION_MS = 4000;
const FADE_DURATION_MS = 1000;
const PRELOAD_TIMEOUT_MS = 8000;

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function preloadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), PRELOAD_TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

const SlideshowPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const navigate = useNavigate();
  const [layerUrls, setLayerUrls] = useState<[string | null, string | null]>([null, null]);
  const [activeLayer, setActiveLayer] = useState<0 | 1>(0);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser?.user_id) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
    };

    const fetchClassPhotos = async (): Promise<SlideshowPhoto[]> => {
      const classResponse = await api.get(`/users/${currentUser.user_id}/class`);
      const userClass = classResponse.data.class;
      const photosResponse = await classAPI.getPhotos(userClass.id, currentUser.user_id);
      return (photosResponse.data.photos || []).filter((p) => !!p.url);
    };

    const run = async () => {
      // At the start of each loop, re-fetch (to pick up new uploads) and reshuffle.
      let queue: SlideshowPhoto[];
      try {
        queue = shuffle(await fetchClassPhotos());
      } catch (err: any) {
        if (cancelled) return;
        setErrorMessage(err.response?.data?.error || 'Failed to load slideshow photos.');
        setStatus('error');
        return;
      }
      if (cancelled) return;
      if (queue.length === 0) {
        setStatus('empty');
        return;
      }

      let index = -1;
      let active: 0 | 1 = 0;

      // Steps to the next photo in the queue, refetching/reshuffling on wraparound
      // and skipping any photo that fails to load (e.g. an expired S3 URL).
      const advance = async (): Promise<string | null> => {
        for (let attempts = 0; attempts < queue.length; attempts++) {
          index += 1;
          if (index >= queue.length) {
            const fresh = shuffle(await fetchClassPhotos());
            if (cancelled) return null;
            if (fresh.length === 0) return null;
            queue = fresh;
            index = 0;
          }
          const candidate = queue[index];
          if (await preloadImage(candidate.url)) return candidate.url;
        }
        return null;
      };

      const firstUrl = await advance();
      if (cancelled) return;
      if (!firstUrl) {
        setStatus('empty');
        return;
      }
      setLayerUrls([firstUrl, null]);
      setActiveLayer(0);
      setStatus('ready');

      const tick = () => {
        after(DISPLAY_DURATION_MS, async () => {
          const nextUrl = await advance();
          if (cancelled) return;
          if (!nextUrl) {
            setStatus('empty');
            return;
          }
          const idle: 0 | 1 = active === 0 ? 1 : 0;
          setLayerUrls((prev) => {
            const next: [string | null, string | null] = [...prev];
            next[idle] = nextUrl;
            return next;
          });
          // Let the hidden layer paint with its new image before animating opacity,
          // otherwise the browser has no prior frame to transition from.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (cancelled) return;
              active = idle;
              setActiveLayer(idle);
            });
          });
          after(FADE_DURATION_MS, tick);
        });
      };

      tick();
    };

    run();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [currentUser?.user_id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center overflow-hidden">
      <button
        onClick={() => navigate('/')}
        className="absolute top-5 right-5 z-10 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white text-xl leading-none flex items-center justify-center transition-colors"
        aria-label="Close slideshow"
      >
        &times;
      </button>

      {status === 'loading' && <p className="text-white/70 text-sm">Loading slideshow…</p>}
      {status === 'empty' && <p className="text-white/70 text-sm">No photos have been uploaded yet.</p>}
      {status === 'error' && <p className="text-white/70 text-sm">{errorMessage}</p>}

      {status === 'ready' && layerUrls[0] && (
        <img
          src={layerUrls[0]}
          alt=""
          className="absolute inset-0 w-full h-full object-contain transition-opacity ease-in-out"
          style={{ transitionDuration: `${FADE_DURATION_MS}ms`, opacity: activeLayer === 0 ? 1 : 0 }}
        />
      )}
      {status === 'ready' && layerUrls[1] && (
        <img
          src={layerUrls[1]}
          alt=""
          className="absolute inset-0 w-full h-full object-contain transition-opacity ease-in-out"
          style={{ transitionDuration: `${FADE_DURATION_MS}ms`, opacity: activeLayer === 1 ? 1 : 0 }}
        />
      )}
    </div>
  );
};

export default SlideshowPage;
