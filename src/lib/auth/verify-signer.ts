import { NextResponse } from "next/server";
import { findSignerIndex } from "@/lib/aptos/multisig";
import { verifySessionToken } from "@/lib/auth/session";

/**
 * Verify the request has a valid JWT and the caller is a signer
 * on the given multisig. Returns the session payload or an error response.
 */
export async function verifySigner(
  authHeader: string | null,
  publicKeys: string[],
): Promise<
  | {
      ok: true;
      session: { publicKey: string; address: string; network: string };
    }
  | { ok: false; response: NextResponse }
> {
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Authentication required. Connect your wallet to view this multisig.",
        },
        { status: 401 },
      ),
    };
  }

  try {
    const session = await verifySessionToken(authHeader.slice(7));
    const signerIndex = findSignerIndex(publicKeys, session.publicKey);

    if (signerIndex === -1) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "You are not a signer on this multisig." },
          { status: 403 },
        ),
      };
    }

    return { ok: true, session };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired session. Please reconnect your wallet." },
        { status: 401 },
      ),
    };
  }
}
