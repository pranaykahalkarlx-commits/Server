const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 8080;

// ─── RESEND CLIENT ────────────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ─── IN-MEMORY OTP STORE ──────────────────────────────────────────────────────
// { email: { otp, expiresAt, attempts } }
const otpStore = new Map();
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanExpiredOTPs() {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (now > data.expiresAt) otpStore.delete(email);
  }
}

// Clean every 5 minutes
setInterval(cleanExpiredOTPs, 5 * 60 * 1000);

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'AI Receptionist Server is running ✅' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email address is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit: prevent spam (max 1 OTP per 60 seconds)
    const existing = otpStore.get(normalizedEmail);
    if (existing && Date.now() < existing.expiresAt - (OTP_EXPIRY_MS - 60000)) {
      return res.status(429).json({
        success: false,
        message: 'Please wait 60 seconds before requesting a new code.'
      });
    }

    const otp = generateOTP();
    otpStore.set(normalizedEmail, {
      otp,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
      attempts: 0
    });

    // Send email via Resend
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'AI Receptionist <info@marketlly.shop>',
      to: normalizedEmail,
      subject: `${otp} — Your AI Receptionist login code`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="margin:0;padding:0;background:#eef1f8;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
            <tr><td align="center">
              <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(99,102,241,.12);">
                <tr>
                  <td style="background:linear-gradient(135deg,#5b5ef4,#7c3aed);padding:32px;text-align:center;">
                    <div style="width:52px;height:52px;background:rgba(255,255,255,.2);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:24px;">📞</div>
                    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-.02em;">AI Receptionist</h1>
                    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;font-size:14px;">Your verification code</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:36px 40px;text-align:center;">
                    <p style="color:#7077a1;font-size:14px;margin:0 0 24px;">Use the code below to sign in. It expires in <strong>10 minutes</strong>.</p>
                    <div style="background:#f0f2ff;border:2px dashed #c7c9f9;border-radius:14px;padding:24px;margin-bottom:24px;">
                      <span style="font-size:42px;font-weight:800;letter-spacing:10px;color:#5b5ef4;font-family:'Courier New',monospace;">${otp}</span>
                    </div>
                    <p style="color:#7077a1;font-size:12px;margin:0;">If you didn't request this, you can safely ignore this email.</p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f8f9ff;padding:16px 40px;text-align:center;border-top:1px solid #eef1f8;">
                    <p style="color:#9098c0;font-size:11px;margin:0;">AI Receptionist Portal • Secure Login</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ success: false, message: 'Failed to send email. Check your Resend configuration.' });
    }

    console.log(`✅ OTP sent to ${normalizedEmail}`);
    res.json({ success: true, message: 'Verification code sent to your email.' });

  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({ success: false, message: 'No code found. Please request a new one.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ success: false, message: 'Code has expired. Please request a new one.' });
    }

    record.attempts += 1;

    if (record.attempts > MAX_ATTEMPTS) {
      otpStore.delete(normalizedEmail);
      return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new code.' });
    }

    if (record.otp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        message: `Invalid code. ${MAX_ATTEMPTS - record.attempts} attempt(s) remaining.`
      });
    }

    // ✅ Valid — delete OTP so it can't be reused
    otpStore.delete(normalizedEmail);
    console.log(`✅ Login verified for ${normalizedEmail}`);

    res.json({ success: true, message: 'Verified successfully.' });

  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 AI Receptionist server running on port ${PORT}`);
  console.log(`📧 Email provider: Resend.com`);
  console.log(`🔑 Resend API Key: ${process.env.RESEND_API_KEY ? '✅ Set' : '❌ MISSING — set RESEND_API_KEY env var'}`);
  console.log(`📮 From Email: ${process.env.FROM_EMAIL || 'info@marketlly.shop (default)'}`);
});
