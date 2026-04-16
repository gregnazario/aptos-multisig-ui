import { NextResponse } from "next/server";

/**
 * Add CORS headers to a response when CORS_ORIGIN is configured.
 * Used for split deployments where the frontend is on a different domain.
 */
export function withCors(response: NextResponse): NextResponse {
  const origin = process.env.CORS_ORIGIN;
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
  }
  return response;
}

/**
 * Handle CORS preflight requests.
 */
export function corsOptions(): NextResponse | null {
  const origin = process.env.CORS_ORIGIN;
  if (!origin) return null;
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
