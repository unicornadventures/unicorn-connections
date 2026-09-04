import React from 'react';
import { Link } from 'react-router-dom';
import { SITE_BRAND } from '../branding';

const section = (title: string, items: string[]) => (
  <div className="mb-8">
    <h2 className="font-display text-lg font-bold text-[#0E2240] uppercase tracking-tight mb-3">{title}</h2>
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-[#64748B] leading-relaxed">
          <span className="text-[#E8A93E] font-bold flex-shrink-0">•</span>
          {item}
        </li>
      ))}
    </ul>
  </div>
);

const HelpPage: React.FC = () => (
  <div className="max-w-[800px] mx-auto px-5 py-10">
    <div className="mb-8">
      <h1 className="font-display text-3xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">Help</h1>
      <p className="text-sm text-[#64748B]">A quick guide to using {SITE_BRAND}.</p>
    </div>

    <div className="bg-white rounded-lg border border-[#E2E8F0] p-8">
      {section('Your Profile', [
        'Click "Profile" in the top navigation bar to view and edit your profile.',
        'Add your bio to share what you\'ve been up to since graduation.',
        'Add tags (clubs, sports, dorm hall, etc.) to help classmates find you and see what you had in common.',
        'Upload "Then" and "Now" photos — click the photo area to select a file from your device.',
        'You can also add up to 9 additional photos to your personal gallery (with a caption if you wish). Click a gallery photo to view it full-screen.',
      ])}

      {section('Directory', [
        'The Directory shows all members of your class year.',
        'Click on any classmate\'s name or photo to view their profile.',
        'Scroll down on a profile to see the photos they\'ve uploaded and the comments other classmates have left for them.',
      ])}

      {section('Leaving Comments', [
        'Navigate to a classmate\'s profile, scroll down, and type a message in the "Leave a comment" box.',
        'Comments are reviewed before they appear publicly — they show as "Pending" until approved.',
        'You can edit or delete comments you have posted on other people\'s profiles. Click "My Comments" in the top navigation bar to see them all. Editing a comment sends it back for re-approval.',
      ])}

      {section('Events', [
        'Click "Events" in the top navigation to see upcoming reunion events.',
        'Each event shows the date, time, and location.',
        'Event details are managed by your class admin or site administrator.',
      ])}

      {section('Photo Uploads', [
        'Your "Then" photo should be from around your graduation year.',
        'Your "Now" photo shows who you are today.',
        'Photos are stored securely and only visible to logged-in classmates.',
        'Gallery photos appear in a 3-column grid on your profile. Click any photo to open it in full-screen.',
        'Click "Slideshow" in the top navigation to see a random slideshow of all the photos your classmates have uploaded to their profiles.',
      ])}

      {section('Account & Security', [
        'Use the "Forgot password" link on the login page to reset your password via email.',
        'Your email address is only visible to you — other classmates see only your name, bio, and photos.',
      ])}

      <p className="text-sm text-[#64748B] mt-8 pt-6 border-t border-[#E2E8F0]">
        Using {SITE_BRAND} is subject to our{' '}
        <Link to="/terms" className="text-[#E8A93E] font-semibold hover:opacity-80">Terms of Use</Link>.
      </p>
    </div>
  </div>
);

export default HelpPage;
