import { View, StyleSheet, Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, radius, shadow, themed } from '@manassah/tokens';
import { AppDownloadInfo, brand } from '@manassah/shared';
import { Screen, Text, Button, Card, Icon } from '@/ui';
import { api } from '@/api/client';
import { useAuth } from '@/state/auth';
import { homeFor } from '@/lib/session';

/** حاسوب مكتبي على الويب (ليس أندرويد ولا iPhone): نعرض رمز QR ليُمسح بكاميرا الهاتف */
const isDesktopBrowser = Platform.OS === 'web' && typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const STEPS = ['step1', 'step2', 'step3', 'step4', 'step5'] as const;
const toMb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
/** الخادم قد يعيد مساراً نسبياً (/manassah.apk أو رمز QR) — نكمله بأصل الخادم كي يعمل من خادم التطوير أيضاً */
const absolute = (u: string) => (/^https?:\/\//i.test(u) ? u : `${api.base}${u.startsWith('/') ? '' : '/'}${u}`);
/** فتح رابط التحميل: على الويب بالصفحة نفسها (المتصفح يحمّل الملف ويبقى هنا)، وفي التطبيق بالمتصفح الخارجي */
const open = (href: string) => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(href);
  else Linking.openURL(href).catch(() => {});
};

/**
 * صفحة تحميل تطبيق أندرويد — عامة بلا دخول على <server>/get-app: تجلب GET /api/app فتعرض زرّ التحميل المباشر
 * إن كان الملف على الخادم وإلا رابط إصدار GitHub، ورمز QR على الحاسوب، وخطوات التثبيت.
 * داخل التطبيق الأصلي نفسه لا معنى للتحميل فتكتفي بتنبيه أنه مثبّت وزرّ للرئيسية.
 */
export default function GetApp() {
  const { t } = useTranslation();
  const router = useRouter();
  const goHome = () => router.replace(homeFor(useAuth.getState().user) as never);
  const info = useQuery({
    queryKey: ['app-download'],
    queryFn: () => api.get('/app', AppDownloadInfo, undefined, { auth: false }),
    staleTime: 5 * 60_000, retry: 1, enabled: Platform.OS === 'web',
  });
  const title = t('getApp.title', { app: t('common.appName') });

  if (Platform.OS !== 'web') {
    return (
      <Screen title={title} onBack={goHome} contentStyle={styles.wrap}>
        <Card>
          <View style={styles.hero}>
            <View style={styles.iconWrap}><Icon name="checkCircle" size={34} color={colors.brand.green} /></View>
            <Text role="h2" center>{t('getApp.installed')}</Text>
          </View>
          <Button label={t('getApp.goHome')} icon="home" full onPress={goHome} />
        </Card>
      </Screen>
    );
  }

  const d = info.data;
  // التحميل المباشر من هذا الخادم إن وُجد الملف، وإلا زرّ GitHub وحده
  const direct = d?.available && d.url ? absolute(d.url) : null;
  const meta = d ? [d.size ? t('getApp.size', { mb: toMb(d.size) }) : null, d.versionCode ? t('getApp.build', { n: d.versionCode }) : null].filter(Boolean).join(' · ') : '';
  const connectUrl = `${api.base}/connect`;

  return (
    <Screen title={t('common.appName')} loading={info.isLoading} error={info.error} onRetry={() => info.refetch()} contentStyle={styles.wrap}>
      {d ? (
        <>
          <Card>
            <View style={styles.hero}>
              <View style={styles.logo}><Text role="display" tone="inverse" style={styles.logoText}>{brand.name.ar.slice(0, 1)}</Text></View>
              <Text role="h1" center>{title}</Text>
              {meta ? <Text role="small" tone="secondary" center tabular>{meta}</Text> : null}
            </View>
            <View style={styles.actions}>
              {direct ? <Button label={t('getApp.download')} icon="download" size="lg" full onPress={() => open(direct)} /> : null}
              <Button label={t('getApp.github')} variant={direct ? 'secondary' : 'primary'} size={direct ? 'md' : 'lg'} icon="linkIcon" full onPress={() => open(d.githubUrl)} />
              {!direct ? <Text role="caption" tone="tertiary" center>{t('getApp.githubOnly')}</Text> : null}
            </View>
            {isDesktopBrowser && d.qrUrl ? (
              <View style={styles.qrBox}>
                {/* صورة SVG من الخادم — عنصر img مباشر لأن هذا الفرع للويب فقط؛ خلفية بيضاء ليبقى الرمز قابلاً للمسح في الوضع الليلي */}
                <img src={absolute(d.qrUrl)} alt={t('getApp.scan')} width={200} height={200} style={{ width: 200, height: 200, borderRadius: radius.md, backgroundColor: '#FFFFFF' }} />
                <Text role="caption" tone="secondary" center>{t('getApp.scan')}</Text>
              </View>
            ) : null}
          </Card>

          <Card style={styles.steps}>
            <Text role="h3">{t('getApp.stepsTitle')}</Text>
            {STEPS.map((k, i) => (
              <View key={k} style={styles.step}>
                <View style={styles.num}><Text role="number" tone="brand">{i + 1}</Text></View>
                <Text role="body" style={styles.flex} selectable>{t(`getApp.${k}`, { url: connectUrl })}</Text>
              </View>
            ))}
          </Card>

          <Text role="caption" tone="tertiary" center style={styles.iphone}>{t('getApp.iphone')}</Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = themed((c) => StyleSheet.create({
  wrap: { paddingTop: spacing[2], maxWidth: 520, width: '100%', alignSelf: 'center', gap: spacing[4] },
  hero: { alignItems: 'center', gap: spacing[2], marginBottom: spacing[4] },
  logo: { width: 84, height: 84, borderRadius: radius.xl, backgroundColor: c.brand.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2], borderBottomWidth: 6, borderBottomColor: c.brand.primaryDark, ...shadow.raised },
  logoText: { fontSize: 46, lineHeight: 62 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.brand.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[1] },
  actions: { gap: spacing[2] },
  qrBox: { alignItems: 'center', gap: spacing[2], marginTop: spacing[4], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: c.border.default },
  steps: { gap: spacing[3] },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.brand.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  flex: { flex: 1, minWidth: 0 },
  iphone: { marginTop: spacing[2] },
}));
