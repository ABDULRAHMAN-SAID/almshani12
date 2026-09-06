import { Tabs } from 'expo-router';
import { Platform, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily, radius, themed } from '@manassah/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

/** خمسة تبويبات فقط — أيقونات كبيرة، والتبويب النشط داخل حبّة ملوّنة */
const TABS: { name: string; key: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', key: 'nav.home', icon: 'home-outline', iconActive: 'home' },
  { name: 'library', key: 'nav.library', icon: 'library-outline', iconActive: 'library' },
  { name: 'lessons', key: 'nav.lessons', icon: 'videocam-outline', iconActive: 'videocam' },
  { name: 'courses', key: 'nav.courses', icon: 'play-circle-outline', iconActive: 'play-circle' },
  { name: 'account', key: 'nav.account', icon: 'person-outline', iconActive: 'person' },
];

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarStyle: {
          backgroundColor: colors.bg.card,
          borderTopColor: colors.border.default,
          borderTopWidth: 1.5,
          height: Platform.OS === 'web' ? 74 : 92,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: fontFamily.bold, fontSize: 12, marginTop: 4 },
        tabBarHideOnKeyboard: true,
      }}
    >
      {TABS.map(tab => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.key),
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.pill, focused && styles.pillActive]}>
                <Ionicons name={focused ? tab.iconActive : tab.icon} size={25} color={color} />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = themed((c) => StyleSheet.create({
  pill: { width: 58, height: 34, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: c.brand.primarySoft },
}));
