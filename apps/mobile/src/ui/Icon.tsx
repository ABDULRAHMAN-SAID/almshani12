import { I18nManager, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@manassah/tokens';

/** نظام أيقونات موحّد — أسماء دلالية تُترجَم إلى Ionicons في مكان واحد */
export const ICONS = {
  home: 'home-outline', homeFilled: 'home',
  library: 'library-outline', lessons: 'videocam-outline', courses: 'play-circle-outline', account: 'person-outline',
  search: 'search-outline', filter: 'options-outline', close: 'close', check: 'checkmark', checkCircle: 'checkmark-circle',
  back: 'chevron-forward', forward: 'chevron-back', down: 'chevron-down', up: 'chevron-up',
  bell: 'notifications-outline', cart: 'cart-outline', heart: 'heart-outline', heartFilled: 'heart',
  star: 'star', starHalf: 'star-half', starOutline: 'star-outline', verified: 'shield-checkmark',
  calendar: 'calendar-outline', clock: 'time-outline', video: 'videocam-outline', mic: 'mic-outline', micOff: 'mic-off-outline',
  cameraOff: 'videocam-off-outline', speaker: 'volume-high-outline', chat: 'chatbubble-outline', hand: 'hand-right-outline',
  people: 'people-outline', board: 'easel-outline', share: 'share-social-outline', leave: 'exit-outline',
  book: 'book-outline', bookFilled: 'book', teacher: 'school-outline', solve: 'calculator-outline', quiz: 'help-circle-outline',
  play: 'play', pause: 'pause', bookmark: 'bookmark-outline', bookmarkFilled: 'bookmark', list: 'list-outline',
  settings: 'settings-outline', language: 'language-outline', support: 'help-buoy-outline', logout: 'log-out-outline',
  wallet: 'wallet-outline', receipt: 'receipt-outline', progress: 'stats-chart-outline', message: 'mail-outline',
  lock: 'lock-closed-outline', wifi: 'wifi-outline', wifiOff: 'cloud-offline-outline', warning: 'alert-circle-outline',
  info: 'information-circle-outline', empty: 'file-tray-outline', refresh: 'refresh-outline', trash: 'trash-outline',
  edit: 'create-outline', plus: 'add', minus: 'remove', upload: 'cloud-upload-outline', download: 'download-outline',
  location: 'location-outline', phone: 'call-outline', mail: 'mail-outline', school: 'school-outline', grade: 'ribbon-outline',
} as const;

export type IconName = keyof typeof ICONS;

/** أيقونات اتجاهية تنعكس في RTL */
const DIRECTIONAL: IconName[] = ['back', 'forward', 'leave', 'logout', 'share'];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /** يعكس الأيقونة أفقياً — للأسهم في RTL (تلقائي للاتجاهية) */
  flip?: boolean;
}

export function Icon({ name, size = 22, color = colors.text.primary, flip }: IconProps) {
  const shouldFlip = flip ?? (I18nManager.isRTL && DIRECTIONAL.includes(name));
  return (
    <Ionicons
      name={ICONS[name] as keyof typeof Ionicons.glyphMap}
      size={size}
      color={color}
      style={shouldFlip ? styles.flip : undefined}
    />
  );
}

const styles = StyleSheet.create({ flip: { transform: [{ scaleX: -1 }] } });
