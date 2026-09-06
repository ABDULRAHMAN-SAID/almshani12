import { q, settings } from '../db/index.ts';
import { muscatToUtc, utcToMuscatParts } from '../lib/helpers.ts';

export interface Slot { startsAt: string; endsAt: string; available: boolean }
export interface DaySlots { date: string; slots: Slot[] }

interface Rule { weekday: number; start_time: string; end_time: string; slot_minutes: number; break_minutes: number }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const pad = (n: number) => String(n).padStart(2, '0');
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/**
 * يولّد مواعيد المعلّم لعدد من الأيام (بتوقيت مسقط):
 * التوفّر الأسبوعي − الإجازات − الحجوزات الفعّالة − ما مضى − حدّ الحصص اليومي.
 * المدة المطلوبة قد تختلف عن مدة الخانة: نطابق كل بداية خانة وننتظر أن تتّسع المدة.
 */
export function generateSlots(teacherId: number, { from, days, durationMinutes }: { from: string; days: number; durationMinutes: number }): DaySlots[] {
  const rules = q.all<Rule>('SELECT weekday, start_time, end_time, slot_minutes, break_minutes FROM teacher_availability WHERE teacher_id = ?', teacherId);
  if (!rules.length) return [];

  // «from» قد يكون تاريخاً بتوقيت مسقط (yyyy-mm-dd) أو طابعاً زمنياً UTC كاملاً — نحوّله إلى يوم مسقط الصحيح
  const startDay = from.length > 10 ? utcToMuscatParts(from).date : from.slice(0, 10);
  const fromDate = new Date(`${startDay}T00:00:00+04:00`);
  const rangeEnd = new Date(fromDate.getTime() + days * 86_400_000).toISOString();
  const timeOff = q.all<{ starts_at: string; ends_at: string }>(
    'SELECT starts_at, ends_at FROM teacher_time_off WHERE teacher_id = ? AND ends_at >= ? AND starts_at <= ?', teacherId, fromDate.toISOString(), rangeEnd);
  const booked = q.all<{ starts_at: string; ends_at: string }>(
    `SELECT starts_at, ends_at FROM bookings WHERE teacher_id = ? AND status IN ('pending_payment','confirmed','in_progress') AND ends_at >= ? AND starts_at <= ?`,
    teacherId, fromDate.toISOString(), rangeEnd);
  const maxPerDay = settings.get<number>('max_teacher_slots_per_day');
  const nowMs = Date.now();
  const out: DaySlots[] = [];

  for (let d = 0; d < days; d++) {
    const dayStart = new Date(fromDate.getTime() + d * 86_400_000);
    // تاريخ اليوم بتوقيت مسقط
    const local = new Date(dayStart.getTime() + 4 * 3_600_000);
    const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
    const weekday = local.getUTCDay();
    const dayRules = rules.filter(r => r.weekday === weekday);
    const slots: Slot[] = [];

    for (const rule of dayRules) {
      const step = rule.slot_minutes + rule.break_minutes;
      for (let m = toMin(rule.start_time); m + durationMinutes <= toMin(rule.end_time); m += step) {
        const startsAt = muscatToUtc(date, `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
        const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString();
        const sMs = new Date(startsAt).getTime(), eMs = new Date(endsAt).getTime();
        const past = sMs <= nowMs;
        const off = timeOff.some(t => overlaps(sMs, eMs, new Date(t.starts_at).getTime(), new Date(t.ends_at).getTime()));
        const taken = booked.some(b => overlaps(sMs, eMs, new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()));
        slots.push({ startsAt, endsAt, available: !past && !off && !taken });
      }
    }
    // حدّ الحصص اليومي: بعد بلوغه تُغلق بقية المواعيد
    const dayBooked = booked.filter(b => b.starts_at.startsWith(new Date(dayStart.getTime() + 4 * 3_600_000).toISOString().slice(0, 10))).length;
    if (dayBooked >= maxPerDay) slots.forEach(s => { s.available = false; });
    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    out.push({ date, slots });
  }
  return out;
}

/** هل هذا الموعد داخل توفّر المعلّم وليس في إجازة؟ (التعارض مع الحجوزات يُمنع بقيد قاعدة البيانات) */
export function isWithinAvailability(teacherId: number, startsAt: string, durationMinutes: number): boolean {
  const day = generateSlots(teacherId, { from: startsAt, days: 1, durationMinutes });
  return day.some(d => d.slots.some(s => s.startsAt === startsAt && s.available));
}

export const nextAvailableSlot = (teacherId: number, durationMinutes = 60): string | null => {
  for (const day of generateSlots(teacherId, { from: new Date().toISOString(), days: 14, durationMinutes })) {
    const s = day.slots.find(x => x.available);
    if (s) return s.startsAt;
  }
  return null;
};
