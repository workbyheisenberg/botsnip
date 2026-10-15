import crypto from "node:crypto";
import fs from "node:fs";
import { DATA_DIR, SECRETS_FILE, config } from "./config.js";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

let cachedKey: Buffer | null = null;

/**
 * Resolve the master secret used to encrypt buying-wallet keys and sign
 * session cookies. Order: MASTER_KEY env var, then a generated secret
 * persisted in server/data/.secrets.json.
 */
export function masterSecret(): string {
  if (config.masterKey) return config.masterKey;
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
      if (parsed?.masterKey) return String(parsed.masterKey);
    }
  } catch {
    /* fall through and regenerate */
  }
  const generated = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    SECRETS_FILE,
    JSON.stringify({ masterKey: generated, createdAt: new Date().toISOString() }, null, 2),
  );
  return generated;
}

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = masterSecret();
  const salt = crypto.createHash("sha256").update(`larper::${secret.slice(0, 24)}`).digest();
  cachedKey = crypto.scryptSync(secret, salt, 32);
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== PREFIX) throw new Error("Unsupported secret format");
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function hmac(value: string): string {
  return crypto.createHmac("sha256", key()).update(value).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
