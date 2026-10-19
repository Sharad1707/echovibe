import type { User } from "@firebase/auth";

export type SharedAnswer = {
  id: string;
  uid: string;
  email: string;
  openingThought: string;
  question: string;
  answer: string;
  createdAt: string;
};

type ResponseInput = Omit<SharedAnswer, "id" | "createdAt"> & {
  sharedWithAdmin: boolean;
};
type FirestoreValue = Record<string, unknown>;
type FirestoreDocument = {
  name?: string;
  createTime?: string;
  fields?: Record<string, FirestoreValue>;
};

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

function documentsUrl(suffix: string) {
  if (!projectId || projectId.startsWith("your-")) {
    throw new Error("Firebase project ID is not configured.");
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents${suffix}`;
}

function decodeString(value: FirestoreValue | undefined): string {
  return value && typeof value.stringValue === "string" ? value.stringValue : "";
}

function decodeDocument(document: FirestoreDocument): SharedAnswer {
  const fields = document.fields || {};
  const name = document.name || "";
  return {
    id: name.split("/").at(-1) || "",
    uid: decodeString(fields.uid),
    email: decodeString(fields.email),
    openingThought: decodeString(fields.openingThought),
    question: decodeString(fields.question),
    answer: decodeString(fields.answer),
    createdAt: typeof fields.createdAt?.timestampValue === "string"
      ? fields.createdAt.timestampValue
      : document.createTime || new Date(0).toISOString(),
  };
}

async function requestFirestore(user: User, url: string, body: unknown) {
  const token = await user.getIdToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: { message?: unknown } };
      detail = typeof payload.error?.message === "string" ? payload.error.message : "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Firestore request failed with status ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

export async function createResponse(user: User, response: ResponseInput): Promise<void> {
  const id = crypto.randomUUID();
  const name = `projects/${projectId}/databases/(default)/documents/responses/${id}`;
  await requestFirestore(user, documentsUrl(":commit"), {
    writes: [{
      update: {
        name,
        fields: {
          uid: { stringValue: response.uid },
          email: { stringValue: response.email },
          openingThought: { stringValue: response.openingThought },
          question: { stringValue: response.question },
          answer: { stringValue: response.answer },
          sharedWithAdmin: { booleanValue: response.sharedWithAdmin },
        },
      },
      updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { exists: false },
    }],
  });
}

export async function getResponses(user: User, isAdmin: boolean): Promise<SharedAnswer[]> {
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: "responses" }],
  };
  if (!isAdmin) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: "uid" },
        op: "EQUAL",
        value: { stringValue: user.uid },
      },
    };
  }

  const result = await requestFirestore(user, documentsUrl(":runQuery"), { structuredQuery });
  if (!Array.isArray(result)) throw new Error("Firestore returned an invalid responses list.");
  return result.flatMap((item): SharedAnswer[] => {
    if (typeof item !== "object" || item === null || !("document" in item)) return [];
    const document = item.document;
    if (typeof document !== "object" || document === null) return [];
    return [decodeDocument(document as FirestoreDocument)];
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
