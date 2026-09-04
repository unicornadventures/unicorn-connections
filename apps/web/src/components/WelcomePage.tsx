import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import api from '../api';
import { CurrentUser } from '../types';

interface ClassInfo {
  id: number;
  year: number;
  school_id?: number;
  school_name?: string;
}

const WelcomePage: React.FC<{ currentUser: CurrentUser }> = ({ currentUser }) => {
  const navigate = useNavigate();
  const isSuperAdmin = currentUser?.is_admin || false;
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [daysUntilNextEvent, setDaysUntilNextEvent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSuperAdmin && currentUser?.user_id) {
      fetchClassAndUsers();
    } else {
      setLoading(false);
    }
  }, [currentUser?.user_id, isSuperAdmin]);

  const fetchClassAndUsers = async () => {
    if (!currentUser?.user_id) return;
    try {
      const classResponse = await api.get(`/users/${currentUser.user_id}/class`);
      const userClass = classResponse.data.class;
      setClassInfo(userClass);

      const eventsResponse = userClass.school_id
        ? await api.get(`/schools/${userClass.school_id}/classes/${userClass.id}/events`)
        : { data: { events: [] } };
      const events: Array<{ event_date: string }> = eventsResponse.data.events || [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const future = events
        .map(e => new Date(e.event_date))
        .filter(d => d >= today)
        .sort((a, b) => a.getTime() - b.getTime());
      if (future.length > 0) {
        const diff = Math.ceil((future[0].getTime() - today.getTime()) / 86400000);
        setDaysUntilNextEvent(diff);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (isSuperAdmin) {
    return (
      <div className="max-w-[1200px] mx-auto px-5 py-10">
        <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-2">
          Administrator
        </p>
        <h2 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight">
          Welcome back, {currentUser.first_name}
        </h2>
        <p className="text-sm text-[#64748B] mt-3 max-w-md">
          Use the navigation above to manage schools, classes, and users.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-8">

      {/* Greeting */}
      <div className="mb-6">
        {classInfo && (
          <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-1">
            {classInfo.school_name} · Class of {classInfo.year}
          </p>
        )}
        <h1 className="font-display text-4xl font-bold text-[#0E2240] uppercase tracking-tight">
          Welcome back, {currentUser.first_name}
        </h1>
      </div>

      {/* Countdown Strip */}
      {daysUntilNextEvent !== null && (
        <div className="bg-[#0E2240] rounded-lg px-8 py-8 mb-6 text-center">
          <p className="text-[10px] font-semibold text-white/50 tracking-[0.2em] uppercase mb-3">
            Reunion Countdown
          </p>
          <div className="font-display text-[88px] font-bold text-[#E8A93E] leading-none">
            {daysUntilNextEvent}
          </div>
          <p className="text-white/50 text-xs font-medium tracking-[0.15em] uppercase mt-3">
            days until the reunion
          </p>
        </div>
      )}

      {/* Welcome letter */}
      <div className="bg-white rounded-lg border border-[#E2E8F0] px-6 py-7 sm:px-10 sm:py-9 mb-6 max-w-3xl mx-auto">
        <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-4">
          A Note From DeAnne Dotson
        </p>

        <div className="space-y-4 text-sm text-[#475569] leading-relaxed">
          <p>Hi. DeAnne Dotson here. And welcome to UnicornConnections.org.</p>
          <p>
            This idea was inspired from many different directions, but to keep from writing a
            book here, I'll only share a couple.
          </p>

          <blockquote className="border-l-2 border-[#E8A93E] pl-4 italic text-[#64748B]">
            “I've learned that people will forget what you said, people will forget what you
            did, but people will never forget how you made them feel.”
            <span className="block not-italic text-xs text-[#94A3B8] mt-1">— Maya Angelou</span>
          </blockquote>

          <p>
            My version is that you never know what a person will remember about you. And it
            will most likely be some random, off-the-cuff comment that you made without
            thinking and it never crossed your mind again. But it made an impression and
            decades later, it's still with them.
          </p>
          <p>
            I was lucky enough to have someone share something nice that I had said to them
            once. I want this to be a space where you can let a person know if they did you a
            kindness and you never forgot it, a place where you can share what you thought was
            so cool about a person, something you admired. It can be as simple as, “X always
            looked so put together and had such a unique style about them. I remember wishing
            that I had the guts to be so expressive at that age.”
          </p>
          <p className="font-semibold text-[#0E2240]">
            This space is for GOOD STORIES ONLY. No memory is too small, especially if it's
            stuck with you all these years later.
          </p>

          <div className="bg-[#F6F8FC] rounded-lg px-5 py-4">
            <p className="text-[10px] font-semibold text-[#94A3B8] tracking-[0.15em] uppercase mb-3">
              Prompts
            </p>
            <ul className="space-y-2">
              {[
                'Who did you think was SSSOOOO cool and why?',
                'What did someone say to you one time that helped you thru a rough time or give you a new, different perspective?',
                'Who was quietly doing things for other people and not making a big deal about it.',
              ].map((prompt, i) => (
                <li key={i} className="flex gap-2 text-sm text-[#475569] leading-relaxed">
                  <span className="text-[#E8A93E] font-bold flex-shrink-0">•</span>
                  {prompt}
                </li>
              ))}
            </ul>
          </div>

          <p className="font-semibold text-[#0E2240] uppercase tracking-tight pt-2">Photos!</p>
          <p>
            I have almost no photos from before 1992. Some were stolen from me by an ex in
            Montana and the rest were destroyed in a house fire a year later. About a year ago,
            a friend sent me a photo of me that he had taken at SAP Camp at Mars Hill the summer
            of 1983. I treasure that photo and the friend who thought to send it to me.
          </p>
          <p>
            We all have such big reactions to the photos in the slide shows that we see
            regularly, imagine how fun it would be to see a whole new set of photos of us that
            we've never seen before. I would love for you folks to go through your old photos
            from back then and upload a few to your profile. I ask that you upload photos of
            OTHER PEOPLE. Photos that those folks might not have ever seen.
          </p>
          <p>
            Yes, there is a limit as to how many photos each person can supply (9) due to
            storage limits. My plan is to have these to be playing as a slideshow during our
            Saturday night reunion event.
          </p>

          <p className="text-xs text-[#94A3B8] pt-2 border-t border-[#E2E8F0] mt-2">
            If you have any questions/concerns as to how to use this site, please see the{' '}
            <Link to="/help" className="text-[#E8A93E] font-semibold hover:opacity-80">
              help page
            </Link>{' '}
            and the{' '}
            <Link to="/terms" className="text-[#E8A93E] font-semibold hover:opacity-80">
              terms of use page
            </Link>
            . This site belongs to me, personally, and is private for our class only. This site
            will be active until at least the end of 2026, so that you will have time to
            download the comments that folks have left for you or photos they have uploaded,
            but after that, there is a good chance that I will shut it down as I have no desire
            to maintain a repository in perpetuity.
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div className="mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { to: '/directory', label: 'Directory', blurb: 'See your classmates' },
            { to: '/profile', label: 'Your Profile', blurb: 'Update photos & bio' },
            { to: '/events', label: 'Events', blurb: "What's coming up" },
          ].map(({ to, label, blurb }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="bg-white rounded-lg border border-[#E2E8F0] px-4 py-4 text-left hover:border-[#E8A93E] hover:shadow-sm transition-all duration-200 cursor-pointer"
            >
              <div className="text-sm font-semibold text-[#0E2240]">{label}</div>
              <div className="text-xs text-[#94A3B8] mt-1">{blurb}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WelcomePage;
