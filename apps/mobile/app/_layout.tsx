import 'react-native-gesture-handler';
import { useEffect, useRef, useState } from 'react';
import { I18nManager, View, useColorScheme } from 'react-native';
import { Stack, SplashScreen, useRouter, useSegments, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useFonts, ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold, ReadexPro_700Bold } from '@expo-google-fonts/readex-pro';
import { BalooBhaijaan2_700Bold, BalooBhaijaan2_800ExtraBold } from '@expo-google-fonts/baloo-bhaijaan-2';
import { colors, setTheme, getTheme, onThemeChange, type ThemeName } from '@manassah/tokens';
import { useAuth, needsSetup } from '@/state/auth';
import { bootstrapAuth, homeFor, signOut } from '@/lib/session';
import { queryClient } from '@/lib/queryClient';
import { useSessionSocket } from '@/features/realtime';
import { OfflineBar, Text } from '@/ui';
import { isDemo } from '@/api/client';
import { useUi, hydratePrefs } from '@/state/ui';
import { applyLocale } from '@/i18n';  // يهيّئ i18next واتجاه الواجهة عند التحميل

SplashScreen.preventAutoHideAsync().catch(() => {});

/* الاتجاه يتبع اللغة المحفوظة (العربية افتراضاً) — يُضبط في '@/i18n' عند التحميل ويُتابَع في useLocaleSync */
I18nManager.allowRTL(true);

/** حارس التوجيه: زائر → الترحيب؛ حساب بلا متعلّم (وليس معلّماً/طاقماً) → الإعداد؛ وإلا التبويبات. شاشة الإعداد تبقى متاحة لإضافة متعلّم من الإعدادات */
function AuthGate() {
  const { user, ready } = useAuth();
  const segments = useSegments() as string[];
  const router = useRouter();
  useSessionSocket();
  useEffect(() => {
    if (!ready) return;
    // شاشة الاتصال بخادم (رابط عميق manassah://connect?url=…) وصفحة تحميل التطبيق (/get-app) عامّتان قبل الدخول أو بعده — لا يُعاد توجيههما
    if (segments[0] === 'connect' || segments[0] === 'get-app') return;
    const inAuth = segments[0] === '(auth)';
    const onSetup = inAuth && segments[1] === 'setup';
    // طلب الانضمام كمعلّم متاح لهاتف جديد بلا متعلّم — لا يُجبَر على إنشاء متعلّم أولاً
    const onApply = segments[0] === 'teacher-app' && segments[1] === 'apply';
    if (!user && !inAuth) router.replace('/(auth)/welcome');
    else if (user && needsSetup(user) && !onSetup && !onApply) router.replace('/(auth)/setup');
    else if (user && !needsSetup(user) && inAuth && !onSetup) router.replace(homeFor(user) as never);
  }, [user, ready, segments, router]);
  return null;
}

/** رسالة عابرة أسفل الشاشة — تختفي وحدها */
function ToastBar() {
  const toast = useUi(s => s.toast);
  if (!toast) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', bottom: 96, left: 16, right: 16, alignItems: 'center', zIndex: 50 }}><View style={{ backgroundColor: colors.bg.inverse, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, maxWidth: 480 }}><Text role="small" tone="inverse" center>{toast}</Text></View></View>;
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        setOnline(state.isInternetReachable !== false);
        sub = Network.addNetworkStateListener(s => { const ok = s.isInternetReachable !== false; setOnline(ok); onlineManager.setOnline(ok); });
      } catch { /* لا معلومات شبكة — نفترض الاتصال */ }
    })();
    return () => sub?.remove();
  }, []);
  return online;
}

/**
 * السِمة: التفضيل (فاتح/داكن/تلقائي) + نظام الجهاز → السِمة النشطة في الرموز.
 * عند التبديل يُعاد تركيب الشجرة كاملة (كل الأنماط تُقرأ من جديد) ثم يُستعاد المسار الحالي.
 */
function useThemeSync(): ThemeName {
  const pref = useUi(s => s.themePref);
  const scheme = useColorScheme();
  const [name, setName] = useState<ThemeName>(getTheme());
  useEffect(() => { setTheme(pref === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : pref); }, [pref, scheme]);
  useEffect(() => onThemeChange(setName), []);
  return name;
}

/** اللغة المختارة تُطبَّق على i18next واتجاه الصفحة عند كل تغيير أو بعد قراءة التفضيلات */
function useLocaleSync(): void {
  const locale = useUi(s => s.locale);
  useEffect(() => { applyLocale(locale); }, [locale]);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ReadexPro_400Regular, ReadexPro_500Medium, ReadexPro_600SemiBold, ReadexPro_700Bold, BalooBhaijaan2_700Bold, BalooBhaijaan2_800ExtraBold });
  const ready = useAuth(s => s.ready);
  const online = useOnline();
  const themeName = useThemeSync();
  useLocaleSync();
  const serverUrl = useUi(s => s.serverUrl);
  const hydrated = useUi(s => s.hydrated);
  const router = useRouter();
  // تغيير الخادم (تجريبي ↔ حقيقي أو خادم آخر) يُبطل الجلسة الحالية: نخرج ليدخل المستخدم على الخادم الجديد
  const prevServer = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (prevServer.current === null) { prevServer.current = serverUrl; return; }
    if (prevServer.current !== serverUrl) { prevServer.current = serverUrl; signOut(); }
  }, [serverUrl, hydrated]);
  const pathname = usePathname();
  const pathRef = useRef(pathname); pathRef.current = pathname;
  const restore = useRef<string | null>(null);
  const first = useRef(true);
  // بعد إعادة التركيب بسبب تغيير السِمة نعود إلى الشاشة نفسها
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const p = restore.current; restore.current = null;
    if (p && p !== '/') { const id = setTimeout(() => router.replace(p as never), 30); return () => clearTimeout(id); }
  }, [themeName, router]);
  useEffect(() => onThemeChange(() => { restore.current = pathRef.current; }), []);

  useEffect(() => { bootstrapAuth(); hydratePrefs(); }, []);
  useEffect(() => { if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {}); }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return <View style={{ flex: 1, backgroundColor: colors.bg.base }} />;

  return (
    <GestureHandlerRootView key={themeName} style={{ flex: 1, backgroundColor: colors.bg.base }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
          {isDemo() ? <View style={{ backgroundColor: colors.brand.goldSoft, paddingVertical: 5, paddingHorizontal: 12, alignItems: 'center' }}><Text role="caption" color={colors.brand.goldDark}>نسخة عرض بلا خادم — بيانات تجريبية · رمز الدخول 000000</Text></View> : null}
          {!isDemo() && serverUrl ? <View style={{ backgroundColor: colors.state.infoSoft, paddingVertical: 4, paddingHorizontal: 12, alignItems: 'center' }}><Text role="caption" color={colors.state.info} numberOfLines={1}>متصل بالخادم: {serverUrl}</Text></View> : null}
          {!online ? <OfflineBar /> : null}
          <AuthGate />
          <ToastBar />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg.base }, animation: 'fade_from_bottom', animationDuration: 200 }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
            <Stack.Screen name="lesson/[id]/room" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="book/[id]/read" options={{ animation: 'fade' }} />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
