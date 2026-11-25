// Terms of Service and Privacy Policy. Business details come from server settings (LEGAL_* variables).
// This is a starting template, not legal advice: have it reviewed for the countries you sell in.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner } from '../components/ui.jsx';

function useLegal() {
  const [d, setD] = useState(null);
  useEffect(() => {
    api.get('/api/auth/legal').then(setD).catch(() => setD({ business_name: '[Your business name]', contact_email: '[contact email]', governing_law: '[country / state]', effective_date: '[date]' }));
  }, []);
  return d;
}

function LegalShell({ title, d, children }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return (
    <div className="legal-wrap">
      <article className="legal card">
        <a href="/home" className="legal-back">← Proj4D</a>
        <h1>{title}</h1>
        {d ? (
          <>
            <p className="muted">Effective {d.effective_date} · {d.business_name}</p>
            {children}
          </>
        ) : (
          <Spinner label="Loading…" />
        )}
      </article>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <Link to="/terms">Terms of Service</Link>
      <span aria-hidden="true">·</span>
      <Link to="/privacy">Privacy Policy</Link>
    </footer>
  );
}

const Mail = ({ d }) => <a href={`mailto:${d.contact_email}`}>{d.contact_email}</a>;

export function TermsPage() {
  const d = useLegal();
  return (
    <LegalShell title="Terms of Service" d={d}>
      {d && (
        <>
          <p>
            These terms are an agreement between {d.business_name} ("we", "us") and the company that registers a Proj4D account ("Customer", "you"). By creating an
            account or using Proj4D, you agree to them on behalf of your company. If you don't agree, don't use the service.
          </p>

          <h2>1. The service</h2>
          <p>
            Proj4D is a web application for tracking construction project progress: importing work programmes, recording daily site reports (activities, progress,
            weather, resources, deliveries, visitors, issues and photos), calculating progress and producing PDF reports. Optional AI features help fill in reports,
            write summaries, read programme files and suggest risks.
          </p>

          <h2>2. Accounts</h2>
          <ul>
            <li>The person who signs up becomes the company admin and confirms they are authorised to accept these terms for the company.</li>
            <li>Company admins decide who in the company has access and are responsible for their users' activity.</li>
            <li>Keep passwords confidential and tell us promptly at <Mail d={d} /> if you suspect unauthorised access.</li>
            <li>You must provide accurate information and be at least 18 years old.</li>
          </ul>

          <h2>3. Your data</h2>
          <p>
            You own everything your company puts into Proj4D ("Customer Data"). You give us permission to store, process, back up and display Customer Data only as
            needed to provide, secure and support the service, including sending it to the service providers listed in our <Link to="/privacy">Privacy Policy</Link>.
            You are responsible for having the right to upload Customer Data, including photos and the names of people (such as visitors) that appear in reports.
          </p>

          <h2>4. Acceptable use</h2>
          <p>You must not:</p>
          <ul>
            <li>try to access another company's data or bypass security or usage limits;</li>
            <li>upload malware, or content that is unlawful or infringes someone else's rights;</li>
            <li>use the service to send spam or to harm the service or other customers;</li>
            <li>resell or provide the service to third parties unless we agree in writing.</li>
          </ul>

          <h2>5. AI features</h2>
          <p>
            AI-generated content (summaries, form entries filled from notes, activities read from programmes, and insights) can be incomplete or wrong. Review it before
            relying on it. Proj4D does not replace professional judgement, contract administration, or the safety, quality and statutory records you are required to
            keep.
          </p>

          <h2>6. Plans, trial and payment</h2>
          <ul>
            <li>Proj4D has a Free plan and paid plans. What each plan includes and its price are shown on the Plan &amp; billing page when you subscribe.</li>
            <li>New companies get a 7-day free trial of all features. No card is needed. When the trial ends, the company moves to the Free plan unless it subscribes.</li>
            <li>Paid plans are billed in advance, monthly or yearly, through our payment provider Paystack, and <b>renew automatically</b> at the end of each period until cancelled.</li>
            <li>You can cancel at any time from the Plan &amp; billing page. You keep the paid plan until the end of the period already paid for; payments already made are not refunded except where the law requires.</li>
            <li>When you change to a different paid plan, the new plan starts immediately and is charged in full; unused time on the previous plan is not refunded.</li>
            <li>If a renewal payment fails we retry for a few days, then move the company to the Free plan. If the company is over the Free plan's limits, nothing is deleted: extra members are paused until the plan is upgraded.</li>
            <li>We may change prices for future billing periods with at least 30 days' notice. Prices do not include taxes that may apply in your country.</li>
          </ul>

          <h2>7. Availability and backups</h2>
          <p>
            We aim to keep Proj4D available and to back up data, but the service is provided without a guarantee of uninterrupted availability. We recommend you
            download PDF copies of reports you need for your records.
          </p>

          <h2>8. Suspension and termination</h2>
          <ul>
            <li>You may stop using Proj4D at any time and ask us to close your account by emailing <Mail d={d} />.</li>
            <li>We may suspend or close an account that breaches these terms or puts the service or other customers at risk, with notice where reasonable.</li>
            <li>After closure you have 30 days to ask for an export of your data; after that we delete it, as described in the Privacy Policy.</li>
          </ul>

          <h2>9. Disclaimers</h2>
          <p>
            Except as stated in these terms, the service is provided "as is" and we make no other warranties, including fitness for a particular purpose, to the extent
            the law allows.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the extent the law allows, neither party is liable for indirect or consequential losses (including lost profits, delay costs or liquidated damages), and
            our total liability in any 12-month period is limited to the fees you paid us in that period. Nothing in these terms limits liability that cannot be limited
            by law.
          </p>

          <h2>11. Changes to these terms</h2>
          <p>We may update these terms. We'll give notice of material changes by email or in the app at least 30 days before they take effect.</p>

          <h2>12. Governing law</h2>
          <p>These terms are governed by the laws of {d.governing_law}, and its courts have jurisdiction over disputes.</p>

          <h2>13. Contact</h2>
          <p>{d.business_name} · <Mail d={d} /></p>
        </>
      )}
    </LegalShell>
  );
}

export function PrivacyPage() {
  const d = useLegal();
  return (
    <LegalShell title="Privacy Policy" d={d}>
      {d && (
        <>
          <p>
            This policy explains what personal data Proj4D handles, why, and your choices. {d.business_name} operates Proj4D. For the project data a customer
            company enters, that company decides what is collected and why, and we process it on the company's behalf.
          </p>

          <h2>1. What we collect</h2>
          <ul>
            <li><b>Account details:</b> your name, work email, company name, role, and a securely hashed version of your password (we never store the password itself).</li>
            <li>
              <b>Project content your company enters:</b> projects, uploaded programmes (read to create the activity list; the uploaded file itself is not kept), documents uploaded to the
              AI programme generator (drawings, bills of quantities and similar, kept with the project until you remove them or delete the project), daily
              reports, weather, labour and equipment, deliveries, the names and organisations of site visitors, site issues, notes and site photos (which may show people).
            </li>
            <li><b>Technical data:</b> a login session cookie, your IP address (used to protect sign-in from abuse and recorded in our hosting provider's logs), and the date of your last login.</li>
            <li><b>On your device:</b> an unfinished daily report may be saved in your browser's local storage until you submit it. It is not sent to us until then.</li>
            <li><b>Notifications:</b> if you turn notifications on, we store your device's push address and your notification settings (types, reminder times, working days and time zone). You can turn them off at any time on the Notifications page or in your device settings.</li>
          </ul>

          <h2>2. How we use it</h2>
          <ul>
            <li>to provide the service: logging in, storing and showing your projects and reports, and producing PDFs;</li>
            <li>to keep it secure: separating each company's data, limiting repeated login attempts and investigating misuse;</li>
            <li>to contact you about your account, for example password reset emails and important service notices;</li>
            <li>to support you when you ask for help.</li>
          </ul>
          <p>We do not sell personal data or use it for advertising.</p>

          <h2>3. Cookies</h2>
          <p>
            We use one essential cookie to keep you logged in (it expires after 30 days or when you log out). We don't use analytics or advertising cookies.
          </p>

          <h2>4. Service providers</h2>
          <p>We share data only with providers that help us run Proj4D:</p>
          <ul>
            <li><b>Render</b> (hosting): stores the application database and photos.</li>
            <li>
              <b>Paystack</b> (payments): when an admin subscribes, Paystack receives their email address and collects the card, bank or USSD payment details on its own
              secure pages. We never see or store full card numbers; we keep the plan, amounts, dates and payment references.
            </li>
            <li><b>Email delivery provider</b>: sends password reset and account emails.</li>
            <li><b>Browser push services</b> (Google, Apple or Mozilla, depending on your device): deliver the notifications you turn on. They receive the notification in encrypted form.</li>
            <li>
              <b>Anthropic</b> (AI features{d.ai_enabled ? '' : ', when enabled'}): when you use AI features, the relevant content (such as report details, typed site
              notes, a programme file, drawings and a BOQ for programme generation, or the figures, notes and photos for a progress report) is sent to Anthropic's Claude API to produce the result. Anthropic processes it under its commercial terms; see
              anthropic.com/legal for how it handles API data.
            </li>
          </ul>
          <p>These providers may process data outside your country. We may also disclose data where required by law.</p>

          <h2>5. How long we keep it</h2>
          <p>
            We keep account and project data while your company's account is active. When an account is closed, we delete its data within 30 days (backups are
            overwritten on their normal cycle). A company admin can remove a user's access at any time.
          </p>

          <h2>6. Security</h2>
          <p>
            Data is sent over encrypted connections (HTTPS), passwords are hashed, sessions can be ended by logging out or changing your password, and each company's
            data is checked on every request so other companies cannot see it. No system is perfectly secure; tell us at <Mail d={d} /> if you find a problem.
          </p>

          <h2>7. Your rights</h2>
          <p>
            Depending on where you live, you may have the right to access, correct, export or delete your personal data, or to object to some processing. Your company
            admin can correct or remove users directly. For anything else, email <Mail d={d} />. If your request concerns your employer's project data, we may refer
            it to them. You may also complain to your local data protection authority.
          </p>

          <h2>8. Children</h2>
          <p>Proj4D is a business tool and is not intended for anyone under 18.</p>

          <h2>9. Changes</h2>
          <p>We'll update this page when our practices change and notify account admins of material changes.</p>

          <h2>10. Contact</h2>
          <p>{d.business_name} · <Mail d={d} /></p>
        </>
      )}
    </LegalShell>
  );
}
