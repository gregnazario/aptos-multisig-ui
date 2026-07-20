import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";
import { type SessionPayload, verifySessionToken } from "@/lib/auth/session";

/**
 * Verify the request carries a valid JWT whose signer is in the admin
 * allowlist. Admin status is re-derived from the token's public key via
 * {@link isAdmin} rather than trusting the token's own `isAdmin` claim, so an
 * admin removed from APTOS_ADMIN_ADDRESSES loses access immediately instead of
 * when their token expires. Returns the session payload or an error response.
 */
export async function verifyAdmin(
  authHeader: string | null,
): Promise<
  { ok: true; session: SessionPayload } | { ok: false; response: NextResponse }
> {
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required. Connect your wallet." },
        { status: 401 },
      ),
    };
  }

  let session: SessionPayload;
  try {
    session = await verifySessionToken(authHeader.slice(7));
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired session. Please reconnect your wallet." },
        { status: 401 },
      ),
    };
  }

  if (!isAdmin(session.publicKey)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You are not authorized as an admin." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session };
}
