import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { CONTACT_EMAIL } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy · Four Notes",
  description: "How Four Notes handles your notes, tasks, spending and Google account data.",
};

// Keep this in step with the code: every statement here describes what the app
// actually does (see src/lib/gdrive.ts, src/lib/google-server.ts, src/lib/ai/*).
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Four Notes (&ldquo;the app&rdquo;, &ldquo;we&rdquo;) is a notes, to-do and personal-finance app with an AI assistant, available at{" "}
        <a href="https://fournotes.vercel.app">fournotes.vercel.app</a>. This policy explains what information the app handles, where it goes, and the
        choices you have. We don&apos;t sell your information, show ads, or use tracking or analytics tools.
      </p>

      <p className="callout">
        <strong>In short:</strong> your notes, tasks and spending are stored in your own browser. They leave your device only when you use an AI
        feature, or when you turn on Google Drive sync, which saves a copy in a private folder of <em>your own</em> Google Drive.
      </p>

      <h2>1. Information stored on your device</h2>
      <p>
        Everything you create — notes, to-dos, transactions, budgets, categories, sticky notes and settings — is saved in your browser&apos;s local
        storage on your device. We do not have a database of user content and cannot see it. Scan thumbnails and any API keys you enter in Settings are
        also kept only on your device.
      </p>

      <h2>2. Google user data</h2>
      <p>
        Signing in with Google is optional. It is used only to back up your data and sync it between your devices. This section describes how Four
        Notes accesses, uses, shares, protects, retains and deletes Google user data.
      </p>

      <h3>2.1 Data accessed</h3>
      <p>When you choose <em>Continue with Google</em>, the app requests these permissions and nothing else:</p>
      <ul>
        <li>
          <strong>Your Google account email address</strong> (scopes <code>openid</code> and <code>email</code>).
        </li>
        <li>
          <strong>Your name</strong> from your Google profile (scope <code>profile</code>). The app uses only your first name; it does not use your
          profile photo or any other profile information.
        </li>
        <li>
          <strong>The app&apos;s own data in your Google Drive</strong> (scope <code>drive.appdata</code>): a single file,{" "}
          <code>four-notes-sync.json</code>, in a hidden app-data folder that only Four Notes can open.
        </li>
      </ul>
      <p>
        The app <strong>cannot see, open, list, change or delete any other file</strong> in your Google Drive. It does not access your contacts,
        calendar, Gmail, photos or any other Google data.
      </p>

      <h3>2.2 How we use Google user data</h3>
      <ul>
        <li>
          <strong>Email address</strong> — to show which Google account is connected, and to count your daily allowance of the app&apos;s shared AI
          requests (signed-in users get a larger allowance).
        </li>
        <li>
          <strong>First name</strong> — to fill in &ldquo;Your name&rdquo; in Settings, which the daily brief uses to greet you. It is filled in once,
          only if you haven&apos;t set a name yourself, and you can change or clear it at any time.
        </li>
        <li>
          <strong>Drive app data</strong> — to save your notes, to-dos, transactions, sticky notes and a few settings (currency, budgets, display name,
          voice replies) to the sync file, and to read that file back so the same data appears on your other devices.
        </li>
      </ul>
      <p>
        Google user data is used only to provide these features to you. It is <strong>not</strong> sold, <strong>not</strong> used for advertising,
        <strong> not</strong> used to build profiles, and <strong>not</strong> used to develop, improve or train AI or machine-learning models. No one
        at Four Notes reads it: we have no database and no copy of it.
      </p>

      <h3>2.3 Data sharing, transfer and disclosure</h3>
      <p>
        We do not share, sell, transfer or disclose Google user data to third parties. Your email address is never sent to AI providers or anyone else.
        The sync file only moves between your own Google Drive and your own devices. The only exceptions are:
      </p>
      <ul>
        <li>
          <strong>Google</strong>, which provides sign-in and stores the file in your Drive, and <strong>Vercel</strong>, our hosting provider, whose
          servers pass requests between your browser and Google to run the app. Neither receives Google user data from us for any other purpose.
        </li>
        <li>If required by law.</li>
      </ul>
      <p>
        Notes restored from the sync file are ordinary notes on your device. Like any of your notes, they are sent to an AI provider only when you
        use an AI feature, and only the parts needed for that request (see section 3).
      </p>

      <h3>2.4 Data storage and protection</h3>
      <ul>
        <li>The sync file is stored in your own Google Drive, under your Google account. We do not store it on our servers.</li>
        <li>
          To keep syncing, Google issues a refresh token. It is stored only on your device, in a cookie encrypted with AES-256-GCM and marked HttpOnly,
          so scripts on the page cannot read it. It is not stored in any database.
        </li>
        <li>Short-lived access tokens are kept only in your browser&apos;s memory (never saved) and expire after one hour.</li>
        <li>Your email address is stored on your device only: inside the encrypted cookie, and in local storage to show the connected account.</li>
        <li>
          Your first name is kept inside the encrypted cookie and, once filled in, as your display name in Settings (on your device and in your sync
          file, like your other settings).
        </li>
        <li>All traffic uses HTTPS. The app requests only the minimum permissions it needs.</li>
      </ul>

      <h3>2.5 Data retention and deletion</h3>
      <ul>
        <li>
          <strong>Sync file</strong> — kept in your Google Drive until you delete it. Use <em>Delete Drive copy</em> in Settings → Cloud sync, or in
          Google Drive go to Settings → Manage apps → Four Notes → Options → <em>Delete hidden app data</em>.
        </li>
        <li>
          <strong>Sign-in token, email address and name</strong> — these are kept in the encrypted cookie on your device for up to 180
          days; your email is also saved in your browser&apos;s local storage to show which account is connected. These are deleted immediately when you
          choose <em>Disconnect</em>, which also revokes the app&apos;s access with Google.
        </li>
        <li>
          <strong>Daily allowance counter</strong> — your email address (or IP address when signed out) is held in server memory only to count
          requests, and is cleared every day.
        </li>
        <li>
          <strong>Display name</strong> — kept as a setting until you change or clear it in Settings → General, or delete your data.
        </li>
        <li><strong>Sign-in protection cookie</strong> — deleted after 10 minutes.</li>
        <li>
          You can remove the app&apos;s access at any time from{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            your Google Account&apos;s third-party connections
          </a>
          . For any request about your data, contact <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </li>
      </ul>

      <h3>2.6 Limited Use</h3>
      <p>
        Four Notes&apos; use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>3. AI features</h2>
      <p>
        When you use the assistant — chat, scanning a photo, a voice recording, the daily brief or the monthly review — the app&apos;s server sends
        what&apos;s needed for that request to an AI provider and returns the answer to you:
      </p>
      <ul>
        <li>your message, or the photo or recording you chose;</li>
        <li>a short summary of your data so the assistant can answer (for example recent tasks, spending and note titles, and notes related to your question).</li>
      </ul>
      <p>
        The provider is <a href="https://openrouter.ai/privacy" target="_blank" rel="noreferrer">OpenRouter</a>, which routes the request to an AI model
        provider; if you add your own key in Settings, the request goes to that provider instead (for example{" "}
        <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noreferrer">Anthropic</a>, or OpenAI or Groq for speech-to-text, or Voyage
        AI for search). Their own privacy policies apply to what they receive; some free models are offered by providers that may log or use the
        requests they receive, as described in OpenRouter&apos;s policy. Our server does not store the content of these requests; it keeps only technical
        logs such as which model answered and how many tokens were used.
      </p>
      <p>Don&apos;t use the AI features for information you don&apos;t want sent to an AI provider.</p>

      <h2>4. Other services</h2>
      <ul>
        <li>
          <strong>Exchange rates</strong> — for foreign-currency transactions the app looks up rates from a public currency service. Only the currency
          codes are sent.
        </li>
        <li>
          <strong>Hosting</strong> — the app is hosted on <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noreferrer">Vercel</a>,
          which processes standard request information (such as IP address and browser type) to serve the site.
        </li>
      </ul>

      <h2>5. Abuse protection</h2>
      <p>
        To stop the shared AI allowance from being misused, the server counts requests per IP address, or per Google account email when you&apos;re
        signed in. These counts are held briefly in server memory, are not stored in a database, and reset daily.
      </p>

      <h2>6. Cookies and local storage</h2>
      <p>
        The app uses your browser&apos;s local storage for your data and preferences, and two cookies only when you connect Google: a short-lived one
        that protects the sign-in against forgery, and the encrypted sync cookie described above. There are no advertising or tracking cookies.
      </p>

      <h2>7. Your choices and deleting your data</h2>
      <ul>
        <li><strong>Export</strong> a backup of everything from Settings → Data &amp; privacy.</li>
        <li><strong>Delete everything</strong> on this device from Settings → Data &amp; privacy (this also removes saved API keys).</li>
        <li><strong>Delete Drive copy</strong> and <strong>Disconnect</strong> as described in section 2.</li>
      </ul>

      <h2>8. Children</h2>
      <p>The app is not directed at children under 13, and we do not knowingly collect information from them.</p>

      <h2>9. Changes to this policy</h2>
      <p>
        If this policy changes, we will update the date at the top of this page. For significant changes that affect your Google data, we will ask for
        your consent again where required.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions or requests about your privacy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
