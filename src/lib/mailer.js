// Sends transactional email (currently just password-reset links) via Gmail's SMTP relay,
// authenticated with a Google Account App Password rather than a full Resend/domain-verified
// sending setup. This intentionally avoids needing a verified sending domain — the DNS host
// for thehotelieroffice.org (Wix) does not support the subdomain MX record that services like
// Resend require for domain verification, so Gmail SMTP (which needs no DNS changes at all)
// is the pragmatic choice here.
//
// Required env vars:
//   SMTP_USER          — the Gmail/Google Workspace address to send from (e.g. operations@thehotelieroffice.com)
//   SMTP_APP_PASSWORD  — a 16-character Google "App Password" for that account (NOT the login password)
const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return transporter;
}

// True once SMTP_USER/SMTP_APP_PASSWORD are configured — routes use this to decide whether to
// even attempt sending, and log a clear server-side message instead of failing confusingly.
function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_APP_PASSWORD);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const t = getTransporter();
  if (!t) throw new Error('smtp_not_configured');
  const safeName = escapeHtml(name || '');
  const safeUrl = escapeHtml(resetUrl);
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a;">
    <h2 style="margin:0 0 16px;">THO Mystery Guest Platform</h2>
    <p style="margin:0 0 8px;" dir="rtl">مرحبًا ${safeName}،</p>
    <p style="margin:0 0 16px;" dir="rtl">وصلنا طلب لإعادة تعيين كلمة السر لحسابك. اضغط الرابط ده خلال ساعة من دلوقتي:</p>
    <p style="margin:0 0 24px;"><a href="${safeUrl}" style="background:#0f2a4a;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">إعادة تعيين كلمة السر</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#666;" dir="rtl">لو ما طلبتش ده، تجاهل الإيميل ده — حسابك آمن ومفيش تغيير هيحصل.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="margin:0 0 8px;">Hi ${safeName},</p>
    <p style="margin:0 0 16px;">We received a request to reset your password. Click the link below within the next hour:</p>
    <p style="margin:0 0 24px;"><a href="${safeUrl}">${safeUrl}</a></p>
    <p style="margin:0;font-size:13px;color:#666;">If you didn't request this, you can safely ignore this email.</p>
  </div>`;
  await t.sendMail({
    from: `"THO Mystery Guest" <${process.env.SMTP_USER}>`,
    to,
    subject: 'إعادة تعيين كلمة السر / Reset your password — THO Mystery Guest',
    html,
  });
}

module.exports = { sendPasswordResetEmail, isConfigured };
