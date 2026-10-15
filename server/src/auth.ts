import { config } from "./config.js";
import { hmac, timingSafeEqual } from "./crypto.js";

export const cookieName = "larper_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function issueToken(): string {
  const exp = Date.now() + TTL_MS;
  const payload = String(exp);
  return `${payload}.${hmac(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!timingSafeEqual(hmac(payload), sig)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

export function checkPassword(password: string | undefined): boolean {
  if (typeof password !== "string") return false;
  return timingSafeEqual(config.teamPassword, password);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.isProd,
  path: "/",
  maxAge: TTL_MS,
};
