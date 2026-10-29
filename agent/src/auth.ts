import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getAddress, type Address } from "viem";
import { generateSiweNonce, parseSiweMessage, verifySiweMessage } from "viem/siwe";
import type { Clients } from "./chain.ts";

/**
 * Sign-In with Ethereum for freelancers. The wallet that signs in is the wallet that gets
 * paid, so there are no passwords: a short-lived nonce, an EIP-4361 message signed in the
 * browser wallet, and an HMAC session token bound to the address.
 */

const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_S = 7 * 86_400;

export interface AuthedRequest extends Request {
  wallet?: Address;
}

export class Auth {
  private nonces = new Map<string, number>();
  private readonly secret: Buffer;

  constructor(
    private readonly clients: Clients,
    secret: string | undefined,
    private readonly domain: string,
  ) {
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  nonce(): string {
    const now = Date.now();
    for (const [n, exp] of this.nonces) if (exp < now) this.nonces.delete(n);
    const n = generateSiweNonce();
    this.nonces.set(n, now + NONCE_TTL_MS);
    return n;
  }

  async verify(message: string, signature: `0x${string}`): Promise<{ token: string; wallet: Address; expiresAt: number }> {
    const fields = parseSiweMessage(message);
    if (!fields.nonce || !this.nonces.has(fields.nonce)) throw new Error("unknown or expired nonce");
    if (fields.domain !== this.domain) throw new Error(`message is for ${fields.domain}, expected ${this.domain}`);
    const ok = await verifySiweMessage(this.clients.publicClient, { message, signature, domain: this.domain });
    if (!ok || !fields.address) throw new Error("signature does not match");
    this.nonces.delete(fields.nonce);

    const wallet = getAddress(fields.address);
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
    return { token: this.sign(`${wallet}.${expiresAt}`), wallet, expiresAt };
  }

  private sign(payload: string) {
    const mac = createHmac("sha256", this.secret).update(payload).digest("base64url");
    return `${Buffer.from(payload).toString("base64url")}.${mac}`;
  }

  /** Express middleware: `Authorization: Bearer <session>` → req.wallet. */
  require = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const [body, mac] = token.split(".");
    if (!body || !mac) return res.status(401).json({ error: "sign in first" });
    const payload = Buffer.from(body, "base64url").toString();
    const expected = createHmac("sha256", this.secret).update(payload).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return res.status(401).json({ error: "invalid session" });
    }
    const [wallet, exp] = payload.split(".");
    if (!wallet || Number(exp) < Date.now() / 1000) return res.status(401).json({ error: "session expired" });
    req.wallet = wallet as Address;
    next();
  };
}
