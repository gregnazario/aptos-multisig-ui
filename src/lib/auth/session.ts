import "server-only";
import { jwtVerify, SignJWT } from "jose";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET is required in production. Set it via the deployment environment.",
  );
}
const secret = new TextEncoder().encode(rawSecret ?? "dev-secret");

export interface SessionPayload {
  publicKey: string;
  address: string;
  network: string;
  isAdmin?: boolean;
}

export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .setIssuedAt()
    .sign(secret);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as SessionPayload;
}
