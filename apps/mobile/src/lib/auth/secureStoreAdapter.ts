import * as SecureStore from 'expo-secure-store';

/**
 * Supabase's `Storage` interface, backed by `expo-secure-store` (the iOS
 * Keychain / Android Keystore) — NEVER AsyncStorage, which is unencrypted
 * (see B5 brief, CLAUDE.md rule 1's spirit applied to auth: nothing that can
 * impersonate a signed-in user may sit in plaintext on disk).
 *
 * SecureStore enforces a ~2048 byte ceiling per item on iOS. A Supabase
 * session (access token + refresh token + user + identities) regularly
 * exceeds that, so values are transparently chunked across `${key}__0`,
 * `${key}__1`, … with a small manifest at `${key}__meta`. This is a storage
 * detail only — callers still see a single logical key.
 */

const CHUNK_SIZE = 1800; // headroom under SecureStore's ~2048 byte item limit
const META_SUFFIX = '__meta';
const CHUNK_SUFFIX = (i: number) => `__${i}`;

async function readManifest(key: string): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(key + META_SUFFIX);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const count = await readManifest(key);
    if (count === null) {
      // Falls back to a single legacy (unchunked) read for values written
      // before chunking existed, or values small enough to fit in one item.
      return SecureStore.getItemAsync(key);
    }
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(key + CHUNK_SUFFIX(i));
      if (part === null) return null; // manifest/chunk mismatch — treat as missing
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear any previous shape (single item or a different chunk count)
    // before writing, so stale chunks never linger.
    await secureStoreAdapter.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(key + CHUNK_SUFFIX(i), chunk)));
    await SecureStore.setItemAsync(key + META_SUFFIX, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const count = await readManifest(key);
    if (count !== null) {
      await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(key + CHUNK_SUFFIX(i))));
      await SecureStore.deleteItemAsync(key + META_SUFFIX);
    }
    // Always also attempt the unchunked key — cheap and covers the legacy case.
    await SecureStore.deleteItemAsync(key);
  },
};
