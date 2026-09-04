import React, { useState, useEffect } from 'react';
import { adminSchoolAPI, adminClassAPI, eventAPI, userAPI } from '../apiClient';
import { useAppContext } from '../context/AppContext';
import { SchoolClass } from '../types';
import { zonedWallTimeToUtcISOString, formatEventDateTime, eventInstant, utcToZonedWallTime } from '../utils/eventTime';

interface School {
  id: number;
  name: string;
}

interface Event {
  id: number;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  description: string | null;
  timezone: string | null;
}

interface EventForm {
  title: string;
  date: string;
  time: string;
  location: string;
  description: string;
}

const EMPTY_FORM: EventForm = { title: '', date: '', time: '', location: '', description: '' };

const EventsManager: React.FC = () => {
  const { currentUser } = useAppContext();
  const isClassAdminOnly = !!currentUser?.is_class_admin && !currentUser?.is_admin;

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<number | null>(null);
  const [schoolTimezone, setSchoolTimezone] = useState<string | null>(null);
  const [linkedClasses, setLinkedClasses] = useState<SchoolClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [ownClassYear, setOwnClassYear] = useState<number | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (isClassAdminOnly) return;
    adminSchoolAPI.getSchools().then(r => setSchools(r.data.schools || [])).catch(() => {});
  }, [isClassAdminOnly]);

  useEffect(() => {
    if (isClassAdminOnly) return;
    if (!selectedSchoolId) { setLinkedClasses([]); setSelectedClassId(null); return; }
    adminClassAPI.getClasses(selectedSchoolId)
      .then(r => {
        const classes = r.data.classes || [];
        setLinkedClasses(classes);
        setSelectedClassId(classes[0]?.id ?? null);
      })
      .catch(() => setLinkedClasses([]));
  }, [selectedSchoolId, isClassAdminOnly]);

  useEffect(() => {
    if (!isClassAdminOnly || !currentUser) return;
    userAPI.getUserClass(currentUser.id)
      .then(r => {
        const cls = r.data.class;
        setOwnClassYear(cls.year);
        setSelectedSchoolId(cls.school_id);
        setSelectedClassId(cls.id);
      })
      .catch(() => setError('Failed to load your class.'));
  }, [isClassAdminOnly, currentUser]);

  useEffect(() => {
    if (!selectedClassId) { setEvents([]); return; }
    fetchEvents(selectedClassId);
  }, [selectedClassId]);

  useEffect(() => {
    if (!selectedSchoolId) { setSchoolTimezone(null); return; }
    adminSchoolAPI.getSchool(selectedSchoolId)
      .then(r => setSchoolTimezone(r.data.school.timezone))
      .catch(() => setSchoolTimezone(null));
  }, [selectedSchoolId]);

  const fetchEvents = async (classId: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await eventAPI.listEvents(selectedSchoolId!, classId);
      setEvents(r.data.events || []);
    } catch {
      setError('Failed to load events.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchoolId || !selectedClassId || !form.title.trim() || !form.date) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        event_date: zonedWallTimeToUtcISOString(form.date, form.time || '12:00', schoolTimezone),
        location: form.location.trim() || undefined,
        description: form.description.trim() || undefined,
      };
      if (editingId !== null) {
        await eventAPI.updateEvent(editingId, payload);
      } else {
        await eventAPI.createEvent(selectedSchoolId, selectedClassId, payload);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await fetchEvents(selectedClassId);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save event.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (ev: Event) => {
    setEditingId(ev.id);
    const { date: dateStr, time: timeStr } = utcToZonedWallTime(
      eventInstant(ev.event_date, ev.event_time),
      ev.timezone ?? schoolTimezone
    );
    setForm({
      title: ev.title,
      date: dateStr,
      time: timeStr,
      location: ev.location || '',
      description: ev.description || '',
    });
  };

  const handleDelete = async (id: number) => {
    if (!selectedClassId) return;
    setDeletingId(id);
    try {
      await eventAPI.deleteEvent(id);
      setEvents(prev => prev.filter(e => e.id !== id));
      if (editingId === id) { setEditingId(null); setForm(EMPTY_FORM); }
    } catch {
      setError('Failed to delete event.');
    } finally {
      setDeletingId(null);
    }
  };

  const cancelEdit = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const selectedClass = linkedClasses.find(c => c.id === selectedClassId);
  const selectedClassYear = isClassAdminOnly ? ownClassYear : selectedClass?.year;

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">
      <div className="mb-8">
        <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-1">Admin</p>
        <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight">Events</h1>
      </div>

      {/* School + Class selectors (super admin only — class admins are locked to their own class) */}
      {!isClassAdminOnly && (
        <div className="flex gap-4 mb-8 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1.5">School</label>
            <select
              className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm text-[#0E2240] focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E]"
              value={selectedSchoolId ?? ''}
              onChange={e => setSelectedSchoolId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select a school…</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {linkedClasses.length > 0 && (
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1.5">Class Year</label>
              <select
                className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm text-[#0E2240] focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E]"
                value={selectedClassId ?? ''}
                onChange={e => setSelectedClassId(e.target.value ? Number(e.target.value) : null)}
              >
                {linkedClasses.map(c => (
                  <option key={c.id} value={c.id}>Class of {c.year}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {!selectedClassId ? (
        <div className="bg-white rounded-lg border border-[#E2E8F0] p-10 text-center text-[#94A3B8] text-sm">
          {isClassAdminOnly ? 'Loading your class…' : 'Select a school and class year to manage events.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Events list — 2/3 */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-bold text-[#0E2240] uppercase tracking-wide">
                {selectedClassYear ? `Class of ${selectedClassYear}` : 'Events'}
              </h2>
              <span className="text-xs text-[#94A3B8]">{events.length} event{events.length !== 1 ? 's' : ''}</span>
            </div>

            {error && (
              <div className="bg-[#FFEBEE] text-[#C62828] border border-[#EF5350] rounded px-4 py-3 text-sm mb-4">
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-center text-[#94A3B8] text-sm py-10">Loading…</div>
            ) : events.length === 0 ? (
              <div className="bg-white rounded-lg border border-[#E2E8F0] p-10 text-center text-[#94A3B8] text-sm">
                No events yet. Add one using the form.
              </div>
            ) : (
              <div className="space-y-3">
                {events.map(ev => {
                  const { dateLabel, timeLabel } = formatEventDateTime(ev.event_date, ev.event_time, ev.timezone);
                  const isEditing = editingId === ev.id;
                  return (
                    <div
                      key={ev.id}
                      className={`bg-white rounded-lg border p-5 transition-all duration-150 ${isEditing ? 'border-[#E8A93E] shadow-sm' : 'border-[#E2E8F0]'}`}
                    >
                      <div className="flex gap-4">
                        <div className="flex-shrink-0 bg-[#0E2240] rounded px-3 py-3 text-center min-w-[60px]">
                          <div className="font-display text-2xl font-bold text-[#E8A93E] leading-none">{dateLabel.day}</div>
                          <div className="text-[9px] text-white/60 font-semibold tracking-[0.12em] uppercase mt-0.5">{dateLabel.month}</div>
                          <div className="text-[9px] text-white/40 tracking-wide">{dateLabel.year}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-[#0E2240] text-sm leading-tight">{ev.title}</div>
                          <div className="mt-1.5 space-y-0.5">
                            {timeLabel && (
                              <div className="text-xs text-[#64748B]">{timeLabel}</div>
                            )}
                            {ev.location && (
                              <div className="text-xs text-[#64748B] truncate">{ev.location}</div>
                            )}
                            {ev.description && (
                              <div className="text-xs text-[#94A3B8] line-clamp-2 mt-1">{ev.description}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => handleEdit(ev)}
                            className="text-[10px] font-semibold text-[#64748B] hover:text-[#0E2240] uppercase tracking-wide transition-colors px-2 py-1 rounded hover:bg-[#F1F5F9]"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(ev.id)}
                            disabled={deletingId === ev.id}
                            className="text-[10px] font-semibold text-[#EF5350] hover:text-[#C62828] uppercase tracking-wide transition-colors px-2 py-1 rounded hover:bg-[#FFEBEE] disabled:opacity-40"
                          >
                            {deletingId === ev.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Form — 1/3 */}
          <div>
            <div className="bg-white rounded-lg border border-[#E2E8F0] p-5">
              <h3 className="font-display text-sm font-bold text-[#0E2240] uppercase tracking-wide mb-4">
                {editingId !== null ? 'Edit Event' : 'Add Event'}
              </h3>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1">Title *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    required
                    placeholder="e.g. 40th Reunion Dinner"
                    className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1">Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    required
                    className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1">Time</label>
                  <input
                    type="time"
                    value={form.time}
                    onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1">Location</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="e.g. Grand Ballroom, Hotel Name"
                    className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#94A3B8] tracking-[0.12em] uppercase mb-1">Description</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder="Additional details…"
                    className="w-full border border-[#E2E8F0] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#E8A93E] focus:ring-1 focus:ring-[#E8A93E] resize-none"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-[#E8A93E] text-[#0E2240] font-bold text-xs uppercase tracking-[0.1em] py-2.5 rounded hover:bg-[#d4982f] transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : editingId !== null ? 'Save Changes' : 'Add Event'}
                  </button>
                  {editingId !== null && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="px-3 py-2.5 border border-[#E2E8F0] rounded text-xs font-semibold text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

export default EventsManager;
