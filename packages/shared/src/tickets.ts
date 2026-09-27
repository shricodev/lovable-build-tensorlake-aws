import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed tickets (HMAC-SHA256 with AUTH_SECRET) that let the web
 * app authorize a connection to another service (the gateway's terminal
 * socket) without sharing its session cookie across origins.
 */
export interface Ticket {
  projectId: string;
  userId: string;
  exp: number; // unix seconds
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is not set");
  return s;
}

export function signTicket(t: Omit<Ticket, "exp">, ttlSecs = 60): string {
  const body = b64(JSON.stringify({ ...t, exp: Math.floor(Date.now() / 1000) + ttlSecs }));
  return `${body}.${b64(createHmac("sha256", secret()).update(body).digest())}`;
}

export function verifyTicket(token: string): Ticket | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
    return t.exp > Date.now() / 1000 ? t : null;
  } catch {
    return null;
  }
}
