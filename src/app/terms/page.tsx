import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { CONTACT_EMAIL } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service · Four Notes",
  description: "The terms for using Four Notes.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms apply to your use of Four Notes (&ldquo;the app&rdquo;), available at{" "}
        <a href="https://fournotes.vercel.app">fournotes.vercel.app</a>. By using the app you agree to them. If you don&apos;t agree, please don&apos;t
        use the app.
      </p>

      <h2>1. The service</h2>
      <p>
        Four Notes is a free app for notes, to-dos and tracking your spending, with an optional AI assistant and optional backup to your own Google
        Drive. Features may change, and some depend on third-party services that may be unavailable at times.
      </p>

      <h2>2. Your content</h2>
      <p>
        You own what you create in the app. It is stored on your device and, if you turn on sync, in your own Google Drive. You are responsible for
        your content and for keeping your own backups (you can export one any time from Settings → Data &amp; privacy). How we handle your information
        is described in the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>3. AI features</h2>
      <ul>
        <li>
          The assistant can make mistakes — for example misreading a receipt amount, a date or a category. Check anything important before relying on
          it.
        </li>
        <li>
          Spending summaries, budgets and saving tips are for your own organisation only. They are <strong>not</strong> financial, tax, legal or
          investment advice.
        </li>
        <li>The free AI allowance is limited each day and may be reduced, paused or changed.</li>
      </ul>

      <h2>4. Your own API keys</h2>
      <p>
        If you add your own API key (for example for OpenRouter, Anthropic, OpenAI, Groq or Voyage AI), requests made with it are billed to your account
        with that provider under their terms. Keep your keys private; you are responsible for their use.
      </p>

      <h2>5. Acceptable use</h2>
      <p>Please don&apos;t:</p>
      <ul>
        <li>use the app for anything illegal, or to store or produce unlawful content;</li>
        <li>try to get around the shared AI allowance, overload the service, or use it through automated scripts;</li>
        <li>try to access other people&apos;s data or interfere with the app&apos;s security.</li>
      </ul>
      <p>We may block access that breaks these rules or threatens the service.</p>

      <h2>6. Third-party services</h2>
      <p>
        The app works with services run by others, including Google (sign-in and Drive), OpenRouter and other AI providers, and Vercel (hosting). Your
        use of them is also covered by their own terms and policies.
      </p>

      <h2>7. No warranty</h2>
      <p>
        The app is provided free of charge, &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, including that it will
        be uninterrupted, error-free or that data will never be lost.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the extent the law allows, we are not liable for any indirect or consequential loss, or for loss of data, profits or savings, arising from
        your use of the app — including decisions made using AI output. Nothing in these terms limits rights you have under laws that can&apos;t be
        excluded.
      </p>

      <h2>9. Ending use</h2>
      <p>
        You can stop using the app at any time. To remove your data, use <em>Delete everything</em> and <em>Delete Drive copy</em> in Settings, and
        disconnect the app from your Google account. We may discontinue the app; if so, your data remains on your device and in your Drive.
      </p>

      <h2>10. Changes to these terms</h2>
      <p>We may update these terms. The date at the top shows the latest version; continuing to use the app means you accept the updated terms.</p>

      <h2>11. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
