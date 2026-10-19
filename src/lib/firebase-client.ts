import { getApp, getApps, initializeApp } from "@firebase/app";
import { getAuth } from "@firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const adminEmail = process.env.NEXT_PUBLIC_FIREBASE_ADMIN_EMAIL;

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.startsWith("your-"),
) && typeof adminEmail === "string" && adminEmail.includes("@") && !adminEmail.startsWith("admin@example");

export function getFirebaseAuth() {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not fully configured. Add the Firebase web app settings and admin email to .env.local.");
  }
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}
