const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory OTP store: { email: { otp, expiresAt } }
const otpStore = {};

// Configure your email sender (Gmail example)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,     // your Gmail address
    pass: process.env.EMAIL_PASS      // Gmail App Password (not your login password)
  }
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/send-otp
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: 'Email is required' });

  const otp = generateOTP();
  otpStore[email] = { otp, expiresAt: Date.now() + 10 * 60 * 1000 }; // 10 min expiry

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your AI Receptionist Login Code',
      html: `
        <h2>Your verification code</h2>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p>
        <p>This code expires in 10 minutes.</p>
      `
    });
    res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    console.error('Email error:', err.message);
    res.json({ success: false, message: 'Failed to send email: ' + err.message });
  }
});

// POST /api/auth/verify-otp
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.json({ success: false, message: 'Email and OTP required' });

  const record = otpStore[email];
  if (!record) return res.json({ success: false, message: 'No OTP found. Request a new one.' });
  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.json({ success: false, message: 'OTP expired. Request a new one.' });
  }
  if (record.otp !== otp) return res.json({ success: false, message: 'Invalid code. Try again.' });

  delete otpStore[email]; // one-time use
  res.json({ success: true, message: 'Verified' });
});

app.get('/', (req, res) => res.send('AI Receptionist Backend Running'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
