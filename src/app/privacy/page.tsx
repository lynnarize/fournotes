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

      <h2>2. Google account data</h2>
      <p>
        Signing in with Google is optional and is used only for backup and sync. When you choose <em>Continue with Google</em>, the app asks for
        these permissions and nothing else:
      </p>
      <ul>
        <li>
          <strong>Your email address</strong> (<code>openid</code>, <code>email</code>) — to show which account is connected, and to give signed-in
          users a larger daily allowance of the app&apos;s shared AI requests.
        </li>
        <li>
          <strong>Its own app data in your Google Drive</strong> (<code>drive.appdata</code>) — to save and read a single sync file,{" "}
          <code>four-notes-sync.json</code>, in a hidden folder that only Four Notes can open.
        </li>
      </ul>
      <p>
        This permission gives the app access <strong>only to its own hidden app folder</strong>. The app cannot see, open, list, change or delete any
        of your other files in Google Drive, and those files are never read.
      </p>

      <h3>What the sync file contains</h3>
      <p>
        Your notes, to-dos, transactions and sticky notes, plus a few settings (currency, budgets, your display name if you set one, and whether voice
        replies are on). It does <strong>not</strong> contain scan images, API keys, or sample data.
      </p>

      <h3>How it is stored and protected</h3>
      <ul>
        <li>The sync file lives in your own Google Drive, under your Google account. We do not keep a copy on our servers.</li>
        <li>
          To keep syncing, Google gives the app a refresh token. It is stored only in an encrypted (AES-256-GCM), HttpOnly cookie on your device, so
          page scripts can&apos;t read it. It is not stored in any database.
        </li>
        <li>All connections use HTTPS.</li>
      </ul>

      <h3>Use and sharing</h3>
      <p>
        Google user data is used only to provide sync and backup to you. We do not sell it, use it for advertising, or use it to train AI models.
        Your Google email address is never sent to AI providers or shared with anyone. The sync file is read only to restore your notes on your
        devices; once restored they are ordinary notes on your device, which an AI feature can include only when you use one (see section 3).
      </p>

      <h3>Google API Services User Data Policy</h3>
      <p>
        Four Notes&apos; use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h3>Removing access and deleting your Drive copy</h3>
      <ul>
        <li>
          <strong>Delete Drive copy</strong> (Settings → Cloud sync) permanently deletes the sync file from your Google Drive.
        </li>
        <li>
          <strong>Disconnect</strong> revokes the app&apos;s access with Google and removes the token from your device.
        </li>
        <li>
          You can also remove access at any time from{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            your Google Account&apos;s third-party connections
          </a>
          .
        </li>
      </ul>

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
