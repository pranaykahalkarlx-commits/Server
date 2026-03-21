const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

// In-memory OTP store
const otpStore = {};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/send-otp
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, message: 'Email is required' });

  const otp = generateOTP();
  otpStore[email] = { otp, expiresAt: Date.now() + 10 * 60 * 1000 };

  try {
    await resend.emails.send({
      from: 'AI Receptionist <onboarding@resend.dev>',
      to: email,
      subject: 'Your AI Receptionist Login Code',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#f8f9ff;border-radius:16px">
          <h2 style="color:#5b5ef4;margin-bottom:8px">AI Receptionist</h2>
          <p style="color:#7077a1;margin-bottom:24px">Your verification code:</p>
          <div style="font-size:40px;font-weight:800;letter-spacing:12px;color:#1e2240;background:#fff;padding:20px;border-radius:12px;text-align:center;border:1px solid rgba(99,102,241,.2)">
            ${otp}
          </div>
          <p style="color:#7077a1;font-size:13px;margin-top:20px">This code expires in 10 minutes. Do not share it with anyone.</p>
        </div>
      `
    });
    res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    console.error('Resend error:', err.message);
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

  delete otpStore[email];
  res.json({ success: true, message: 'Verified' });
});

app.get('/', (req, res) => res.send('AI Receptionist Backend Running'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

## Railway Environment Variables

In Railway → your service → **Variables**, add just one:
```
RESEND_API_KEY=re_GJjQJrPp_A1Gk58Fa27PF3iBK97SRjQzF
