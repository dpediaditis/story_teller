import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import type { StoryDetailDto } from '@papercub/shared';

/**
 * The book, as a file a family can keep.
 *
 * This existed as a bullet on the paywall — "PDF export, for printing and
 * keeping" — and nowhere else in the codebase. It was being charged for and it
 * did not exist, which is the worst version of a missing feature.
 *
 * It also happens to be the thing this product is for. A Papercub story starts
 * as a drawing on paper, and the one ending a parent actually wants is it going
 * back onto paper. Every comparable product that sells a subscription offers
 * some form of keepsake output.
 *
 * Images are embedded as data URIs rather than left as signed URLs. The print
 * renderer would have to fetch them itself, on a page that may be laid out
 * before the fetch returns, and the URLs expire — a PDF whose pictures vanish
 * after an hour is worse than no PDF. It costs a base64 pass over a few
 * megabytes, which is a second on a phone and happens once.
 */

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** No Buffer and no reliable btoa in React Native. */
function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2];
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64[c & 63];
  }
  return out;
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? 'image/jpeg';
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${type};base64,${toBase64(bytes)}`;
  } catch {
    // One missing picture must not lose the whole book. The page renders with
    // its words and a blank frame.
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `signedUrls` must already contain the cover and every page illustration —
 * the reader has them, and signing again here would be a second round trip for
 * URLs the caller is holding.
 */
export async function exportStoryPdf(
  story: StoryDetailDto,
  signedUrls: Record<string, string>,
): Promise<void> {
  const coverUrl = story.cover ? signedUrls[story.cover.storageKey] : undefined;
  const cover = coverUrl ? await fetchAsDataUri(coverUrl) : null;

  const pages = await Promise.all(
    story.pages
      .filter((page) => page.status === 'ready')
      .sort((a, b) => a.index - b.index)
      .map(async (page) => {
        const url = page.illustration ? signedUrls[page.illustration.storageKey] : undefined;
        return { index: page.index, text: page.text, image: url ? await fetchAsDataUri(url) : null };
      }),
  );

  const title = escapeHtml(story.title ?? 'A Papercub story');
  const characters = escapeHtml(story.characterNames.filter(Boolean).join(' and '));

  const html = `
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #14120f; }
  .sheet {
    page-break-after: always;
    height: 100vh;
    padding: 48px 56px;
    display: flex;
    flex-direction: column;
    background: #faf6ef;
  }
  .sheet:last-child { page-break-after: auto; }
  .cover { align-items: center; justify-content: center; text-align: center; }
  .cover img { width: 100%; border-radius: 18px; margin-bottom: 40px; }
  .cover h1 { font-size: 40px; line-height: 1.1; margin: 0 0 14px; }
  .cover p { font-size: 17px; color: #6a6157; margin: 0; }
  .art { width: 100%; border-radius: 14px; margin-bottom: 36px; }
  .art-missing { width: 100%; aspect-ratio: 4 / 3; border-radius: 14px; background: #efe7db; margin-bottom: 36px; }
  .prose { font-size: 25px; line-height: 1.55; margin: 0; }
  .folio { margin-top: auto; padding-top: 28px; font-size: 12px; letter-spacing: .08em; color: #9a9186; text-transform: uppercase; }
</style>
<div class="sheet cover">
  ${cover ? `<img src="${cover}" />` : ''}
  <h1>${title}</h1>
  ${characters ? `<p>A story about ${characters}</p>` : ''}
</div>
${pages
  .map(
    (page) => `
<div class="sheet">
  ${page.image ? `<img class="art" src="${page.image}" />` : '<div class="art-missing"></div>'}
  <p class="prose">${escapeHtml(page.text)}</p>
  <div class="folio">${page.index} &middot; Papercub</div>
</div>`,
  )
  .join('')}
`;

  const { uri } = await Print.printToFileAsync({ html });

  /* `printToFileAsync` names the file after a UUID. That name is what shows up
   * in Files, in the AirDrop sheet and on the printed header, and
   * "4A2760CB-4A32-4D99.pdf" is not a keepsake. */
  let shareUri = uri;
  try {
    const safeTitle =
      (story.title ?? 'Papercub story').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 60) ||
      'Papercub story';
    const named = new File(new Directory(Paths.cache), `${safeTitle}.pdf`);
    if (named.exists) named.delete();
    new File(uri).move(named);
    shareUri = named.uri;
  } catch {
    // Keep the ugly name rather than lose the book.
  }

  /* Hand it straight to the share sheet. Writing a PDF into the app's sandbox
   * and telling a parent where it went is not "export" — the only useful
   * version of this ends with the file in AirDrop, Files, or a printer. */
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: story.title ?? 'Papercub story',
    });
  }
}
