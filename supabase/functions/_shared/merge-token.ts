// Signed, short-lived merge tokens (docs/ARCHITECTURE.md "Account merge flow").
// "The token is signed server-side and names uid A, so session B can prove a
// right to A's data without either session holding the other's credentials."
//
// Session A (anonymous) creates the token via its own RLS-scoped client, so
// it can freely read its OWN counts/names at that moment. Those are embedded
// directly in the signed payload — NOT re-queried later by session B, which
// (correctly) has no RLS access to uid A's rows. This is what lets
// mergePreview answer "what's on THIS PHONE" without any elevated privilege.
//
// NOTE: needs a `MERGE_TOKEN_SECRET` env var (not yet in the repo's
// .env.example, which this agent does not own — flagged in the handover
// report). Falls back to WORKER_INTERNAL_SECRET only so local/dev doesn't
// hard-fail before that's added; production must set MERGE_TOKEN_SECRET.

const MERGE_TOKEN_TTL_SECONDS = 15 * 60;

export interface MergeTokenPayload {
  sourceParentId: string;
  exp: number; // epoch seconds
  characters: number;
  stories: number;
  characterNames: string[];
}

function secretKeyMaterial(): string {
  const secret = Deno.env.get('MERGE_TOKEN_SECRET') ?? Deno.env.get('WORKER_INTERNAL_SECRET');
  if (!secret) throw new Error('MERGE_TOKEN_SECRET (or WORKER_INTERNAL_SECRET fallback) is not configured');
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secretKeyMaterial());
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toBase64Url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

export async function signMergeToken(
  payload: Omit<MergeTokenPayload, 'exp'>,
): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + MERGE_TOKEN_TTL_SECONDS;
  const full: MergeTokenPayload = { ...payload, exp };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(full));
  const payloadB64 = toBase64Url(payloadBytes);
  const key = await hmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(signature));
  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function verifyMergeToken(token: string): Promise<MergeTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const key = await hmacKey();
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64Url(sigB64).buffer as ArrayBuffer,
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as MergeTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
