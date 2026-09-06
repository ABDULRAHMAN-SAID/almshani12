import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily } from '@manassah/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

/** خمسة تبويبات فقط — لا أكثر */
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
          borderTopWidth: 1,
          height: Platform.OS === 'web' ? 64 : 84,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 11, marginTop: 2 },
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
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={23} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
