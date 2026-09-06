import 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { I18nManager, Platform, View } from 'react-native';
import { Stack, SplashScreen, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import {
  useFonts, IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { colors } from '@manassah/tokens';
import '@/i18n';
import { useAuth } from '@/state/auth';
import { bootstrapAuth, homeFor } from '@/lib/session';
import { OfflineBar, Text } from '@/ui';
import { DEMO } from '@/api/client';

SplashScreen.preventAutoHideAsync().catch(() => {});

/* RTL أصلي — العربية هي التصميم الأساسي */
if (!I18nManager.isRTL) { I18nManager.allowRTL(true); I18nManager.forceRTL(true); }
if (Platform.OS === 'web' && typeof document !== 'undefined') { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; }

/* فصل حالة الخادم عن حالة الواجهة: react-query يملك بيانات الخادم فقط */
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

/** حارس التوجيه: زائر → الترحيب؛ حساب بلا إعداد → الإعداد؛ وإلا التبويبات */
function AuthGate() {
  const { user, ready } = useAuth();
  const segments = useSegments() as string[];
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/(auth)/welcome');
    else if (user && !user.onboardingCompleted && segments[1] !== 'setup') router.replace('/(auth)/setup');
    else if (user && user.onboardingCompleted && inAuth) router.replace(homeFor(user) as never);
  }, [user, ready, segments, router]);
  return null;
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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold });
  const ready = useAuth(s => s.ready);
  const online = useOnline();

  useEffect(() => { bootstrapAuth(); }, []);
  useEffect(() => { if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {}); }, [fontsLoaded, ready]);

  if (!fontsLoaded || !ready) return <View style={{ flex: 1, backgroundColor: colors.bg.base }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg.base }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {DEMO ? <View style={{ backgroundColor: colors.brand.goldSoft, paddingVertical: 4, paddingHorizontal: 12, alignItems: 'center' }}><Text role="caption" tone="gold">نسخة عرض بلا خادم — بيانات تجريبية · رمز الدخول 000000</Text></View> : null}
          {!online ? <OfflineBar /> : null}
          <AuthGate />
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
