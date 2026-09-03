import { base64UrlDecode, bytes, timingSafeEqual, utf8 } from "./crypto";

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
  [key: string]: unknown;
}

export interface IdTokenClaims {
  aud: string | string[];
  iss: string;
  tid: string;
  sub?: string;
  oid?: string;
  nonce?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  exp: number;
  nbf?: number;
  iat?: number;
  [key: string]: unknown;
}

export interface ParsedJwt {
  header: JwtHeader;
  payload: Record<string, unknown>;
  signingInput: Uint8Array;
  signature: Uint8Array;
}

export class TenantVerificationError extends Error {
  readonly code = "tenant_verification_failed";

  constructor(message = "Microsoft account tenant could not be verified") {
    super(message);
    this.name = "TenantVerificationError";
  }
}

export function expectedTenantIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0`;
}

export function verifyTenantId(actualTenantId: unknown, expectedTenantId: string): void {
  if (typeof actualTenantId !== "string" || !expectedTenantId || !timingSafeEqual(actualTenantId.toLowerCase(), expectedTenantId.toLowerCase())) {
    throw new TenantVerificationError("This account belongs to a different Microsoft organization");
  }
}

function decodeJsonPart(value: string, label: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(utf8(base64UrlDecode(value))) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("not an object");
    return decoded as Record<string, unknown>;
  } catch {
    throw new TenantVerificationError(`Malformed Microsoft ${label}`);
  }
}

export function parseJwt(token: string): ParsedJwt {
  if (typeof token !== "string") throw new TenantVerificationError("Malformed Microsoft identity token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new TenantVerificationError("Malformed Microsoft identity token");
  }
  const header = decodeJsonPart(parts[0], "identity token header") as JwtHeader;
  const payload = decodeJsonPart(parts[1], "identity token payload");
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(parts[2]);
  } catch {
    throw new TenantVerificationError("Malformed Microsoft identity token signature");
  }
  if (!header.alg || header.alg === "none" || header.alg !== "RS256") {
    throw new TenantVerificationError("Unsupported Microsoft identity token algorithm");
  }
  return {
    header,
    payload,
    signingInput: bytes(`${parts[0]}.${parts[1]}`),
    signature,
  };
}

export interface IdTokenValidationOptions {
  tenantId: string;
  clientId: string;
  nonce?: string;
  /** Unix seconds. */
  now?: number;
  clockSkewSeconds?: number;
}

export function assertIdTokenClaims(
  claims: Record<string, unknown>,
  options: IdTokenValidationOptions,
): asserts claims is IdTokenClaims {
  verifyTenantId(claims.tid, options.tenantId);
  if (typeof claims.iss !== "string" || !timingSafeEqual(claims.iss.toLowerCase(), expectedTenantIssuer(options.tenantId).toLowerCase())) {
    throw new TenantVerificationError("Microsoft identity token issuer is not the USM tenant");
  }
  const audience = claims.aud;
  const audienceMatches = typeof audience === "string"
    ? audience === options.clientId
    : Array.isArray(audience) && audience.includes(options.clientId);
  if (!audienceMatches) throw new TenantVerificationError("Microsoft identity token was issued for another application");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (!Number.isFinite(claims.exp) || (claims.exp as number) < now - skew) {
    throw new TenantVerificationError("Microsoft sign-in has expired");
  }
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || (claims.nbf as number) > now + skew)) {
    throw new TenantVerificationError("Microsoft sign-in is not active yet");
  }
  if (options.nonce !== undefined && (typeof claims.nonce !== "string" || !timingSafeEqual(claims.nonce, options.nonce))) {
    throw new TenantVerificationError("Microsoft sign-in could not be bound to this browser");
  }
}

export interface JsonWebKeySet {
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

export interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchTenantJwks(
  tenantId: string,
  fetchImpl?: FetchLike,
): Promise<JsonWebKeySet> {
  if (!tenantId || /[/?#]/.test(tenantId)) throw new TenantVerificationError("Invalid USM tenant configuration");
  if (!fetchImpl) {
    if (!globalThis.fetch) throw new TenantVerificationError("Microsoft sign-in metadata is unavailable");
    fetchImpl = globalThis.fetch.bind(globalThis);
  }
  const metadataUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`;
  let metadataResponse: Response;
  try {
    metadataResponse = await fetchImpl(metadataUrl, { headers: { Accept: "application/json" } });
  } catch {
    throw new TenantVerificationError("Microsoft sign-in metadata is temporarily unavailable");
  }
  if (!metadataResponse.ok) throw new TenantVerificationError("Microsoft sign-in metadata is unavailable");
  const metadata = await responseJson(metadataResponse) as { jwks_uri?: unknown } | null;
  if (!metadata || typeof metadata.jwks_uri !== "string" || !metadata.jwks_uri.startsWith("https://login.microsoftonline.com/")) {
    throw new TenantVerificationError("Microsoft sign-in metadata is invalid");
  }

  let jwksResponse: Response;
  try {
    jwksResponse = await fetchImpl(metadata.jwks_uri, { headers: { Accept: "application/json" } });
  } catch {
    throw new TenantVerificationError("Microsoft signing keys are temporarily unavailable");
  }
  if (!jwksResponse.ok) throw new TenantVerificationError("Microsoft signing keys are unavailable");
  const jwks = await responseJson(jwksResponse) as Partial<JsonWebKeySet> | null;
  if (!jwks || !Array.isArray(jwks.keys)) throw new TenantVerificationError("Microsoft signing keys are invalid");
  return jwks as JsonWebKeySet;
}

export async function verifyJwtSignature(parsed: ParsedJwt, jwks: JsonWebKeySet): Promise<boolean> {
  const kid = parsed.header.kid;
  if (!kid) return false;
  const jwk = jwks.keys.find((key) => key.kid === kid && key.kty === "RSA" && (!key.alg || key.alg === "RS256"));
  if (!jwk) return false;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      parsed.signature as BufferSource,
      parsed.signingInput as BufferSource,
    );
  } catch {
    return false;
  }
}

export interface VerifyIdTokenOptions extends IdTokenValidationOptions {
  fetchImpl?: FetchLike;
  jwks?: JsonWebKeySet;
  /** Defaults to true. Set false only in narrowly scoped local unit tests. */
  verifySignature?: boolean;
}

export async function verifyIdToken(token: string, options: VerifyIdTokenOptions): Promise<IdTokenClaims> {
  const parsed = parseJwt(token);
  assertIdTokenClaims(parsed.payload, options);
  if (options.verifySignature ?? true) {
    const jwks = options.jwks ?? await fetchTenantJwks(options.tenantId, options.fetchImpl);
    if (!(await verifyJwtSignature(parsed, jwks))) {
      throw new TenantVerificationError("Microsoft identity token signature could not be verified");
    }
  }
  return parsed.payload;
}
