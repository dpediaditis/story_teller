import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import type { StorySummaryDto } from '@papercub/shared';
import { Screen, Text, Button } from '../../components';
import { apiClient, ApiCallError, errorCopy } from '../../lib/api';
import { useSignedMedia } from '../../lib/api/useSignedMedia';
import { colour, inkAlpha, radius, spacing, themeColour } from '../../theme';

/** E1 — Stories home, with the E2 empty state when the library has nothing yet. */
export function StoriesHomeScreen() {
  const [stories, setStories] = useState<StorySummaryDto[] | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* CLAUDE.md: "no try/catch that swallows. An unhandled network failure
   * renders the offline state, never a spinner forever." This had no catch at
   * all, so a failed load left an unhandled promise rejection and
   * `stories === null` — a permanently blank screen with no way out. It never
   * showed on the mock, which cannot fail; the first live 401 produced exactly
   * that. Reading is never gated behind sign-in (DECISIONS.md §12), so the
   * library failing to load must still be a screen the user can act on. */
  const load = useCallback(async () => {
    try {
      const res = await apiClient.call('listStories', { favouritesOnly, limit: 50, cursor: null });
      setStories(res.stories);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof ApiCallError ? errorCopy(err.apiError.copyKey) : errorCopy(undefined),
      );
      // Deliberately left as-is rather than cleared: stale stories beat an
      // empty library, and an empty library reads as "you have nothing".
      setStories((prev) => prev ?? []);
    }
  }, [favouritesOnly]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }


  /* Every cover in one batched media-sign. The cards used to render a flat
   * theme colour and never touch `story.cover`, which is right there on the
   * DTO — so a library of finished picture books looked like a stack of blue
   * rectangles. For a product whose entire promise is the picture, that was the
   * worst possible thing to leave out. */
  const { urls: coverUrls } = useSignedMedia((stories ?? []).map((s) => s.cover?.storageKey));

  if (stories === null) return <Screen />;

  if (loadError !== null && stories.length === 0) {
    return (
      <Screen>
        <View style={styles.header}>
          <Text variant="sectionHeading">Stories</Text>
        </View>
        <View style={styles.empty}>
          <Text variant="sectionHeading" style={{ textAlign: 'center' }}>
            We couldn’t load the library.
          </Text>
          <Text
            variant="body"
            color={inkAlpha.textBody}
            style={{ marginTop: spacing.sm, textAlign: 'center' }}
          >
            {loadError}
          </Text>
          <View style={{ marginTop: spacing.section }}>
            <Button label="Try again" onPress={() => void load()} />
          </View>
        </View>
      </Screen>
    );
  }

  if (stories.length === 0) {
    return (
      <Screen>
        <View style={styles.header}>
          <Text variant="sectionHeading">Stories</Text>
        </View>
        <View style={styles.empty}>
          <View style={styles.emptySpine} />
          <Text variant="sectionHeading" style={{ marginTop: spacing.huge, textAlign: 'center' }}>
            No stories yet.
          </Text>
          <Text variant="body" color={inkAlpha.textBody} style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            Photograph a drawing on Characters to make the first one.
          </Text>
          <View style={{ marginTop: spacing.huge, alignSelf: 'stretch' }}>
            <Button label="Add a character" onPress={() => router.push('/create/camera')} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="sectionHeading">Stories</Text>
        <View style={styles.filters}>
          <Pressable
            onPress={() => setFavouritesOnly(false)}
            style={[styles.filterPill, !favouritesOnly && styles.filterPillActive]}
          >
            <Text variant="label" color={!favouritesOnly ? colour.paperElevated : inkAlpha.textStrong}>All</Text>
          </Pressable>
          <Pressable
            onPress={() => setFavouritesOnly(true)}
            style={[styles.filterPill, favouritesOnly && styles.filterPillActive]}
          >
            <Text variant="label" color={favouritesOnly ? colour.paperElevated : inkAlpha.textStrong}>♥</Text>
          </Pressable>
        </View>
      </View>

      {/* There was NO way to start a story from the library once it had
          anything in it — the only entry point was the empty state, which you
          never see again after your first book. Characters is the honest
          destination: a story is always about somebody, so you choose who
          first. */}
      <View style={styles.newRow}>
        <Button label="＋  New story" kind="secondary" onPress={() => router.push('/tabs/characters')} />
      </View>

      <FlatList
        data={stories}
        keyExtractor={(s) => s.id}
        numColumns={2}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={{ gap: spacing.lgPlus }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <StorySpine story={item} coverUrl={coverUrls[item.cover?.storageKey ?? ''] ?? null} />
        )}
      />
    </Screen>
  );
}

function StorySpine({ story, coverUrl }: { story: StorySummaryDto; coverUrl: string | null }) {
  const spine = themeColour[story.theme];
  const isGenerating = story.status === 'queued' || story.status === 'generating' || story.status === 'partial';
  return (
    <Pressable
      style={styles.spineWrap}
      onPress={() => router.push(isGenerating ? `/create/generating?storyId=${story.id}` : `/story/${story.id}/reader`)}
    >
      <View style={[styles.spine, { backgroundColor: spine.fill, borderLeftColor: spine.deep }]}>
        {coverUrl ? (
          <>
            <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
            {/* The title sits ON the cover, so it needs its own ground to stay
                readable over whatever the illustrator produced. */}
            <View style={styles.spineScrim} />
          </>
        ) : null}
        <Text variant="sectionHeading" color={colour.paperElevated} numberOfLines={3} style={styles.spineTitle}>
          {story.title ?? `${story.characterNames[0] ?? 'A'} story — writing…`}
        </Text>
        {story.favouritedAt ? <View style={styles.heart} /> : null}
        {isGenerating ? (
          <View style={styles.generatingBadge}>
            <Text variant="captionMono" color={colour.paperElevated}>Making…</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  newRow: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.lgPlus },
  spineScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(20,18,15,0.34)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lgPlus,
  },
  filters: { flexDirection: 'row', gap: spacing.sm },
  filterPill: {
    height: 36,
    paddingHorizontal: spacing.lgPlus,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: inkAlpha.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterPillActive: { backgroundColor: colour.ink, borderColor: colour.ink },
  grid: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.section, gap: spacing.lgPlus },
  // `flex: 1` alone makes an ODD last item stretch across the whole row — a
  // finished book rendered three times the size of its siblings. maxWidth caps
  // it to its column.
  spineWrap: { flex: 1, maxWidth: '48%' },
  spine: {
    aspectRatio: 0.78,
    borderRadius: 6,
    borderTopRightRadius: radius.cardSm,
    borderBottomRightRadius: radius.cardSm,
    borderLeftWidth: 5,
    padding: spacing.md,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  spineTitle: { fontSize: 14, lineHeight: 16 },
  heart: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colour.warning,
  },
  generatingBadge: {
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: radius.chip,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.section },
  emptySpine: {
    width: 90,
    aspectRatio: 0.78,
    borderRadius: 6,
    backgroundColor: colour.paperCard,
    borderWidth: 1.5,
    borderColor: inkAlpha.border,
    borderStyle: 'dashed',
  },
});
