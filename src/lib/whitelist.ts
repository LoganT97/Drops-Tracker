/**
 * Optional second gate: allow anyone who is in your Discord server and holds
 * one of the required roles. Handy when your buyer group already lives in
 * Discord and you don't want to maintain a second list by hand.
 *
 * Uses the user's own access token (guilds.members.read scope). Falls back to a
 * bot token if you'd rather not ask for the extra scope.
 */
export async function checkGuildAccess(
  discordId: string,
  accessToken?: string | null,
): Promise<boolean> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return false;

  const requiredRoles = (process.env.DISCORD_REQUIRED_ROLE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let member: { roles?: string[] } | null = null;

  if (accessToken) {
    const res = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${guildId}/member`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok) member = await res.json();
  } else if (process.env.DISCORD_BOT_TOKEN) {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } },
    );
    if (res.ok) member = await res.json();
  }

  if (!member) return false;                 // not in the server
  if (requiredRoles.length === 0) return true; // membership alone is enough
  return (member.roles ?? []).some((r) => requiredRoles.includes(r));
}
