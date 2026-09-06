import { create } from 'zustand';

export interface Participant { userId: number; name: string; isHost: boolean; role: 'student' | 'teacher'; hand: boolean; joinedAt: string; mic?: boolean; cam?: boolean }
export interface RoomMessage { id: number; userId: number; name: string; body: string; at: string }
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';

/** حالة القاعة المباشرة — تُغذّيها أحداث Socket.IO وتقرأها الشاشة وأوراقها */
interface RoomState {
  connection: Connection;
  me: { userId: number; isHost: boolean; role: 'student' | 'teacher' } | null;
  participants: Participant[];
  messages: RoomMessage[];
  unread: number;
  hand: boolean;
  mic: boolean;
  cam: boolean;
  startedAt: number | null;
  sharing: boolean;
  boardOps: unknown[];
  set: (patch: Partial<RoomState>) => void;
  addMessage: (m: RoomMessage, mine: boolean) => void;
  reset: () => void;
}

const initial = {
  connection: 'connecting' as Connection, me: null, participants: [], messages: [], unread: 0,
  hand: false, mic: true, cam: true, startedAt: null, sharing: false, boardOps: [],
};

export const useRoom = create<RoomState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  addMessage: (m, mine) => set(s => ({ messages: [...s.messages, m].slice(-300), unread: mine ? s.unread : s.unread + 1 })),
  reset: () => set({ ...initial }),
}));
