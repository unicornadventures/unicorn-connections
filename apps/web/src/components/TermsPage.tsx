import React from 'react';
import { SITE_BRAND } from '../branding';

const section = (title: string, paragraphs: string[]) => (
  <div className="mb-8">
    <h2 className="font-display text-lg font-bold text-[#0E2240] uppercase tracking-tight mb-3">{title}</h2>
    <div className="space-y-3">
      {paragraphs.map((text, i) => (
        <p key={i} className="text-sm text-[#64748B] leading-relaxed">{text}</p>
      ))}
    </div>
  </div>
);

// Rendered both inside the authenticated layout and standalone for logged-out
// visitors arriving from the registration/login pages, so it carries its own bg.
const TermsPage: React.FC = () => (
  <div className="min-h-screen bg-[#F6F8FC]">
  <div className="max-w-[800px] mx-auto px-5 py-10">
    <div className="mb-8">
      <h1 className="font-display text-3xl font-bold text-[#0E2240] uppercase tracking-tight mb-2">Terms of Use</h1>
      <p className="text-sm text-[#64748B]">Last updated: July 31, 2026</p>
    </div>

    <div className="bg-white rounded-lg border border-[#E2E8F0] p-8 space-y-0">
      {section('1. Acceptance of These Terms', [
        `${SITE_BRAND} is a private community for alumni to reconnect with their classmates. By creating an account or using the site, you agree to these Terms of Use. If you do not agree, please do not use the site.`,
      ])}

      {section('2. Who May Join', [
        'Membership is limited to members of the participating graduating classes and people invited by a class or site administrator. When you register or claim an account, you must identify yourself truthfully and provide accurate information.',
        'You are responsible for keeping your password confidential and for all activity that happens under your account. Tell an administrator right away if you believe your account has been used without your permission.',
      ])}

      {section('3. Your Content', [
        `You keep ownership of everything you post — your bio, comments, and photos. By posting, you give ${SITE_BRAND} permission to store and display that content to other signed-in members of the community, which is how the site works.`,
        'You are responsible for what you post. Only upload photos you have the right to share, and be thoughtful about pictures that include other people — if someone pictured asks that a photo be removed, we may remove it.',
        'Comments left on a classmate\'s page are reviewed before they appear publicly. Submitting a comment does not guarantee it will be published, and edited comments go back for re-review.',
      ])}

      {section('4. Community Standards', [
        'This site exists so classmates can share memories and stay in touch. Do not post anything harassing, threatening, defamatory, obscene, or unlawful. Do not impersonate another person, misrepresent who you are, or post content that infringes someone else\'s rights.',
        'Do not collect, scrape, or share other members\' personal information outside the site, and do not use the directory for commercial solicitation, advertising, or spam.',
      ])}

      {section('5. Privacy', [
        'Profiles, photos, and comments are visible only to signed-in members — they are not public on the internet. Your email address is not shown to other members.',
        'We do not sell the information we collect. Your profile, photos, comments, and email address are used only to run this community — they are never sold, rented, or shared with third parties for marketing or advertising.',
        'Please extend the same courtesy: what classmates share here is for this community, not for redistribution.',
      ])}

      {section('6. Moderation and Account Termination', [
        'Class and site administrators may review, unpublish, or remove content, and may suspend or remove accounts, at their discretion — particularly for conduct that violates these terms. If your account is removed, your profile and content may be deleted.',
        'You may stop using the site at any time and may ask an administrator to delete your account and content.',
      ])}

      {section('7. Disclaimers', [
        `${SITE_BRAND} is a volunteer-run community service provided "as is" and "as available," without warranties of any kind. We do not guarantee the site will always be available, error-free, or that content posted by members is accurate.`,
        `To the fullest extent permitted by law, ${SITE_BRAND} and its administrators are not liable for any indirect, incidental, or consequential damages arising from your use of the site or from content posted by other members.`,
      ])}

      {section('8. Changes to These Terms', [
        'We may update these Terms of Use from time to time. The "Last updated" date above shows the current version. Continuing to use the site after changes take effect means you accept the updated terms.',
      ])}

      {section('9. Contact', [
        'Questions about these terms or about content on the site? Contact your class administrator or the site administrator.',
      ])}
    </div>
  </div>
  </div>
);

export default TermsPage;
