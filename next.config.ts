import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL;

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["better-sqlite3"],

  // When BACKEND_URL is set, proxy all /api/* requests to the remote backend.
  // This enables split deployments:
  //   Frontend (e.g. Vercel): BACKEND_URL=https://api.example.com
  //   Backend (e.g. VPS):     Runs this app with SQLite, no BACKEND_URL set
  ...(backendUrl
    ? {
        rewrites: async () => [
          {
            source: "/api/:path*",
            destination: `${backendUrl}/api/:path*`,
          },
        ],
      }
    : {}),
};

export default nextConfig;
