import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { env } from "@/lib/env";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

/** Identity of the local demo account. Not a real person. */
export const DEMO_USER = { email: "demo@jobfinder.local", name: "Demo User" };

/**
 * Only used when AUTH_SECRET is missing outside production, so `npm run dev`
 * works with no configuration. Production refuses to start without a secret.
 */
const DEV_ONLY_SECRET = "dev-only-insecure-secret-set-AUTH_SECRET";

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const db = await getDb();

  const providers: NextAuthConfig["providers"] = [];
  if (env.googleConfigured) {
    providers.push(
      Google({
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
        authorization: {
          params: {
            scope: GOOGLE_SCOPES,
            // offline + consent makes Google return a refresh token every sign-in,
            // which the Sheets integration needs to work without the user present.
            access_type: "offline",
            prompt: "consent",
          },
        },
      }),
    );
  }
  if (env.demoLoginEnabled) {
    providers.push(
      Credentials({
        id: "demo",
        name: "Demo account",
        credentials: {},
        async authorize() {
          const existing = await db.query.users.findFirst({ where: eq(users.email, DEMO_USER.email) });
          if (existing) return existing;
          const [created] = await db.insert(users).values(DEMO_USER).returning();
          return created;
        },
      }),
    );
  }

  return {
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    // JWT sessions are required for the credentials (demo) provider; the
    // adapter still persists users and Google accounts (with refresh tokens).
    session: { strategy: "jwt" },
    secret: env.authSecret ?? (env.isProduction ? undefined : DEV_ONLY_SECRET),
    trustHost: true,
    providers,
    pages: { signIn: "/" },
    callbacks: {
      jwt({ token, user }) {
        if (user?.id) token.sub = user.id;
        return token;
      },
      session({ session, token }) {
        if (token.sub) session.user.id = token.sub;
        return session;
      },
    },
    events: {
      // The adapter only stores tokens when an account is first linked.
      // Keep them fresh on every Google sign-in so Sheets access keeps working.
      async signIn({ account }) {
        if (account?.provider !== "google") return;
        const update: Partial<typeof accounts.$inferInsert> = {
          access_token: account.access_token,
          expires_at: account.expires_at,
          scope: account.scope,
          id_token: account.id_token,
          token_type: account.token_type,
        };
        if (account.refresh_token) update.refresh_token = account.refresh_token;
        await db
          .update(accounts)
          .set(update)
          .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, account.providerAccountId)));
      },
    },
  };
});
