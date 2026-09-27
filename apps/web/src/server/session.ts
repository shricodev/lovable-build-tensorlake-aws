import "server-only";
import { eq, getDb, users, type User } from "@kiln/db";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function currentUser(): Promise<User | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [u] = await getDb().db.select().from(users).where(eq(users.id, id));
  return u ?? null;
}

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
