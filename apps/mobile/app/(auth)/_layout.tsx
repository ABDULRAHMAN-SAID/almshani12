import { Stack } from 'expo-router';
import { colors } from '@manassah/tokens';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg.base }, animation: 'slide_from_left' }} />;
}
