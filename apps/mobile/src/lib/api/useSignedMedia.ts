import { useEffect, useRef, useState } from 'react';
import { apiClient, isLiveBackend } from './index';

/**
 * Turns storage keys into displayable URLs.
 *
 * All four buckets are private (docs/ARCHITECTURE.md, "Storage"), so a
 * `storage_key` is never a URL and can never be handed to `<Image>` directly.
 * Reads go through a signed URL minted by `media-sign`, which runs with the
 * caller's JWT and therefore only ever signs keys under that caller's own uid
 * prefix. The screens previously rendered `picsum.photos/seed/<storageKey>` —
 * placeholder art from B3's mock era, which also meant a private storage key
 * was being put in a request to a third-party host.
 *
 * Batched on purpose: `signMedia` takes up to 64 keys, "one round trip per
 * screen" per its own header, so a reader with twelve pages signs once rather
 * than twelve times.
 */
export function useSignedMedia(storageKeys: (string | null | undefined)[]): {
  urls: Record<string, string>;
  loading: boolean;
} {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Signing is keyed on the SET of keys, not the array identity — a reader
  // re-rendering on every page turn must not re-sign the same twelve keys.
  const keys = storageKeys.filter((k): k is string => typeof k === 'string' && k.length > 0);
  const signature = [...new Set(keys)].sort().join('|');
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    if (!isLiveBackend || signature.length === 0) return;
    if (inFlight.current === signature) return;
    inFlight.current = signature;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const res = await apiClient.call('signMedia', {
          storageKeys: signature.split('|'),
          expiresInSeconds: 3600,
        });
        if (cancelled) return;
        setUrls((prev) => {
          const next = { ...prev };
          for (const m of res.media) next[m.storageKey] = m.url;
          return next;
        });
      } catch {
        // Left unresolved deliberately. The caller renders its own "still
        // being drawn" / offline state for a key with no URL; inventing a
        // placeholder here would show a child a picture that is not their
        // story (CLAUDE.md: no try/catch that swallows into a forever spinner).
        if (!cancelled) inFlight.current = null;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature]);

  return { urls, loading };
}
