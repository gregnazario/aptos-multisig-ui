import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware that adds CORS headers to API responses when CORS_ORIGIN is set.
 * Used for split deployments where the frontend is on a different domain.
 */
export function middleware(request: NextRequest) {
  const corsOrigin = process.env.CORS_ORIGIN;

  // Handle CORS preflight
  if (request.method === "OPTIONS" && corsOrigin) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const response = NextResponse.next();

  // Add CORS headers to all API responses
  if (corsOrigin) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
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

export const config = {
  matcher: "/api/:path*",
};
