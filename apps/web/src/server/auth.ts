import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { db } from "./db";
import * as schema from "./db/schema";
import { adminEmails, devEmailLoginEnabled, env, googleEnabled, isProd } from "./env";

const e = env();

export const auth = betterAuth({
  appName: "Opal",
  baseURL: e.BETTER_AUTH_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  // Email/password exists only for local testing until email delivery is set up.
  emailAndPassword: {
    enabled: devEmailLoginEnabled(),
    autoSignIn: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  socialProviders: googleEnabled()
    ? {
        google: {
          clientId: e.GOOGLE_CLIENT_ID!,
          clientSecret: e.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  advanced: {
    cookiePrefix: "opal",
    useSecureCookies: isProd(),
    defaultCookieAttributes: { sameSite: "lax", httpOnly: true },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
    },
  },
  trustedOrigins: [e.BETTER_AUTH_URL],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const isAdmin = adminEmails().has(user.email.toLowerCase());
          return { data: { ...user, role: isAdmin ? "admin" : "user" } };
        },
      },
    },
  },
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    // Lets the iOS and desktop apps send `Authorization: Bearer <session token>`.
    bearer({ requireSignature: true }),
    // Hands a browser sign-in over to the desktop and iOS apps (opal://auth?token=...).
    // Server-generated only, single use, stored hashed, valid for 2 minutes.
    oneTimeToken({ expiresIn: 2, disableClientRequest: true, storeToken: "hashed" }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
