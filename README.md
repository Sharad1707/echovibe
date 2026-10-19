# Echovibe

Echovibe is a private, consent-first reflection flow. After signing in, a participant shares an opening thought, answers six optional questions shaped by that thought and their previous answer, and receives a gentle reflection of recurring themes. The reflection is not a relationship score or diagnosis.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Firebase sign-in

1. Create a Firebase project and register a Web app.
2. In Firebase Authentication, enable both the **Anonymous** and **Google** providers and add `localhost` (and your deployed domain) to Authorized domains.
3. Create a Cloud Firestore database.
4. Copy `.env.example` to `.env.local`. Add the Firebase Web app values. The admin email is set to `sharadkasralikar1772@gmail.com`; change it only if you also update the matching email in `firestore.rules`.
5. Install and authenticate the Firebase CLI, select your project, then deploy these rules with `firebase deploy --only firestore:rules`.
6. Restart the Next.js app.

Participants start without a sign-in screen and use Firebase anonymous authentication in the background. Google sign-in is only needed to open the admin dashboard. The opening thought and every submitted answer are saved in Firestore only after the participant explicitly agrees that the designated admin account can view them. Participants can read only their own response documents; the exact admin Google email configured in `firestore.rules` can read all submitted responses. Firestore rules prohibit edits and deletes from the client. Do not launch publicly until you have replaced the example admin email and deployed the rules.

If Firebase is not configured, the question flow remains available in local-only mode. Its answers stay in that browser and cannot appear in the admin dashboard.

## Optional AI follow-up questions

1. Create a Gemini API key in Google AI Studio.
2. Set `GEMINI_API_KEY` in `.env.local`. `GEMINI_MODEL` can be set to a model available to your key; it defaults to `gemini-2.5-flash`.
3. Restart the Next.js dev server.

The API key stays server-side and is never exposed to the browser. The separate AI-consent option appears only when the server confirms Gemini is configured. Before any text is sent to Gemini, the participant must check that option. It sends the opening thought, current question, and current answer to generate one follow-up and three choices; the app adds the fourth, skip option. If AI consent is not given or Gemini is not configured, questions are generated locally. The Gemini route does not retain submissions; Firestore stores response documents only after the separate sharing consent. Review Google's current [Gemini API terms](https://ai.google.dev/gemini-api/terms) before enabling this feature.

If the AI service is temporarily unavailable after consent, the answer is still saved in Firestore and the app reports that it used the local follow-up instead. Before making this endpoint available on a public deployment, add rate limiting and abuse controls to protect the Gemini API quota.

## Email completed reflections

When email delivery is configured, participants are told that their completed opening thought and six answers will be emailed to `sharadkasralikar1772@gmail.com`. Their opening thought and each answer still require explicit consent before they are saved; the final email is sent only after the sixth answer has been saved. If delivery fails, the participant can retry from the reflection screen.

1. Create a [Resend](https://resend.com/) account and API key, and verify a sender domain/address that Resend allows you to use.
2. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in `.env.local` and in the Vercel project’s Environment Variables for the deployments you use.
3. Keep Firebase configured, enable Anonymous sign-in, and redeploy. The mail endpoint validates each Firebase ID token server-side; without Firebase or the Resend settings, automatic email is unavailable.
4. Restart locally or redeploy Vercel. The Resend key stays server-side. Email is sent only to the fixed recipient address above; participants cannot choose another recipient.

## Privacy and reflection

- The opening thought and each answer are saved to Firestore only after the participant agrees to share them with the designated admin.
- After a participant explicitly agrees to share their responses and submits all six answers, the completed reflection is emailed to `sharadkasralikar1772@gmail.com` when email notifications are configured.
- Submitted thoughts, questions, answers, and timestamps are stored in Firestore with the signed-in user's UID and Google email.
- The opening thought, submitted answer, and current question are sent to Google Gemini only when the separate AI-consent box is checked.
- Drafts, keystrokes, pauses, and click activity are not collected.
- Participants can review their own responses in **My answers**. Only the configured admin Google account can view responses across users in **Admin responses**.
- The final reflection lists themes matched from the participant's own words. It does not infer another person's feelings, diagnose a relationship, or assign a score.

Firebase Authentication provides Google sign-in, and Firestore stores responses with user-scoped security rules. The admin email in the app environment and Firestore rules must match exactly. Participants must actively agree before any response is stored; they are told that the designated admin can read submissions.

## Checks

```bash
npm run lint
npm run build
```
