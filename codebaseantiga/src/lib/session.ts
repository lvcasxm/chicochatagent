// Client-side session tracking with 30-min inactivity timeout.
// A "session" groups conversations and events for the same user activity window.

const SESSION_KEY = "cc_session_id";
const LAST_AT_KEY = "cc_session_last_at";
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback (very rare)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns the current session id, creating a new one if more than 30 min
 * have passed since the last activity. Touches the timestamp on every call.
 */
export function getSessionId(): string {
  try {
    const now = Date.now();
    const last = Number(localStorage.getItem(LAST_AT_KEY) || 0);
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid || !last || now - last > TIMEOUT_MS) {
      sid = uuid();
      localStorage.setItem(SESSION_KEY, sid);
    }
    localStorage.setItem(LAST_AT_KEY, String(now));
    return sid;
  } catch {
    return uuid();
  }
}

/** Force a brand new session id (e.g. on logout). */
export function resetSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LAST_AT_KEY);
  } catch { /* ignore */ }
}
