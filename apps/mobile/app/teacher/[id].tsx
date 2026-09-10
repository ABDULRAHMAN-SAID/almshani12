import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, subjectColors, type SubjectColorKey, themed } from '@manassah/tokens';
import { savePercent } from '@manassah/shared';
import { Screen, IconButton, Text, Icon, Button, Chip, Badge, Avatar, Rating, Price, Card, SectionHeader, BookCard, CourseCard, ReviewList, ReviewSheet, Expandable, VerifiedBadge, isDayOff } from '@/ui';
import { useTeacher, useToggleFavorite, useStartConversation } from '@/features/queries';
import { useAuth } from '@/state/auth';
import { money, weekdayShort } from '@/lib/format';
import { safeBack } from '@/lib/session';

/** ملف المعلّم: كل ما يحتاجه الطالب ليثق ويحجز — والفعل الرئيسي «احجز حصة» ثابت أسفل الشاشة */
export default function TeacherProfile() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const teacherId = Number(id);
  const user = useAuth(s => s.user);
  const q = useTeacher(teacherId);
  const fav = useToggleFavorite();
  const start = useStartConversation();
  const [review, setReview] = useState(false);
  const p = q.data;
  const isMe = user?.id === teacherId;
  const durations = [30, 45, 60] as const;
  const price = (d: number, mode: 'individual' | 'group') => p?.prices.find(x => x.durationMinutes === d && x.mode === mode)?.price;
  const hasGroup = !!p?.prices.some(x => x.mode === 'group');
  // شريط الأرقام من stats (الطلاب = متعلّمون متمايزون في حصص مكتملة) مع احتياط لخادم أقدم
  const st = p ? (p.stats ?? { studentsCount: p.studentsCount, lessonsCount: p.lessonsCount, ratingCount: p.ratingCount, yearsExp: p.yearsExp }) : null;
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const rulesFor = (wd: number) => (p?.availabilityRules ?? []).filter(r => r.weekday === wd).sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <Screen onBack={() => safeBack(router)} title={p?.name ?? ''} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} padded={false}
      right={p ? <Pressable onPress={() => fav.mutate({ targetType: 'teacher', targetId: teacherId })} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('account.favorites')}><Icon name={p.favorited ? 'heartFilled' : 'heart'} size={22} color={p.favorited ? colors.brand.primary : colors.text.primary} /></Pressable> : undefined}
      footer={p && !isMe ? (
        <View style={styles.footer}>
          <View style={styles.flex}><Price value={p.priceFrom} from /><Text role="caption" tone="tertiary" numberOfLines={1}>{t('teachers.lesson60')}</Text></View>
          <IconButton icon="message" label={t('messagesUi.withTeacher')} loading={start.isPending} onPress={() => start.mutate({ userId: teacherId }, { onSuccess: c => router.push(`/conversation/${c.id}`) })} />
          <Button label={t('teachers.book')} icon="calendar" style={styles.footBtn} onPress={() => router.push(`/teacher/${teacherId}/book`)} />
        </View>
      ) : undefined}>
      {p ? (
        <View>
          <View style={styles.px}>
            <View style={styles.top}>
              <Avatar name={p.name} url={p.avatarUrl} size="xl" verified={p.verified} />
              <View style={styles.flex}>
                <View style={styles.nameRow}><Text role="h1" numberOfLines={2} style={styles.name}>{p.name}</Text></View>
                {p.headline ? <Text role="small" tone="secondary">{p.headline}</Text> : null}
                <View style={styles.badges}>{p.verified ? <VerifiedBadge label={t('common.verified')} /> : null}{p.availableNow ? <Badge label={t('teachers.availableNow')} tone="success" /> : null}</View>
              </View>
            </View>
            <View style={styles.stats}>
              <View style={styles.stat}>{st!.ratingCount > 0 ? <Rating value={p.ratingAvg} size={14} /> : <Text role="h3">—</Text>}<Text role="caption" tone="tertiary" numberOfLines={1}>{t('teachers.ratingCount', { n: st!.ratingCount })}</Text></View>
              <View style={styles.stat}><Text role="h3" tabular>{st!.studentsCount}</Text><Text role="caption" tone="tertiary" numberOfLines={1}>{t('teachers.studentsCount', { n: '' }).trim()}</Text></View>
              <View style={styles.stat}><Text role="h3" tabular>{st!.lessonsCount}</Text><Text role="caption" tone="tertiary" numberOfLines={1}>{t('teachers.lessonsCount', { n: '' }).trim()}</Text></View>
              <View style={styles.stat}><Text role="h3" tabular>{st!.yearsExp}</Text><Text role="caption" tone="tertiary" numberOfLines={1}>{t('teachers.yearsExp', { n: '' }).trim()}</Text></View>
            </View>
            <View style={styles.chips}>
              {p.subjects.map(s => { const sc = subjectColors[(s.colorKey as SubjectColorKey)] ?? subjectColors.default; return <Chip key={s.id} label={s.name} color={sc.main} softColor={sc.soft} small />; })}
              {p.grades.map(g => <Chip key={g.id} label={g.name} small />)}
            </View>

            {p.bio ? <View style={styles.section}><SectionHeader title={t('teachers.about')} /><Expandable text={p.bio} /></View> : null}
            {p.teachingStyle.length || p.languages.length ? (
              <View style={styles.section}><SectionHeader title={t('teachers.style')} />
                <View style={styles.chips}>{p.teachingStyle.map(s => <Chip key={s} label={s} small icon="check" />)}{p.languages.map(l => <Chip key={l} label={l === 'ar' ? 'العربية' : l === 'en' ? 'English' : l} small icon="language" />)}</View>
              </View>
            ) : null}

            {/* الأسعار */}
            <View style={styles.section}><SectionHeader title={t('teachers.prices')} subtitle={t('common.currencyOMR')} />
              <Card padded={false}>
                <View style={[styles.priceRow, styles.priceHead]}><Text role="caption" tone="secondary" style={styles.flex}>{t('booking.duration')}</Text><Text role="caption" tone="secondary" style={styles.priceCol}>{t('teachers.individual')}</Text>{hasGroup ? <Text role="caption" tone="secondary" style={styles.priceCol}>{t('teachers.group')}</Text> : null}</View>
                {durations.filter(d => price(d, 'individual') != null || price(d, 'group') != null).map((d, i, arr) => (
                  <View key={d} style={[styles.priceRow, i < arr.length - 1 && styles.priceBorder]}>
                    <Text role="body" style={styles.flex}>{t(`teachers.lesson${d}`)}</Text>
                    <Text role="price" tabular style={styles.priceCol}>{price(d, 'individual') != null ? money(price(d, 'individual')!) : '—'}</Text>
                    {hasGroup ? <Text role="price" tabular style={styles.priceCol}>{price(d, 'group') != null ? money(price(d, 'group')!) : '—'}</Text> : null}
                  </View>
                ))}
              </Card>
            </View>

            {/* الباقات */}
            {p.packages.length ? (
              <View style={styles.section}><SectionHeader title={t('teachers.packages')} subtitle={t('teachers.save', { p: Math.max(...p.packages.map(x => x.savePercent)) })} />
                <View style={styles.pkgs}>{p.packages.map(pk => (
                  <Card key={pk.id} rail={colors.brand.gold}>
                    <View style={styles.pkgRow}>
                      <View style={styles.flex}>
                        <Text role="h3">{t('teachers.lessonsN', { n: pk.lessonsCount })} · {pk.durationMinutes} {t('common.minutes')}</Text>
                        <Text role="caption" tone="secondary">{t(`teachers.${pk.mode}`)} · {money(pk.price / pk.lessonsCount)} / {t('teachers.oneLesson')}</Text>
                      </View>
                      {pk.savePercent > 0 || savePercent(pk.listPrice, pk.price) > 0 ? <Badge label={t('teachers.save', { p: pk.savePercent })} tone="gold" /> : null}
                    </View>
                    <View style={styles.pkgFoot}><Price value={pk.price} listPrice={pk.listPrice} size="lg" /><Button label={t('teachers.buyPackage')} size="sm" onPress={() => router.push({ pathname: '/checkout', params: { items: JSON.stringify([{ itemType: 'package', itemId: pk.id }]) } })} /></View>
                  </Card>
                ))}</View>
              </View>
            ) : null}

            {/* التوفّر الأسبوعي: سبعة أعمدة بالفترات من قواعد المعلّم */}
            {p.availabilityRules?.length ? (
              <View style={styles.section}><SectionHeader title={t('teachers.weeklyAvailability')} subtitle={t('common.timezoneNote')} />
                <View style={styles.week}>{DAYS.map((d, wd) => { const rs = rulesFor(wd); return (
                  <View key={d} style={[styles.weekCol, !rs.length && styles.weekColOff]}>
                    <Text role="caption" tone={rs.length ? 'primary' : 'tertiary'} numberOfLines={1}>{t(`days.${d}`)}</Text>
                    {rs.length ? rs.map((r, i) => <Text key={i} role="caption" tone="success" tabular numberOfLines={2} style={styles.range}>{r.startTime}{'\n'}{r.endTime}</Text>) : <Text role="caption" tone="tertiary">—</Text>}
                  </View>
                ); })}</View>
              </View>
            ) : null}

            {/* المواعيد — أيام الإجازة معطّلة ومعلَّمة */}
            <View style={styles.section}><SectionHeader title={t('teachers.schedule')} subtitle={t('common.timezoneNote')} onSeeAll={() => router.push(`/teacher/${teacherId}/book`)} />
              <View style={styles.days}>{p.availabilityPreview.map(d => { const off = isDayOff(d.date, p.timeOff); const n = off ? 0 : d.slotsCount; return (
                <Pressable key={d.date} onPress={() => router.push({ pathname: `/teacher/${teacherId}/book`, params: { day: d.date } })} disabled={!n} style={[styles.day, !n && styles.dayOff]} accessibilityRole="button">
                  <Text role="caption" tone="secondary">{weekdayShort(`${d.date}T12:00:00Z`)}</Text>
                  <Text role="h3" tabular tone={n ? 'primary' : 'tertiary'}>{Number(d.date.slice(8, 10))}</Text>
                  <Text role="caption" tone={n ? 'success' : 'tertiary'} tabular numberOfLines={1} style={off ? styles.offText : undefined}>{off ? t('teachers.timeOff') : n ? `${n}` : '—'}</Text>
                </Pressable>
              ); })}</View>
            </View>
          </View>

          {p.courses.length ? (
            <View style={styles.section}><View style={styles.px}><SectionHeader title={t('teachers.courses')} /></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>{p.courses.map(c => <CourseCard key={c.id} course={c} width={250} onPress={() => router.push(`/course/${c.id}`)} />)}</ScrollView>
            </View>
          ) : null}
          {p.books.length ? (
            <View style={styles.section}><View style={styles.px}><SectionHeader title={t('teachers.books')} /></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>{p.books.map(b => <BookCard key={b.id} book={b} width={168} onPress={() => router.push(`/book/${b.id}`)} />)}</ScrollView>
            </View>
          ) : null}
          <View style={[styles.section, styles.px, styles.last]}>
            <SectionHeader title={t('teachers.reviews')} onSeeAll={p.canReview ? () => setReview(true) : undefined} seeAllLabel={t('book.writeReview')} />
            <ReviewList items={p.reviews} avg={p.ratingAvg} count={p.ratingCount} />
          </View>
          <ReviewSheet visible={review} onClose={() => setReview(false)} targetType="teacher" targetId={teacherId} onDone={() => q.refetch()} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  px: { paddingHorizontal: spacing[4] },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', gap: spacing[3], alignItems: 'center', paddingTop: spacing[2] },
  flex: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  name: { flexShrink: 1 },
  badges: { flexDirection: 'row', gap: spacing[1], marginTop: spacing[1], flexWrap: 'wrap' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.bg.card, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border.default, padding: spacing[3], marginTop: spacing[4] },
  stat: { alignItems: 'center', gap: 2, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[3] },
  section: { marginTop: spacing[6] },
  last: { marginBottom: spacing[6] },
  priceRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  priceHead: { backgroundColor: c.bg.subtle, borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg },
  priceBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.default },
  priceCol: { width: 90, textAlign: 'center' },
  pkgs: { gap: spacing[3] },
  pkgRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pkgFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing[3] },
  days: { flexDirection: 'row', gap: spacing[1], justifyContent: 'space-between' },
  day: { flex: 1, alignItems: 'center', paddingVertical: spacing[2], borderRadius: radius.md, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default, gap: 2 },
  dayOff: { backgroundColor: c.bg.subtle, borderStyle: 'dashed' },
  offText: { fontSize: 10, lineHeight: 12 },
  week: { flexDirection: 'row', gap: spacing[1] },
  weekCol: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing[2], paddingHorizontal: 2, borderRadius: radius.md, backgroundColor: c.bg.card, borderWidth: 1.5, borderColor: c.border.default, minHeight: 64 },
  weekColOff: { backgroundColor: c.bg.subtle, borderStyle: 'dashed' },
  range: { fontSize: 10, lineHeight: 13, textAlign: 'center' },
  hList: { paddingHorizontal: spacing[4], gap: spacing[3] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footBtn: { flex: 1.2 },
}));
