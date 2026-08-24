export { auth as middleware } from "@/auth";

export const config = {
  // Everything except the auth routes, the login page, and static assets
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
