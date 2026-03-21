require('dotenv').config();
const express = require('express');
const { Resend } = require('resend');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const resend = new Resend(process.env.RESEND_API_KEY);

// In-memory OTP store: { email: { otp, expiresAt } }
const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }

  const otp = generateOTP();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  otpStore.set(email, { otp, expiresAt });

  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'AI Receptionist <info@marketlly.shop>',
      to: email,
      subject: 'Your Verification Code – AI Receptionist',
      html: `
        <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#f8f9ff;border-radius:20px;overflow:hidden;border:1px solid #e8eaf6;">
          <div style="background:linear-gradient(135deg,#6c63ff,#4f46e5);padding:36px;text-align:center;">
            <div style="display:inline-block;background:rgba(255,255,255,.2);border-radius:16px;padding:14px 18px;margin-bottom:16px;font-size:28px;">📞</div>
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">AI Receptionist</h1>
            <p style="color:rgba(255,255,255,.8);margin:8px 0 0;font-size:14px;">Email Verification</p>
          </div>
          <div style="padding:40px;text-align:center;">
            <p style="color:#6b7280;margin-bottom:28px;font-size:15px;line-height:1.6;">Use the code below to verify your identity.<br>It expires in <strong style="color:#1f2937">5 minutes</strong>.</p>
            <div style="background:#fff;border:2px solid #e8eaf6;border-radius:16px;padding:24px 40px;font-size:42px;font-weight:800;letter-spacing:14px;color:#6c63ff;font-family:monospace;box-shadow:0 4px 24px rgba(108,99,255,.1);">
              ${otp}
            </div>
            <p style="color:#9ca3af;margin-top:28px;font-size:13px;">If you didn't request this, please ignore this email.</p>
          </div>
        </div>
      `,
    });

    res.json({ success: true, message: `OTP sent to ${email}` });
  } catch (err) {
    console.error('Resend error:', err);
    res.status(500).json({ success: false, message: `Connection failed: ${err.message}` });
  }
});

// Verify OTP
app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required.' });

  const record = otpStore.get(email);
  if (!record) return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });

  if (Date.now() > record.expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
  }

  if (record.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });

  otpStore.delete(email);
  res.json({ success: true, message: 'Email verified successfully!' });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 AI Receptionist running on port ${PORT}\n`);
});
