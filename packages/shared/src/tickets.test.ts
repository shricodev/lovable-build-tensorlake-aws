import { beforeAll, describe, expect, it, vi } from "vitest";
import { signTicket, verifyTicket } from "./tickets";

beforeAll(() => {
  process.env.AUTH_SECRET = "x".repeat(40);
});

describe("tickets", () => {
  it("round-trips", () => {
    const t = verifyTicket(signTicket({ projectId: "p", userId: "u" }));
    expect(t).toMatchObject({ projectId: "p", userId: "u" });
  });

  it("rejects tampering and expiry", () => {
    const tok = signTicket({ projectId: "p", userId: "u" });
    const [body, sig] = tok.split(".");
    const forged = Buffer.from(JSON.stringify({ projectId: "other", userId: "u", exp: 9e9 })).toString(
      "base64url",
    );
    expect(verifyTicket(`${forged}.${sig}`)).toBeNull();
    expect(verifyTicket(`${body}.AAAA`)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    expect(verifyTicket(tok)).toBeNull();
    vi.useRealTimers();
  });
});
