import config from '../config.js';

/**
 * مرسل بريد بسيط: يطبع في السجلّ افتراضياً.
 * لتفعيل SMTP حقيقي: ضع MAIL_DRIVER=smtp وثبّت nodemailer ثم أكمل الفرع أدناه.
 */
export async function sendMail({ to, subject, text, html }) {
  if (config.mail.driver === 'log') {
    console.log(`\n📧 [بريد] إلى: ${to}\n   الموضوع: ${subject}\n   ${(text || html || '').replace(/\n/g, '\n   ')}\n`);
    return { delivered: true, driver: 'log' };
  }
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({ from: config.mail.from, to, subject, text, html });
    return { delivered: true, driver: 'smtp' };
  } catch (err) {
    console.warn('[mailer] تعذّر الإرسال عبر SMTP:', err.message);
    return { delivered: false, error: err.message };
  }
}
