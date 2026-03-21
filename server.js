require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');

const app = express();
app.use(express.json());
app.use(cors());

const resend = new Resend(process.env.RESEND_API_KEY);

// Temporary OTP storage (no DB for simplicity)
const otpStore = {};

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// SEND OTP
app.post('/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  const otp = generateOTP();

  otpStore[email] = {
    otp,
    expires: Date.now() + 5 * 60 * 1000
  };

  try {
    await resend.emails.send({
      from: 'info@marketlly.shop',   // your email
      to: email,
      subject: 'Your OTP Code',
      html: `<h2>Your OTP is: ${otp}</h2>`
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Email send failed' });
  }
});

// VERIFY OTP
app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  const record = otpStore[email];

  if (!record) {
    return res.status(400).json({ success: false, message: 'No OTP found' });
  }

  if (Date.now() > record.expires) {
    return res.status(400).json({ success: false, message: 'OTP expired' });
  }

  if (record.otp !== otp) {
    return res.status(400).json({ success: false, message: 'Wrong OTP' });
  }

  delete otpStore[email];

  res.json({ success: true, message: 'Verified' });
});

// ROOT (important for Railway health check)
app.get('/', (req, res) => {
  res.send('Server running');
});

// START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
