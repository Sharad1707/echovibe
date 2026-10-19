type CompletionResponse = {
  question: string;
  answer: string;
};

type CompletionBody = {
  consent: true;
  responses: CompletionResponse[];
};

const recipientEmail = "sharadkasralikar1772@gmail.com";
const responseCount = 7;

function emailIsConfigured() {
  const firebaseSettings = [
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  ];
  const resendApiKey = process.env.RESEND_API_KEY;
  const senderEmail = process.env.RESEND_FROM_EMAIL;
  const adminEmail = process.env.NEXT_PUBLIC_FIREBASE_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(
    resendApiKey &&
    !resendApiKey.startsWith("add-your-") &&
    senderEmail &&
    !senderEmail.includes("your-verified-domain") &&
    firebaseSettings.every((value) => value && !value.startsWith("your-")) &&
    adminEmail?.includes("@") &&
    !adminEmail.startsWith("admin@example"),
  );
}

function isCompletionBody(value: unknown): value is CompletionBody {
  if (typeof value !== "object" || value === null || !("responses" in value)) return false;
  return (
    "consent" in value &&
    value.consent === true &&
    Array.isArray(value.responses) &&
    value.responses.length === responseCount &&
    value.responses.every((response) =>
      typeof response === "object" &&
      response !== null &&
      "question" in response &&
      typeof response.question === "string" &&
      response.question.trim().length > 0 &&
      response.question.length <= 320 &&
      "answer" in response &&
      typeof response.answer === "string" &&
      response.answer.trim().length > 0 &&
      response.answer.length <= 1500,
    )
  );
}

export async function GET() {
  return Response.json(
    { available: emailIsConfigured() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

async function getAuthenticatedUid(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([\w.-]+)$/.exec(authorization);
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!match || !apiKey) return null;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: match[1] }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) {
    console.error("Firebase could not validate the email notification request.", response.status);
    return null;
  }

  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    !("users" in result) ||
    !Array.isArray(result.users)
  ) {
    throw new Error("Firebase returned an invalid identity response.");
  }
  const user = result.users[0];
  return (
    typeof user === "object" &&
    user !== null &&
    "localId" in user &&
    typeof user.localId === "string"
  )
    ? user.localId
    : null;
}

export async function POST(request: Request) {
  if (!emailIsConfigured()) {
    return Response.json(
      { error: "Email notifications are not configured on the server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 16000) {
      return Response.json({ error: "The completed responses are too long to email." }, { status: 413 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return Response.json({ error: "Please send valid completed responses." }, { status: 400 });
  }

  if (
    !isCompletionBody(body) ||
    body.responses.some((response) => !response.question.trim() || !response.answer.trim())
  ) {
    return Response.json({ error: "The completed responses are invalid." }, { status: 400 });
  }

  let uid: string | null;
  try {
    uid = await getAuthenticatedUid(request);
  } catch (error) {
    console.error("Firebase identity verification failed for an email notification.", error);
    return Response.json({ error: "Could not verify your session. Please try again." }, { status: 502 });
  }
  if (!uid) {
    return Response.json({ error: "Your session could not be verified. Refresh the page and try again." }, { status: 401 });
  }

  const emailText = [
    "A participant completed an Echovibe reflection and agreed to email their responses.",
    "",
    ...body.responses.flatMap((response, index) => [
      index === 0 ? "Opening thought" : `Question ${index}: ${response.question}`,
      response.answer,
      "",
    ]),
  ].join("\n");

  let emailResponse: Response;
  try {
    emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [recipientEmail],
        subject: "Your completed Echovibe reflection",
        text: emailText,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    console.error("Resend could not be reached for a completed Echovibe reflection.", error);
    return Response.json({ error: "The email service could not be reached. Please retry." }, { status: 502 });
  }

  if (!emailResponse.ok) {
    console.error("Resend rejected a completed Echovibe reflection.", emailResponse.status);
    return Response.json(
      { error: "The email could not be sent. Check the mail service configuration and retry." },
      { status: emailResponse.status === 429 ? 503 : 502 },
    );
  }

  return Response.json({ sent: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
