import { create } from 'zustand';

export interface Participant { userId: number; name: string; isHost: boolean; role: 'student' | 'teacher' | 'observer'; hand: boolean; joinedAt: string; mic?: boolean; cam?: boolean }
export interface RoomMessage { id: number; userId: number; name: string; body: string; at: string }
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';

/** حالة القاعة المباشرة — تُغذّيها أحداث Socket.IO وتقرأها الشاشة وأوراقها */
interface RoomState {
  connection: Connection;
  /** مفتاح i18n يشرح سبب الفشل — 'تعذّر الاتصال' وحده لا يخبر المستخدم أنه متصل من جهاز آخر */
  failReason: string | null;
  /** مفتاح i18n لتعذّر الكاميرا/المايك — بدونه يرى المستخدم مربّعاً أسود وزرَّين معطَّلين بلا سبب */
  mediaError: string | null;
  me: { userId: number; isHost: boolean; role: 'student' | 'teacher' | 'observer' } | null;
  participants: Participant[];
  messages: RoomMessage[];
  unread: number;
  hand: boolean;
  mic: boolean;
  cam: boolean;
  startedAt: number | null;
  /** مشاركتي أنا — يضبطها زرّ المشاركة وحده */
  sharing: boolean;
  /** مشاركة الطرف الآخر — تصل من الخادم؛ منفصلة حتى لا يظهر لي زرّ «إيقاف المشاركة» لشاشة غيري */
  remoteSharing: boolean;
  boardOps: unknown[];
  addBoardOp: (op: unknown) => void;
  set: (patch: Partial<RoomState>) => void;
  addMessage: (m: RoomMessage, mine: boolean) => void;
  reset: () => void;
}

/** أقصى ما يُحتفظ به من ضربات السبّورة في الذاكرة */
const BOARD_OPS_MAX = 500;

const initial = {
  connection: 'connecting' as Connection, failReason: null, mediaError: null, me: null, participants: [], messages: [], unread: 0,
  hand: false, mic: true, cam: true, startedAt: null, sharing: false, remoteSharing: false, boardOps: [],
};

export const useRoom = create<RoomState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  addMessage: (m, mine) => set(s => ({ messages: [...s.messages, m].slice(-300), unread: mine ? s.unread : s.unread + 1 })),
  /** ضربة سبّورة واحدة — بسقف كسقف الرسائل حتى لا تنمو الحالة (وإعادة رسمها) بلا حدّ في حصة طويلة */
  addBoardOp: (op) => set(s => ({ boardOps: [...s.boardOps, op].slice(-BOARD_OPS_MAX) })),
  reset: () => set({ ...initial }),
}));
