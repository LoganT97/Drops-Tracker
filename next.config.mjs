/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Lets verification builds run beside an active local dev server without
  // both processes writing to .next. Production keeps the normal directory.
  distDir: process.env.DROPS_NEXT_DIST_DIR || ".next",
};
export default nextConfig;
