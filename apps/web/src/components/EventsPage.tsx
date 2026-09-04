import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { eventAPI } from '../apiClient';
import { eventInstant, formatEventDateTime, utcToZonedWallTime } from '../utils/eventTime';

interface Event {
  id: number;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  description?: string | null;
  timezone: string | null;
}

interface ClassInfo {
  id: number;
  year: number;
  school_id?: number;
  school_name?: string;
}

const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86400000);

const EventCard: React.FC<{ event: Event; past?: boolean }> = ({ event, past }) => {
  const { dateLabel, timeLabel } = formatEventDateTime(event.event_date, event.event_time, event.timezone);
  const { day, month, year } = dateLabel;
  const timeStr = timeLabel;

  return (
    <div className={`bg-white rounded-lg border p-6 transition-all duration-200 ${past ? 'border-[#E2E8F0] opacity-60' : 'border-[#E2E8F0] hover:border-[#E8A93E] hover:shadow-sm'}`}>
      <div className="flex gap-5">
        <div className={`flex-shrink-0 rounded px-4 py-3 text-center min-w-[72px] ${past ? 'bg-[#94A3B8]' : 'bg-[#0E2240]'}`}>
          <div className="font-display text-3xl font-bold text-[#E8A93E] leading-none">{day}</div>
          <div className="text-[10px] text-white/60 font-semibold tracking-[0.15em] uppercase mt-0.5">{month}</div>
          <div className="text-[10px] text-white/40 tracking-wide">{year}</div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`text-base font-semibold leading-tight mb-2 ${past ? 'text-[#64748B]' : 'text-[#0E2240]'}`}>
            {event.title}
          </h3>
          <div className="space-y-1">
            {timeStr && (
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold text-[#CBD5E1] tracking-[0.12em] uppercase w-14">Time</span>
                <span className="text-sm text-[#64748B]">{timeStr}</span>
              </div>
            )}
            {event.location && (
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-bold text-[#CBD5E1] tracking-[0.12em] uppercase w-14 mt-0.5">Where</span>
                <span className="text-sm text-[#64748B]">{event.location}</span>
              </div>
            )}
          </div>
          {event.description && (
            <p className="text-sm text-[#94A3B8] mt-2.5 leading-relaxed">{event.description}</p>
          )}
        </div>
      </div>
    </div>
  );
};

const EventsPage: React.FC = () => {
  const { currentUser } = useAppContext();
  const [events, setEvents] = useState<Event[]>([]);
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (currentUser?.user_id) fetchEvents();
  }, [currentUser?.user_id]);

  const fetchEvents = async () => {
    if (!currentUser?.user_id) return;
    setLoading(true);
    try {
      const classResponse = await api.get(`/users/${currentUser.user_id}/class`);
      const userClass = classResponse.data.class;
      setClassInfo(userClass);
      const eventsResponse = await eventAPI.listEvents(userClass.school_id, userClass.id);
      setEvents(eventsResponse.data.events || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  };

  // All events on this page belong to one class/school, so they share a timezone.
  const schoolTimezone = events[0]?.timezone ?? null;
  const todayKey = utcToZonedWallTime(new Date(), schoolTimezone).date;

  const withInstant = events.map(e => {
    const instant = eventInstant(e.event_date, e.event_time);
    return { ...e, instant, dateKey: utcToZonedWallTime(instant, schoolTimezone).date };
  });

  const upcoming = withInstant
    .filter(e => e.dateKey >= todayKey)
    .sort((a, b) => a.instant.getTime() - b.instant.getTime());

  const past = withInstant
    .filter(e => e.dateKey < todayKey)
    .sort((a, b) => b.instant.getTime() - a.instant.getTime());

  const nextEvent = upcoming[0] ?? null;
  const daysUntil = nextEvent
    ? daysBetween(new Date(`${todayKey}T00:00:00Z`), new Date(`${nextEvent.dateKey}T00:00:00Z`))
    : null;

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-8">
        <div className="text-center text-[#94A3B8] text-sm py-20">Loading events…</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">

      {/* Header */}
      <div className="mb-8">
        {classInfo && (
          <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-1">
            {classInfo.school_name} · Class of {classInfo.year}
          </p>
        )}
        <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight">
          Events
        </h1>
      </div>

      {error && (
        <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Countdown banner — only when next event is in the future */}
      {daysUntil !== null && (
        <div className="bg-[#0E2240] rounded-lg px-8 py-7 mb-8 flex items-center gap-8">
          <div className="text-center">
            <div className="font-display text-6xl font-bold text-[#E8A93E] leading-none">
              {daysUntil === 0 ? 'TODAY' : daysUntil}
            </div>
            {daysUntil > 0 && (
              <div className="text-[10px] text-white/50 font-semibold tracking-[0.2em] uppercase mt-1">
                day{daysUntil !== 1 ? 's' : ''} away
              </div>
            )}
          </div>
          <div className="border-l border-white/10 pl-8">
            <div className="text-[10px] text-white/40 font-semibold tracking-[0.15em] uppercase mb-1">Next event</div>
            <div className="text-white font-semibold text-lg leading-tight">{nextEvent!.title}</div>
            {nextEvent!.location && (
              <div className="text-white/50 text-sm mt-1">{nextEvent!.location}</div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming events */}
      {upcoming.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E2E8F0] p-10 text-center text-[#94A3B8] text-sm mb-6">
          No upcoming events scheduled.
        </div>
      ) : (
        <div className="space-y-4 mb-8">
          {upcoming.map(event => <EventCard key={event.id} event={event} />)}
        </div>
      )}

      {/* Past events — collapsed by default */}
      {past.length > 0 && (
        <div>
          <button
            onClick={() => setShowPast(v => !v)}
            className="flex items-center gap-2 text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-4 hover:text-[#64748B] transition-colors"
          >
            <span>{showPast ? '▾' : '▸'}</span>
            Past events ({past.length})
          </button>
          {showPast && (
            <div className="space-y-4">
              {past.map(event => <EventCard key={event.id} event={event} past />)}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default EventsPage;
