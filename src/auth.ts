import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { prisma } from "@/lib/db";
import { checkGuildAccess } from "@/lib/whitelist";

const adminIds = (process.env.ADMIN_DISCORD_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Discord({
      // guilds.members.read lets us check server roles without a bot token
      authorization:
        "https://discord.com/api/oauth2/authorize?scope=identify+guilds.members.read",
    }),
  ],
  callbacks: {
    /**
     * The gate. Three ways in, checked in order:
     *   1. Discord ID is in ADMIN_DISCORD_IDS  -> admin
     *   2. Discord ID is in the Whitelist table -> member
     *   3. User is in your guild with a required role -> member
     * Anyone else is bounced to /login?error=AccessDenied.
     */
    async signIn({ profile, account }) {
      const discordId = profile?.id as string | undefined;
      if (!discordId) return false;

      const isAdmin = adminIds.includes(discordId);
      const onList =
        !!(await prisma.whitelist.findUnique({ where: { discordId } }));
      const viaGuild = isAdmin || onList
        ? false
        : await checkGuildAccess(discordId, account?.access_token);

      if (!isAdmin && !onList && !viaGuild) return "/login?error=AccessDenied";

      const avatarUrl = profile?.avatar
        ? `https://cdn.discordapp.com/avatars/${discordId}/${profile.avatar}.png`
        : null;

      await prisma.user.upsert({
        where: { discordId },
        create: {
          discordId,
          username: (profile?.username as string) ?? "unknown",
          avatarUrl,
          approved: true,
          role: isAdmin ? "ADMIN" : "MEMBER",
          lastLoginAt: new Date(),
        },
        update: {
          username: (profile?.username as string) ?? "unknown",
          avatarUrl,
          approved: true,
          role: isAdmin ? "ADMIN" : "MEMBER",
          lastLoginAt: new Date(),
        },
      });

      return true;
    },

    async jwt({ token, profile }) {
      if (profile?.id) token.discordId = profile.id as string;
      if (token.discordId) {
        const user = await prisma.user.findUnique({
          where: { discordId: token.discordId as string },
          select: { id: true, role: true },
        });
        token.userId = user?.id;
        token.role = user?.role ?? "MEMBER";
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as "ADMIN" | "MEMBER";
        session.user.discordId = token.discordId as string;
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      discordId: string;
      role: "ADMIN" | "MEMBER";
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
