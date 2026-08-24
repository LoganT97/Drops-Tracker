import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: 120 }}>
      <div className="wordmark" style={{ marginBottom: 20 }}>Drop Buddy</div>
      <h1 className="title">Members only</h1>
      <p className="subtitle">
        Sign in with Discord. Access is limited to approved members of the server.
      </p>

      {error === "AccessDenied" && (
        <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 20 }}>
          That Discord account isn’t on the list. Ask an admin to add you, then try again.
        </p>
      )}

      <form
        action={async () => {
          "use server";
          await signIn("discord", { redirectTo: "/" });
        }}
      >
        <button className="primary-btn" type="submit">Continue with Discord</button>
      </form>
    </main>
  );
}
