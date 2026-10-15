import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";

export interface ScryptParams {
  /** CPU/memory cost, a power of two. */
  N: number;
  /** Block size. */
  r: number;
  /** Parallelization. */
  p: number;
}

/** OWASP-recommended scrypt minimum (N=2^15, r=8, p=1): about 32 MiB of memory per hash. */
export const DEFAULT_SCRYPT_PARAMS: Readonly<ScryptParams> = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
});

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const FORMAT_PREFIX = "scrypt";

/**
 * Upper bounds for parameters read from a stored string. A hash string comes from our own database, but a corrupt
 * or tampered row must not make the API allocate gigabytes: anything above is treated as malformed (verify -> false).
 */
const MAX_N = 2 ** 17;
const MAX_R = 16;
const MAX_P = 16;

const DECIMAL = /^[1-9][0-9]*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Fixed salt of the dummy verification; its value is irrelevant, only the work matters. */
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 0x5a);

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && (value & (value - 1)) === 0;
}

function decodeStrictBase64(text: string, expectedBytes: number): Buffer | undefined {
  if (!BASE64.test(text)) {
    return undefined;
  }
  const bytes = Buffer.from(text, "base64");
  // Round trip rejects lenient decoding (stray characters, wrong padding).
  return bytes.length === expectedBytes && bytes.toString("base64") === text ? bytes : undefined;
}

function parseParam(text: string | undefined, max: number): number | undefined {
  if (text === undefined || !DECIMAL.test(text)) {
    return undefined;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= max ? value : undefined;
}

function parseStoredHash(stored: unknown): ParsedHash | undefined {
  if (typeof stored !== "string") {
    return undefined;
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) {
    return undefined;
  }
  const [, nText, rText, pText, saltText, hashText] = parts;
  const N = parseParam(nText, MAX_N);
  const r = parseParam(rText, MAX_R);
  const p = parseParam(pText, MAX_P);
  if (N === undefined || r === undefined || p === undefined || !isPowerOfTwo(N)) {
    return undefined;
  }
  const salt = decodeStrictBase64(saltText ?? "", SALT_BYTES);
  const hash = decodeStrictBase64(hashText ?? "", KEY_BYTES);
  return salt === undefined || hash === undefined ? undefined : { params: { N, r, p }, salt, hash };
}

/** Memory scrypt needs is about 128*N*r bytes (+128*r*p); Node refuses anything above `maxmem`, whose default is 32 MiB. */
function maxmemFor({ N, r, p }: ScryptParams): number {
  return 128 * N * r + 128 * r * p + 8 * 1024 * 1024;
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // The asynchronous variant runs in the libuv thread pool; the synchronous one would block the event loop.
    crypto.scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) },
      (error, key) => (error === null ? resolve(key) : reject(error)),
    );
  });
}

/**
 * Password hashing for admin users (ADR 0009). The format `scrypt$N$r$p$<salt b64>$<hash b64>` carries its own
 * parameters, so they can be raised later: `needsRehash` tells the login to store a fresh hash.
 * Passwords are used as exact UTF-8 text (no Unicode normalization), so that nothing a user typed is silently altered.
 */
@Injectable()
export class PasswordHasher {
  constructor(private readonly params: Readonly<ScryptParams> = DEFAULT_SCRYPT_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES);
    const key = await derive(password, salt, this.params);
    const { N, r, p } = this.params;
    return [FORMAT_PREFIX, N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
  }

  /** Never throws for a bad `stored` value or password: an unreadable hash simply does not match. */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseStoredHash(stored);
    if (parsed === undefined || typeof password !== "string") {
      return false;
    }
    const key = await derive(password, parsed.salt, parsed.params);
    return crypto.timingSafeEqual(key, parsed.hash);
  }

  /** True when the string is unreadable or was made with other parameters than this instance uses. */
  needsRehash(stored: string): boolean {
    const parsed = parseStoredHash(stored);
    if (parsed === undefined) {
      return true;
    }
    const { N, r, p } = parsed.params;
    return N !== this.params.N || r !== this.params.r || p !== this.params.p;
  }

  /** For an unknown email at login: spends the same scrypt work as `verify`, so response time does not reveal accounts. */
  async verifyDummy(password: string): Promise<false> {
    await derive(typeof password === "string" ? password : "", DUMMY_SALT, this.params);
    return false;
  }
}
