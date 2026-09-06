import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, hitTarget } from '@manassah/tokens';
import { Text, Icon, Button, Input, BottomSheet, EmptyState, ErrorState, ScreenSkeleton, PdfView, type PdfViewHandle } from '@/ui';
import { useBook, useBookRead, useReaderProgress, useToggleBookmark } from '@/features/queries';
import { ApiError } from '@/api/client';
import type { ViewerMessage } from '@/lib/pdfViewer';

/** القارئ: داخل التطبيق فقط، علامة مائية باسم القارئ، تقدّم وإشارات مرجعية تُحفظ في الخادم */
export default function Reader() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = Number(id);
  const access = useBookRead(bookId);
  const book = useBook(bookId);
  const saveProgress = useReaderProgress(bookId);
  const toggleBookmark = useToggleBookmark(bookId);
  const viewer = useRef<PdfViewHandle>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [sheet, setSheet] = useState<null | 'toc' | 'goto'>(null);
  const [gotoValue, setGotoValue] = useState('');
  const [viewerError, setViewerError] = useState<string | null>(null);
  const lastSaved = useRef(0);

  useEffect(() => { if (access.data) { setBookmarks(access.data.bookmarks); if (access.data.lastPage) setPage(access.data.lastPage); } }, [access.data]);
  const onMessage = useCallback((m: ViewerMessage) => {
    if (m.type === 'loaded') setPages(m.pages);
    else if (m.type === 'page') { setPage(m.page); if (Math.abs(m.page - lastSaved.current) >= 2 && access.data?.kind === 'full') { lastSaved.current = m.page; saveProgress.mutate(m.page); } }
    else if (m.type === 'error') setViewerError(m.message);
  }, [access.data?.kind, saveProgress]);
  useEffect(() => () => { if (access.data?.kind === 'full' && page > 1) saveProgress.mutate(page); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paywall = access.error instanceof ApiError && access.error.status === 402;
  const preview = access.data?.kind === 'preview';
  const marked = bookmarks.includes(page);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} style={styles.btn} accessibilityRole="button" accessibilityLabel={t('common.close')}><Icon name="close" size={24} /></Pressable>
        <View style={styles.flex}>
          <Text role="bodyMedium" numberOfLines={1} center>{book.data?.title ?? ''}</Text>
          {pages ? <Text role="caption" tone="secondary" center tabular>{t('reader.page', { p: page, n: pages })}</Text> : null}
        </View>
        {access.data?.kind === 'full' ? (
          <Pressable onPress={() => toggleBookmark.mutate(page, { onSuccess: r => setBookmarks(r.bookmarks) })} style={styles.btn} accessibilityRole="button" accessibilityLabel={t('reader.bookmark')}>
            <Icon name={marked ? 'bookmarkFilled' : 'bookmark'} size={22} color={marked ? colors.brand.gold : colors.text.primary} />
          </Pressable>
        ) : <View style={styles.btn} />}
        <Pressable onPress={() => setSheet('toc')} style={styles.btn} accessibilityRole="button" accessibilityLabel={t('reader.contents')}><Icon name="list" size={22} /></Pressable>
      </View>

      <View style={styles.body}>
        {access.isLoading ? <ScreenSkeleton />
          : paywall ? <EmptyState icon="lock" title={t('readerUi.buyToContinue')} body={t('book.protected')} actionLabel={t('book.buyNow')} onAction={() => router.replace(`/book/${bookId}`)} />
          : access.error ? <ErrorState error={access.error} onRetry={() => access.refetch()} />
          : viewerError ? <EmptyState icon="warning" title={t('readerUi.unsupported')} body={viewerError} actionLabel={t('common.retry')} onAction={() => { setViewerError(null); access.refetch(); }} />
          : access.data ? (
            <View style={styles.flex}>
              <PdfView ref={viewer} url={access.data.url} startPage={access.data.lastPage ?? 1} maxPages={preview ? access.data.previewPages ?? 5 : 0} onMessage={onMessage} />
              {access.data.watermark ? (
                <View pointerEvents="none" style={styles.watermark}>
                  {Array.from({ length: 5 }).map((_, i) => <Text key={i} role="caption" tone="tertiary" style={styles.wmText}>{access.data!.watermark}</Text>)}
                </View>
              ) : null}
            </View>
          ) : null}
      </View>

      {preview ? (
        <View style={styles.banner}>
          <View style={styles.flex}><Text role="bodyMedium">{t('readerUi.previewBanner', { n: access.data?.previewPages ?? 5 })}</Text><Text role="caption" tone="secondary">{t('readerUi.buyToContinue')}</Text></View>
          <Button label={t('book.buyNow')} size="sm" onPress={() => router.replace(`/book/${bookId}`)} />
        </View>
      ) : (
        <View style={styles.foot}>
          <Text role="caption" tone="tertiary" style={styles.flex}>{t('readerUi.protectedNote')}</Text>
          <Button label={t('reader.goTo')} variant="ghost" size="sm" onPress={() => setSheet('goto')} />
        </View>
      )}

      <BottomSheet visible={sheet === 'toc'} onClose={() => setSheet(null)} title={t('reader.contents')}>
        {bookmarks.length ? (
          <View style={styles.tocGroup}><Text role="caption" tone="secondary">{t('reader.bookmarks')}</Text>
            {bookmarks.map(p => <Pressable key={p} onPress={() => { viewer.current?.goto(p); setSheet(null); }} style={styles.tocRow}><Icon name="bookmarkFilled" size={16} color={colors.brand.gold} /><Text role="body" style={styles.flex}>{t('reader.page', { p, n: pages || '…' })}</Text></Pressable>)}
          </View>
        ) : null}
        {(book.data?.toc ?? []).map((e, i) => (
          <Pressable key={i} onPress={() => { if (e.page) { viewer.current?.goto(e.page); setSheet(null); } }} style={styles.tocRow} disabled={!e.page}>
            <Text role="body" style={styles.flex}>{e.title}</Text>{e.page ? <Text role="small" tone="tertiary" tabular>{e.page}</Text> : null}
          </Pressable>
        ))}
        {!book.data?.toc.length && !bookmarks.length ? <Text role="small" tone="tertiary" center>{t('reader.contents')}: —</Text> : null}
      </BottomSheet>
      <BottomSheet visible={sheet === 'goto'} onClose={() => setSheet(null)} title={t('reader.goTo')}
        footer={<Button label={t('common.ok')} full onPress={() => { const p = Number(gotoValue); if (p >= 1) viewer.current?.goto(p); setSheet(null); }} />}>
        <Input value={gotoValue} onChangeText={setGotoValue} keyboardType="number-pad" numeric placeholder={pages ? `1 – ${pages}` : ''} autoFocus />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.subtle },
  bar: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: spacing[1], backgroundColor: colors.bg.base, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  btn: { width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  body: { flex: 1 },
  watermark: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'space-around', alignItems: 'center', opacity: 0.35 },
  wmText: { transform: [{ rotate: '-20deg' }], fontSize: 13 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], backgroundColor: colors.brand.goldSoft, borderTopWidth: 1, borderTopColor: colors.border.default },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[1], backgroundColor: colors.bg.base, borderTopWidth: 1, borderTopColor: colors.border.default },
  tocGroup: { marginBottom: spacing[3], gap: spacing[1] },
  tocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default, borderRadius: radius.sm },
});
