import type { SharedAnswer } from "@/lib/firestore-rest";

const storageKey = "echovibe.local-responses.v1";

function isSharedAnswer(value: unknown): value is SharedAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value && typeof value.id === "string" &&
    "uid" in value && typeof value.uid === "string" &&
    "email" in value && typeof value.email === "string" &&
    "openingThought" in value && typeof value.openingThought === "string" &&
    "question" in value && typeof value.question === "string" &&
    "answer" in value && typeof value.answer === "string" &&
    "createdAt" in value && typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt))
  );
}

export function readLocalResponses(): SharedAnswer[] {
  const serialized = window.localStorage.getItem(storageKey);
  if (serialized === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Saved local responses could not be read because browser data is damaged.");
  }
  if (!Array.isArray(parsed) || !parsed.every(isSharedAnswer)) {
    throw new Error("Saved local responses could not be read because browser data is invalid.");
  }
  return parsed;
}

export function saveLocalResponse(
  response: Omit<SharedAnswer, "id" | "createdAt">,
): SharedAnswer {
  const saved: SharedAnswer = {
    ...response,
    id: typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  window.localStorage.setItem(storageKey, JSON.stringify([...readLocalResponses(), saved]));
  return saved;
}
