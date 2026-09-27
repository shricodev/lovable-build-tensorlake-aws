import { getDb, users } from "@kiln/db";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { z } from "zod";

const devLoginEnabled =
  process.env.NODE_ENV !== "production" && ["1", "true"].includes(process.env.DEV_LOGIN ?? "");
const admins = (process.env.ADMIN_GITHUB_USERNAMES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const authProviders = {
  github: !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  dev: devLoginEnabled,
};

async function upsertUser(u: {
  githubId: string | null;
  username: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}) {
  const { db } = getDb();
  const [row] = await db
    .insert(users)
    .values({ ...u, isAdmin: admins.includes(u.username) })
    .onConflictDoUpdate({
      target: u.githubId ? users.githubId : users.username,
      set: { name: u.name, email: u.email, avatarUrl: u.avatarUrl, isAdmin: admins.includes(u.username) },
    })
    .returning();
  return row!;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    ...(authProviders.github
      ? [GitHub({ authorization: { params: { scope: "read:user user:email" } } })]
      : []),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev",
            name: "Dev login",
            credentials: { username: { label: "Username" } },
            async authorize(creds) {
              const parsed = z.object({ username: z.string().regex(/^[a-z0-9-]{2,32}$/i) }).safeParse(creds);
              if (!parsed.success) return null;
              const u = await upsertUser({
                githubId: null,
                username: `dev-${parsed.data.username.toLowerCase()}`,
                name: parsed.data.username,
              });
              return { id: u.id, name: u.name, image: u.avatarUrl };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "github" && profile) {
        const p = profile as {
          id?: number | string;
          login?: string;
          name?: string;
          email?: string;
          avatar_url?: string;
        };
        const u = await upsertUser({
          githubId: String(p.id),
          username: p.login ?? `gh-${p.id}`,
          name: p.name,
          email: p.email,
          avatarUrl: p.avatar_url,
        });
        token.uid = u.id;
      } else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
