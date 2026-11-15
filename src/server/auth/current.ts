import { cookies } from "next/headers";
import { parseSession, SESSION_COOKIE, type Session } from "./session";

export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  return parseSession(store.get(SESSION_COOKIE)?.value);
}
