import { config } from '../config.ts';

/**
 * إرسال رموز التحقّق — SMS للهاتف وبريد للإيميل.
 * لا مزوّد مضبوط؟ يُطبَع في السجلّ (تطوير فقط). المزوّد الحقيقي يُوصَل هنا دون لمس بقية الشيفرة.
 */
export async function sendOtp(channel: 'phone' | 'email', target: string, code: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER || 'log';
  if (provider === 'log' || config.env !== 'production') {
    if (!config.isTest) console.log(`[otp] ${channel} ${target} → ${code}`);
    return;
  }
  // مثال: Twilio / Unifonic / Omantel — تُضاف عند توفّر الحساب
  throw new Error(`SMS provider "${provider}" غير مدعوم بعد`);
}
