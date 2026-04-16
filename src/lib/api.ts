/**
 * API URL helper for split frontend/backend deployments.
 *
 * When NEXT_PUBLIC_API_URL is set, all API calls go to that remote server.
 * When empty (default), they use the local /api/ routes.
 *
 * Usage:
 *   fetch(apiUrl("/api/multisig/..."))
 *
 * For split deployment:
 *   Frontend (Vercel):  NEXT_PUBLIC_API_URL=""  (uses local routes, which proxy via rewrites)
 *   Backend (VPS):      Runs the same Next.js app with SQLite
 *
 * Or direct:
 *   Frontend: NEXT_PUBLIC_API_URL="https://api.example.com"
 *   Backend:  CORS_ORIGIN="https://app.example.com"
 */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) return path;
  // Strip trailing slash from base, ensure path starts with /
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
