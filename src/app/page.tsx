"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from "@firebase/auth";
import {
  createResponse,
  getResponses,
  type SharedAnswer,
} from "@/lib/firestore-rest";
import { readLocalResponses, saveLocalResponse } from "@/lib/answer-storage";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase-client";

type Prompt = {
  id: string;
  text: string;
  options: string[];
};

type Theme = {
  label: string;
  pattern: RegExp;
};

const questionCount = 6;
const adminEmail = process.env.NEXT_PUBLIC_FIREBASE_ADMIN_EMAIL?.trim().toLowerCase() || "";
const responseEmail = "sharadkasralikar1772@gmail.com";

const questionOptions = [
  [
    "How I feel about it",
    "What I need right now",
    "A shared moment connected to it",
    "I'd rather skip this one",
  ],
  [
    "It felt joyful",
    "I felt understood",
    "We shared laughter",
    "I'd rather skip this one",
  ],
  [
    "A small thoughtful gesture",
    "Making time for each other",
    "Laughing about ordinary things",
    "I'd rather skip this one",
  ],
  [
    "Being listened to without pressure",
    "A little affection or reassurance",
    "Having space when I need it",
    "I'd rather skip this one",
  ],
  [
    "A cozy evening in",
    "A spontaneous little outing",
    "A long unhurried conversation",
    "I'd rather skip this one",
  ],
  [
    "One kind thing we can do this week",
    "A new memory to make together",
    "Keep things simple and see how we feel",
    "I'd rather skip this one",
  ],
];

const relationshipThemes: Theme[] = [
  { label: "Communication and feeling understood", pattern: /\b(talk|talking|listen|listening|understood|communication|conversation|heard)\b/i },
  { label: "Time and shared experiences", pattern: /\b(time together|spend time|date|outing|memory|memories|together|laugh|laughter)\b/i },
  { label: "Care and affection", pattern: /\b(care|kind|affection|hug|support|reassur|appreciat|thoughtful|love)\w*/i },
  { label: "Space and comfort", pattern: /\b(space|comfortable|comfort|pressure|boundary|boundaries|slow|quiet|trust)\b/i },
];

function makeQuestion(index: number, openingThought: string, previousAnswer = ""): Prompt {
  const openingContext = openingThought.trim().replace(/\s+/g, " ").slice(0, 110);
  const answerContext = previousAnswer.startsWith("I'd rather skip")
    ? ""
    : previousAnswer.trim().replace(/\s+/g, " ").slice(0, 72);
  const questions = [
    openingContext
      ? `You shared, “${openingContext}”. What would feel most helpful to explore first?`
      : "What would feel most helpful to explore first?",
    answerContext
      ? `You mentioned “${answerContext}”. What part of that feels most important to you?`
      : "What part of what you shared feels most important to you?",
    answerContext
      ? `Thinking about “${answerContext}”, what kind of response or support would feel right?`
      : "What kind of response or support would feel right to you?",
    "When this comes up between you, what helps you feel comfortable and heard?",
    "What kind of low-pressure time together might feel good lately?",
    "Looking ahead, what is one small next step that feels right to you?",
  ];

  return {
    id: `check-in-${index + 1}`,
    text: questions[index],
    options: questionOptions[index],
  };
}

function getAuthErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return error instanceof Error ? error.message : "Authentication could not be completed. Please try again.";
  }
  switch (error.code) {
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Could not reach Firebase. Check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was closed before it finished.";
    case "auth/unauthorized-domain":
      return "Add localhost or this site’s domain to Firebase Authentication’s Authorized domains.";
    case "auth/operation-not-allowed":
      return "Enable Anonymous sign-in in Firebase Authentication to use the private check-in.";
    default:
      return "Authentication could not be completed. Check your Firebase settings and try again.";
  }
}

function summarizeAnswers(openingThought: string, responses: SharedAnswer[]) {
  const combinedText = [openingThought, ...responses.map((item) => item.answer)].join(" ");
  return relationshipThemes.filter((theme) => theme.pattern.test(combinedText));
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [view, setView] = useState<"journey" | "answers">("journey");
  const [phase, setPhase] = useState<"opening" | "questions" | "report">("opening");
  const [openingThought, setOpeningThought] = useState("");
  const [responses, setResponses] = useState<SharedAnswer[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [question, setQuestion] = useState<Prompt>(() => makeQuestion(0, ""));
  const [selectedOption, setSelectedOption] = useState("");
  const [answer, setAnswer] = useState("");
  const [consented, setConsented] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiConsented, setAiConsented] = useState(false);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"not-configured" | "not-sent" | "sending" | "sent" | "failed">("not-configured");
  const [emailError, setEmailError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAnswers, setSavedAnswers] = useState<SharedAnswer[]>([]);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const isAdmin = Boolean(user?.email && adminEmail && user.email.toLowerCase() === adminEmail);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void Promise.resolve()
      .then(() => {
        if (!active) return;
        const auth = getFirebaseAuth();
        unsubscribe = onAuthStateChanged(auth, (authenticatedUser) => {
          setUser(authenticatedUser);
          setAuthReady(true);
          if (!authenticatedUser) {
            void signInAnonymously(auth).catch((error: unknown) => {
              console.error("Anonymous Firebase sign-in failed.", error);
              setAuthNotice(getAuthErrorMessage(error));
            });
          }
        }, (error) => {
          console.error("Firebase authentication state could not be loaded.", error);
          setAuthNotice("Could not verify your sign-in. Refresh the page or check Firebase settings.");
          setAuthReady(true);
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("Firebase authentication could not be initialized.", error);
        setAuthNotice(getAuthErrorMessage(error));
        setAuthReady(true);
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/next-question", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`AI availability check failed with status ${response.status}.`);
        const result = (await response.json()) as { available?: unknown };
        if (active && typeof result.available === "boolean") setAiAvailable(result.available);
      })
      .catch((error: unknown) => {
        console.error("Could not check whether Gemini follow-ups are configured.", error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/email-response", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Email availability check failed with status ${response.status}.`);
        const result = (await response.json()) as { available?: unknown };
        if (!active || typeof result.available !== "boolean") return;
        setEmailAvailable(result.available);
        setEmailStatus(result.available ? "not-sent" : "not-configured");
      })
      .catch((error: unknown) => {
        console.error("Could not check whether email notifications are configured.", error);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signInAsAdmin() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthNotice("");
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
    } catch (error) {
      setAuthNotice(getAuthErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function retryAnonymousSignIn() {
    setAuthNotice("");
    try {
      await signInAnonymously(getFirebaseAuth());
    } catch (error) {
      setAuthNotice(getAuthErrorMessage(error));
    }
  }

  async function handleSignOut() {
    setAuthNotice("");
    try {
      await signOut(getFirebaseAuth());
      resetJourney();
      setView("journey");
    } catch (error) {
      setAuthNotice(getAuthErrorMessage(error));
    }
  }

  async function storeResponse(questionText: string, responseText: string): Promise<SharedAnswer> {
    if (!isFirebaseConfigured) {
      return saveLocalResponse({
        uid: "local",
        email: "",
        openingThought,
        question: questionText,
        answer: responseText,
      });
    }
    if (!user) throw new Error("Your private check-in is still loading. Please try again.");
    await createResponse(user, {
      uid: user.uid,
      email: user.email || "",
      openingThought,
      question: questionText,
      answer: responseText,
      sharedWithAdmin: true,
    });
    return {
      id: `response-${Date.now()}`,
      uid: user.uid,
      email: user.email || "",
      openingThought,
      question: questionText,
      answer: responseText,
      createdAt: new Date().toISOString(),
    };
  }

  async function emailCompletedResponses(completedResponses: SharedAnswer[]) {
    if (!user) throw new Error("Your session is not ready to send the completed responses.");
    const token = await user.getIdToken();
    const response = await fetch("/api/email-response", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consent: true,
        responses: completedResponses.map(({ question, answer }) => ({ question, answer })),
      }),
    });
    const result = (await response.json()) as { error?: unknown };
    if (!response.ok) {
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "The completed responses could not be emailed.",
      );
    }
  }

  async function retryCompletionEmail() {
    if (!emailAvailable || responses.length !== questionCount + 1 || emailStatus === "sending") return;
    setEmailStatus("sending");
    setEmailError("");
    setNotice("");
    try {
      await emailCompletedResponses(responses);
      setEmailStatus("sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The completed responses could not be emailed.";
      setEmailStatus("failed");
      setEmailError(message);
      setNotice("Your reflection is ready. You can retry email delivery below.");
    }
  }

  function resetJourney() {
    setPhase("opening");
    setOpeningThought("");
    setResponses([]);
    setQuestionIndex(0);
    setQuestion(makeQuestion(0, ""));
    setSelectedOption("");
    setAnswer("");
    setConsented(false);
    setAiConsented(false);
    setEmailStatus(emailAvailable ? "not-sent" : "not-configured");
    setEmailError("");
    setNotice("");
  }

  async function beginJourney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const thought = openingThought.trim();
    if ((!user && isFirebaseConfigured) || !consented || thought.length === 0 || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const firstResponse = await storeResponse("What would you like to talk about?", thought);
      setResponses([firstResponse]);
      setQuestionIndex(0);
      setQuestion(makeQuestion(0, thought));
      setPhase("questions");
      setConsented(false);
      setNotice(isFirebaseConfigured
        ? "Your opening thought was saved to Firebase and shared with the designated admin."
        : "Your opening thought was saved only in this browser.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Your opening thought could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedAnswer = answer.trim() || selectedOption;
    if ((!user && isFirebaseConfigured) || !consented || submittedAnswer.length === 0 || saving) return;

    setSaving(true);
    setNotice("");
    try {
      const nextIndex = questionIndex + 1;
      let nextQuestion: Prompt | null = null;
      let aiFallbackNotice = "";
      if (nextIndex < questionCount) {
        nextQuestion = makeQuestion(nextIndex, openingThought, submittedAnswer);
        if (aiConsented && aiAvailable) {
          try {
            const response = await fetch("/api/next-question", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                answer: submittedAnswer,
                currentQuestion: question.text,
                initialThought: openingThought,
                nextQuestionNumber: nextIndex + 1,
                consent: true,
              }),
            });
            const result = (await response.json()) as { question?: unknown; options?: unknown; error?: string };
            if (!response.ok) throw new Error(result.error || "The AI service could not generate a follow-up.");
            if (
              typeof result.question !== "string" ||
              !Array.isArray(result.options) ||
              result.options.length !== 4 ||
              !result.options.every((option) => typeof option === "string")
            ) {
              throw new Error("The AI service returned an invalid follow-up.");
            }
            nextQuestion = {
              id: `ai-check-in-${nextIndex + 1}`,
              text: result.question,
              options: result.options,
            };
          } catch (error) {
            aiFallbackNotice = error instanceof Error
              ? `AI follow-up unavailable: ${error.message} Your answer was saved; the next question is generated locally.`
              : "AI follow-up unavailable. Your answer was saved; the next question is generated locally.";
          }
        }
      }

      const saved = await storeResponse(question.text, submittedAnswer);
      const updatedResponses = [...responses, saved];
      setResponses(updatedResponses);
      let completionNotice = "";
      if (nextIndex >= questionCount) {
        if (emailAvailable) {
          setEmailStatus("sending");
          setEmailError("");
          setNotice("Your responses are saved. Sending the completed reflection by email…");
          try {
            await emailCompletedResponses(updatedResponses);
            setEmailStatus("sent");
            completionNotice = "Your last answer was saved.";
          } catch (error) {
            const message = error instanceof Error ? error.message : "The completed responses could not be emailed.";
            setEmailStatus("failed");
            setEmailError(message);
            completionNotice = "Your reflection is ready. You can retry email delivery below.";
          }
        } else {
          setEmailStatus("not-configured");
          completionNotice = "Your last answer was saved.";
        }
      }
      setAnswer("");
      setSelectedOption("");
      setConsented(false);
      setAiConsented(false);
      setNotice(completionNotice || aiFallbackNotice || (aiConsented && aiAvailable
          ? "Your answer was saved. Your AI-generated follow-up is ready."
          : isFirebaseConfigured
            ? "Your answer was saved to Firebase. Thanks for sharing."
            : "Your answer was saved only in this browser. Thanks for sharing."));
      if (nextIndex >= questionCount) {
        setPhase("report");
      } else {
        setQuestionIndex(nextIndex);
        if (nextQuestion) setQuestion(nextQuestion);
      }
    } catch (error) {
      setNotice(error instanceof Error
        ? error.message
        : "Your answer could not be saved or used to generate the next question. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function loadDashboard() {
    setNotice("");
    try {
      if (user) {
        setSavedAnswers(await getResponses(user, isAdmin));
      } else if (!isFirebaseConfigured) {
        setSavedAnswers(readLocalResponses().sort((left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
        ));
      } else {
        throw new Error("Sign in to view responses.");
      }
      setDashboardLoaded(true);
    } catch (error) {
      setDashboardLoaded(false);
      setNotice(error instanceof Error ? error.message : "Your saved answers could not be loaded from Firebase.");
    }
  }

  const themeSummary = summarizeAnswers(openingThought, responses);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          aria-label="Echovibe home"
          className="brand"
          href="#home"
          onClick={(event) => {
            event.preventDefault();
            setView("journey");
          }}
        >
          <span className="brand-mark" aria-hidden="true">e</span>
          <span>echovibe</span>
        </a>
        <nav className="top-actions" aria-label="Main navigation">
            {user && (
            <button className={`nav-link ${view === "journey" ? "nav-active" : ""}`} onClick={() => setView("journey")}>
              Your check-in
            </button>
            )}
            <button
              className={`nav-link ${view === "answers" ? "nav-active" : ""}`}
              onClick={() => {
                setView("answers");
                loadDashboard();
              }}
            >
              {isAdmin ? "Admin responses" : "My answers"}
            </button>
            {user && isAdmin ? (
              <>
                <span className="account-email">{user.email}</span>
                <button className="nav-link" onClick={() => void handleSignOut()}>Leave admin</button>
              </>
            ) : user ? (
              <button className="nav-link admin-sign-in" disabled={authBusy} onClick={() => void signInAsAdmin()}>
                {authBusy ? "Opening Google…" : "Admin sign-in"}
              </button>
            ) : null}
        </nav>
      </header>

      <section className="hero" id="home">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> A little space for us</p>
          <h1>Good things<br />begin with <em>listening.</em></h1>
          <p className="hero-description">
            A private, gentle space to share what is on your mind, explore it at your own pace,
            and reflect on the themes in your own answers.
          </p>
          {user ? (
            <div className="promise">
              <span className="promise-icon" aria-hidden="true">♡</span>
              <p><strong>Your words stay yours.</strong><br />
                Submitted responses are stored in Firestore only after consent and are visible to the designated admin account.
                {emailAvailable && ` Your completed responses are also emailed to ${responseEmail}.`}</p>
            </div>
          ) : !isFirebaseConfigured ? (
            <div className="promise">
              <span className="promise-icon" aria-hidden="true">♡</span>
              <p><strong>No sign-in needed.</strong><br />
                Without Firebase setup, answers stay only in this browser and are not sent to an admin dashboard.</p>
            </div>
          ) : (
            <div className="promise">
              <span className="promise-icon" aria-hidden="true">♡</span>
              <p><strong>A reflection, not a diagnosis.</strong><br />
                Echovibe will show themes from words you choose to share, not score your relationship or decide how you feel.</p>
            </div>
          )}
          <div className="love-doodle" aria-hidden="true">
            <span className="doodle-heart doodle-heart-one">♡</span>
            <span className="doodle-heart doodle-heart-two">✧</span>
            <span className="doodle-heart doodle-heart-three">♡</span>
            <span className="doodle-orbit" />
          </div>
        </div>

        <div className="card-wrap">
          <div className="orbit orbit-one" aria-hidden="true" />
          <div className="orbit orbit-two" aria-hidden="true" />
          {!authReady ? (
            <section className="question-card" aria-live="polite">
              <p className="question-kicker">YOUR PRIVATE SPACE</p>
              <h2>Getting things ready…</h2>
            </section>
          ) : !user && isFirebaseConfigured ? (
            <section className="question-card auth-card" aria-labelledby="auth-title">
              <div className="card-topline">
                <span className="step-label">YOUR PRIVATE SPACE</span>
                <span className="step-count">♡</span>
              </div>
              <div className="card-divider" />
              <div className="question-icon" aria-hidden="true">⌂</div>
              {!isFirebaseConfigured ? (
                <>
                  <p className="question-kicker">ONE-TIME SETUP NEEDED</p>
                  <h2 id="auth-title">Connect your sign-in.</h2>
                  <p className="dashboard-intro">
                    Add your Firebase web app settings and admin email to <code>.env.local</code>, enable Anonymous and Google sign-in,
                    create Firestore, and deploy the provided security rules. Setup details are in the project README.
                  </p>
                  <p aria-live="polite" className="notice">
                    Add your Firebase web app settings, NEXT_PUBLIC_FIREBASE_ADMIN_EMAIL, and the matching admin email in firestore.rules.
                  </p>
                </>
              ) : (
                <>
                  <p className="question-kicker">PRIVATE CHECK-IN</p>
                  <h2 id="auth-title">Your space is almost ready.</h2>
                  <p className="dashboard-intro">
                    Visitors can start without signing in. Enable Anonymous sign-in in Firebase Authentication. Google sign-in is only needed for the admin dashboard.
                  </p>
                  {authNotice && (
                    <button className="submit-button auth-submit" onClick={() => void retryAnonymousSignIn()} type="button">
                      Try again
                    </button>
                  )}
                  <p aria-live="polite" className="notice">{authNotice}</p>
                  <div className="card-footer"><span>Visitors can start without a login screen.</span></div>
                </>
              )}
            </section>
          ) : view === "answers" ? (
            <section className="question-card dashboard-card" aria-labelledby="answers-title">
              <div className="card-topline">
                <span className="step-label">{isAdmin ? "ADMIN DASHBOARD" : "YOUR PRIVATE SPACE"}</span>
                <span className="step-count">♡</span>
              </div>
              <div className="card-divider" />
              <div className="question-icon" aria-hidden="true">⌂</div>
              <p className="question-kicker">YOUR PRIVATE SPACE</p>
              <h2 id="answers-title">{isAdmin ? "Responses from everyone." : "Your answers."}</h2>
              <p className="dashboard-intro">
                {isAdmin
                  ? `These submitted responses are visible to the admin account ${adminEmail}. Handle them privately.`
                  : user
                    ? "Your submitted responses are stored in Firebase and visible to the designated admin account shown when you agreed to share."
                    : "These answers are stored only in this browser. They are not uploaded or visible to the admin dashboard."}
              </p>
              {dashboardLoaded && (
                <div className="answer-list" aria-live="polite">
                  {savedAnswers.length === 0 ? (
                    <p className="empty-state">No saved answers yet. Start with anything on your mind.</p>
                  ) : savedAnswers.map((item) => (
                    <article className="answer-entry" key={item.id}>
                      <div className="answer-entry-meta">
                        <strong>{isAdmin ? item.email || `Anonymous · ${item.uid.slice(0, 8)}` : "You"}</strong>
                        <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                      </div>
                      <p className="answer-question">{item.question}</p>
                      <p className="answer-text">{item.answer}</p>
                    </article>
                  ))}
                </div>
              )}
              <p aria-live="polite" className="notice">{notice}</p>
              <div className="card-footer">
                <span>
                  {isAdmin
                    ? "Admin access is enforced by the deployed Firestore security rules."
                    : user
                      ? "Your responses are visible to you and the designated admin account."
                      : "Local-only answers on this browser."}
                </span>
              </div>
            </section>
          ) : phase === "opening" ? (
            <section className="question-card" aria-labelledby="opening-title">
              <div className="card-topline">
                <span className="step-label">START WHERE YOU ARE</span>
                <span className="step-count">01</span>
              </div>
              <div className="card-divider" />
              <div className="question-icon" aria-hidden="true">✎</div>
              <p className="question-kicker">WHAT&apos;S ON YOUR MIND?</p>
              <h2 id="opening-title">Ask me anything—or leave a thought.</h2>
              <form onSubmit={beginJourney}>
                <label className="field-label" htmlFor="opening-thought">Share only what feels comfortable</label>
                <textarea
                  autoFocus
                  id="opening-thought"
                  maxLength={1200}
                  onChange={(event) => setOpeningThought(event.target.value)}
                  placeholder="A question, a feeling, or anything you want to explore…"
                  required
                  rows={5}
                  value={openingThought}
                />
                <label className="consent">
                  <input checked={consented} onChange={(event) => setConsented(event.target.checked)} required type="checkbox" />
                  <span>
                    {isFirebaseConfigured
                      ? emailAvailable
                        ? `I agree to save this thought and my answers in Firebase, where the admin${adminEmail ? ` (${adminEmail})` : " account configured by the app owner"} can view them, and email the completed responses to ${responseEmail}.`
                        : `I agree to save this thought and my submitted answers in Firebase, where the admin${adminEmail ? ` (${adminEmail})` : " account configured by the app owner"} can view them. Email notifications are not configured.`
                      : "I agree to save this thought and my submitted answers only in this browser. Email notifications are not available in local-only mode."}
                  </span>
                </label>
                <button className="submit-button" disabled={!openingThought.trim() || !consented || saving} type="submit">
                  {saving ? "Saving…" : "Continue to questions"} <span aria-hidden="true">↗</span>
                </button>
              </form>
              <p aria-live="polite" className="notice">{notice}</p>
              <div className="card-footer"><span>It will shape your questions. You can skip any question.</span></div>
            </section>
          ) : phase === "questions" ? (
            <section className="question-card" key={question.id} aria-labelledby="question-title">
              <div className="card-topline">
                <span className="step-label">A CHECK-IN AT YOUR PACE</span>
                <span className="step-count">{questionIndex + 1} <span>/ {questionCount}</span></span>
              </div>
              <div className="question-progress" aria-label={`Question ${questionIndex + 1} of ${questionCount}`}>
                {Array.from({ length: questionCount }, (_, index) => (
                  <span className={`progress-dot ${index <= questionIndex ? "progress-dot-active" : ""}`} key={index} />
                ))}
              </div>
              <div className="card-divider" />
              <div className="question-icon" aria-hidden="true">✳</div>
              <p className="question-kicker">
                {question.id.startsWith("ai-") ? "AI FOLLOW-UP · SKIP FREELY" : "BASED ON WHAT YOU SHARED"}
              </p>
              <h2 id="question-title">{question.text}</h2>
              <form onSubmit={submitAnswer}>
                <fieldset className="answer-choices">
                  <legend className="field-label">Choose one, or write your own</legend>
                  <div className="choice-grid">
                    {question.options.map((option, index) => (
                      <button
                        aria-pressed={selectedOption === option}
                        className={`answer-choice ${selectedOption === option && !answer.trim() ? "answer-choice-selected" : ""}`}
                        key={option}
                        onClick={() => {
                          setSelectedOption(option);
                          setAnswer("");
                        }}
                        type="button"
                      >
                        <span className="choice-mark" aria-hidden="true">
                          {selectedOption === option && !answer.trim() ? "✓" : String.fromCharCode(65 + index)}
                        </span>
                        {option}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="custom-answer">
                  <label className="field-label answer-label" htmlFor="answer">Or say it your way <span>(optional)</span></label>
                  <textarea
                    id="answer"
                    maxLength={1500}
                    onChange={(event) => {
                      setAnswer(event.target.value);
                      if (event.target.value.trim()) setSelectedOption("");
                    }}
                    placeholder="Your own words, if you'd like…"
                    rows={2}
                    value={answer}
                  />
                </div>
                <label className="consent">
                  <input checked={consented} onChange={(event) => setConsented(event.target.checked)} required type="checkbox" />
                  <span>
                    {isFirebaseConfigured
                      ? emailAvailable
                        ? `I agree to save this answer in Firebase and include it with all my responses in an email to ${responseEmail} when I finish.`
                        : `I agree to save this answer in Firebase, where the admin${adminEmail ? ` (${adminEmail})` : " account configured by the app owner"} can view it.`
                      : "I agree to save this answer only in this browser."}
                  </span>
                </label>
                {aiAvailable && questionIndex + 1 < questionCount && (
                  <label className="consent ai-consent">
                    <input checked={aiConsented} onChange={(event) => setAiConsented(event.target.checked)} type="checkbox" />
                    <span>
                      Optional: send my opening thought, this question, and answer to Google Gemini to create the next question.
                      Review the{" "}
                      <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini API terms</a>.
                      If unchecked, questions are generated locally.
                    </span>
                  </label>
                )}
                <button className="submit-button" disabled={(!answer.trim() && !selectedOption) || !consented || saving} type="submit">
                  {saving ? "Saving…" : questionIndex + 1 === questionCount ? "See my reflection" : "Next question"} <span aria-hidden="true">↗</span>
                </button>
              </form>
              <p aria-live="polite" className="notice">{notice}</p>
              <div className="card-footer"><span>Your answers are optional. You can skip any question.</span></div>
            </section>
          ) : (
            <section className="question-card report-card" aria-labelledby="report-title">
              <div className="card-topline">
                <span className="step-label">YOUR PERSONAL REFLECTION</span>
                <span className="step-count">♡</span>
              </div>
              <div className="card-divider" />
              <div className="question-icon" aria-hidden="true">✳</div>
              <p className="question-kicker">A REFLECTION, NOT A SCORE</p>
              <h2 id="report-title">What your answers brought forward.</h2>
              <section className="reflection-section">
                <h3>Your starting thought</h3>
                <p>{openingThought}</p>
              </section>
              <section className="reflection-section">
                <h3>Themes in your words</h3>
                {themeSummary.length > 0 ? (
                  <ul className="theme-list">
                    {themeSummary.map((theme) => <li key={theme.label}>{theme.label}</li>)}
                  </ul>
                ) : (
                  <p>Your words are personal and don&apos;t fit a preset theme. You know best what they mean to you.</p>
                )}
              </section>
              <section className="reflection-section">
                <h3>A gentle next step</h3>
                <p>
                  {themeSummary.length
                    ? `If it feels right, consider sharing one specific example related to ${themeSummary[0].label.toLowerCase()} and asking what the other person thinks.`
                    : "If it feels right, choose one thing from your answers you would like the other person to understand, and share it in your own words."}
                </p>
              </section>
              <p className="reflection-disclaimer">
                Themes are simple matches to words in your answers. This is not a relationship score, diagnosis, or a conclusion about anyone else.
              </p>
              {emailStatus === "sent" && (
                <p className="notice" role="status">Your completed responses were emailed to {responseEmail}.</p>
              )}
              {emailStatus === "not-configured" && (
                <p className="notice" role="status">
                  Email notifications are not configured. Your answers were saved according to the consent you gave.
                </p>
              )}
              {emailStatus === "failed" && (
                <>
                  <p className="notice" role="alert">{emailError}</p>
                  <button className="submit-button" onClick={() => void retryCompletionEmail()} type="button">
                    Retry email
                  </button>
                </>
              )}
              {emailStatus === "sending" && <p className="notice" role="status">Sending your completed responses…</p>}
              <p aria-live="polite" className="notice">{notice}</p>
              <button className="submit-button" onClick={resetJourney} type="button">Start a new reflection</button>
              <div className="card-footer"><span>Only you decide what feels true.</span></div>
            </section>
          )}
        </div>
      </section>

      <footer className="page-footer">
        <span>ECHOVIBE <span aria-hidden="true">·</span> THE UNSAID AMA</span>
        <span>Gentle questions. Honest choices.</span>
        <button className="footer-reset" onClick={resetJourney} type="button">Start over</button>
      </footer>
    </main>
  );
}
