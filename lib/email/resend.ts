import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = `${process.env.RESEND_FROM_NAME ?? 'No Brakes Sports'} <${process.env.RESEND_FROM_EMAIL ?? 'noreply@nobrakes.sports'}>`

export async function sendWelcomeEmail(to: string, name: string) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Welcome to No Brakes Sports',
    html: `
      <div style="font-family:monospace;background:#0a0a0a;color:#fff;padding:40px;max-width:480px;margin:0 auto;border:1px solid #1a1a1a;border-radius:8px;">
        <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;letter-spacing:-0.5px;">Welcome, ${name}</h1>
        <p style="color:#666;font-size:14px;margin:0 0 24px;line-height:1.6;">
          Your No Brakes Sports account is ready. You're on the Free plan — start exploring market analytics and tracking your favorite leagues.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display:inline-block;background:#fff;color:#0a0a0a;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          Go to Dashboard →
        </a>
        <p style="color:#333;font-size:11px;margin:32px 0 0;line-height:1.5;">
          This platform provides sports market data for informational purposes only. Not financial or gambling advice.
        </p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  return resend.emails.send({
    from: FROM,
    to,
    subject: 'Reset your password — No Brakes Sports',
    html: `
      <div style="font-family:monospace;background:#0a0a0a;color:#fff;padding:40px;max-width:480px;margin:0 auto;border:1px solid #1a1a1a;border-radius:8px;">
        <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Password Reset</h1>
        <p style="color:#666;font-size:14px;margin:0 0 24px;line-height:1.6;">
          We received a request to reset your No Brakes Sports password. Click the button below to set a new one.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#fff;color:#0a0a0a;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          Reset Password →
        </a>
        <p style="color:#333;font-size:11px;margin:32px 0 0;">
          This link expires in 1 hour. If you didn't request a reset, ignore this email.
        </p>
      </div>
    `,
  })
}

export async function sendSubscriptionEmail(
  to: string,
  name: string,
  event: 'upgraded' | 'canceled' | 'payment_failed'
) {
  const subjects = {
    upgraded: 'You\'re now on Pro — No Brakes Sports',
    canceled: 'Your Pro subscription has been canceled',
    payment_failed: 'Payment failed — action required',
  }
  const bodies = {
    upgraded: `Your Pro plan is now active. Enjoy real-time market data, full history, unlimited alerts, and more.`,
    canceled: `Your Pro subscription has been canceled. You'll retain Pro access through your billing period end.`,
    payment_failed: `We couldn't process your payment. Please update your billing information to keep your Pro access.`,
  }
  return resend.emails.send({
    from: FROM,
    to,
    subject: subjects[event],
    html: `
      <div style="font-family:monospace;background:#0a0a0a;color:#fff;padding:40px;max-width:480px;margin:0 auto;border:1px solid #1a1a1a;border-radius:8px;">
        <h1 style="font-size:18px;font-weight:700;margin:0 0 8px;">${subjects[event]}</h1>
        <p style="color:#999;font-size:14px;margin:0 0 24px;line-height:1.6;">Hi ${name}, ${bodies[event]}</p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/account/billing" style="display:inline-block;background:#fff;color:#0a0a0a;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          Manage Billing →
        </a>
      </div>
    `,
  })
}
