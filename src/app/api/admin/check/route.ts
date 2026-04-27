import { type NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/admin";

/**
 * GET /api/admin/check?publicKey=0x...
 *
 * Read-only check that returns whether the given Ed25519 public key derives
 * to an address in the server's APTOS_ADMIN_ADDRESSES allowlist.
 *
 * Knowing the answer requires no signature — it's a public allowlist lookup.
 * Authorization for actual admin actions still requires a signed JWT.
 */
export function GET(request: NextRequest) {
  const publicKey = request.nextUrl.searchParams.get("publicKey");
  if (!publicKey) {
    return NextResponse.json(
      { error: "Missing publicKey parameter" },
      { status: 400 },
    );
  }
  return NextResponse.json({ isAdmin: isAdmin(publicKey) });
}
