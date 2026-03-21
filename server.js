/**
 * AI Receptionist — Backend Server v3.0
 * ✅ Fixed: Gmail (nodemailer) OTP email
 * ✅ Fixed: CORS for all origins
 * ✅ Fixed: Proper root + health routes (no more 404)
 * ✅ Fixed: SQLite persistent storage
 * ✅ Fixed: Railway PORT env variable
 */

const express    = require('express');
const cors       = require('cors');
const Database   = require('better-sqlite3');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 8080;

// ─── DATABASE SETUP ───────────────────────────────────────────
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'receptionist.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS user_data (
    email      TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (email, key)
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    email      TEXT PRIMARY KEY,
    otp        TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER DEFAULT 0
  );
`);

console.log('✅ Database ready at', path.join(DATA_DIR, 'receptionist.db'));

// ─── CORS ─────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight OPTIONS for all routes
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// ─── EMAIL SETUP (Gmail) ──────────────────────────────────────
// Set in Railway → Variables:
//   EMAIL_USER = your.email@gmail.com
//   EMAIL_PASS = xxxx xxxx xxxx xxxx  ← Gmail App Password (NOT your login password)
//
// How to get Gmail App Password:
//   1. Go to myaccount.google.com → Security
//   2. Enable 2-Step Verification
//   3. Search "App Passwords" → create one → copy 16-char code
//   4. Paste it as EMAIL_PASS in Railway Variables

let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  console.log('✅ Gmail transporter configured for:', process.env.EMAIL_USER);
} else {
  console.log('⚠️  EMAIL_USER / EMAIL_PASS not set in Railway Variables');
  console.log('⚠️  Running in DEV mode — OTPs will be printed to Railway logs');
  console.log('⚠️  Go to Railway → Variables and add EMAIL_USER + EMAIL_PASS');
}

// ─── OTP HELPERS ─────────────────────────────────────────────
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOTPEmail(toEmail, otp) {
  if (!transporter) {
    // DEV MODE — print OTP to Railway logs
    console.log('');
    console.log('========================================');
    console.log(`🔑 OTP for ${toEmail} : ${otp}`);
    console.log('   (Add EMAIL_USER + EMAIL_PASS in Railway Variables to send real emails)');
    console.log('========================================');
    console.log('');
    return true;
  }

  await transporter.sendMail({
    from: `"AI Receptionist" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your AI Receptionist Login Code',
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="width:52px;height:52px;background:linear-gradient(135deg,#5b5ef4,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center">
            <span style="color:white;font-size:22px">📞</span>
          </div>
          <h2 style="color:#1e2240;margin:12px 0 4px;font-size:20px">AI Receptionist</h2>
          <p style="color:#7077a1;margin:0;font-size:14px">Your one-time login code</p>
        </div>
        <div style="background:#f0f0ff;border:2px solid #e0e0ff;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#5b5ef4;font-family:monospace">${otp}</div>
        </div>
        <p style="color:#7077a1;font-size:13px;text-align:center;margin:0">
          ⏱ This code expires in <strong>10 minutes</strong>.<br>
          Do not share this code with anyone.
        </p>
      </div>
    `,
  });

  console.log(`✅ OTP email sent to ${toEmail}`);
  return true;
}

// ─── ROOT + HEALTH ROUTES ─────────────────────────────────────
// These fix the 404 errors you saw in Railway logs

app.get('/', (req, res) => {
  res.json({
    service: 'AI Receptionist API',
    version: '3.0',
    status: 'running ✅',
    email: process.env.EMAIL_USER ? `configured (${process.env.EMAIL_USER})` : 'not configured (dev mode)',
    uptime: Math.floor(process.uptime()) + 's'
  });
});

app.get('/health', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(DISTINCT email) as c FROM user_data').get().c;
    const otpCount  = db.prepare('SELECT COUNT(*) as c FROM otp_codes').get().c;
    res.json({ status: 'ok', users: userCount, pending_otps: otpCount, uptime: process.uptime() });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// robots.txt — stops 404 log spam
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /');
});

// ─── AUTH: SEND OTP ───────────────────────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    const emailNorm  = email.toLowerCase().trim();
    const otp        = generateOTP();
    const expiresAt  = Math.floor(Date.now() / 1000) + 600; // 10 min

    // Save OTP to DB (replace existing if any)
    db.prepare(`
      INSERT INTO otp_codes (email, otp, expires_at, attempts)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(email) DO UPDATE SET
        otp        = excluded.otp,
        expires_at = excluded.expires_at,
        attempts   = 0
    `).run(emailNorm, otp, expiresAt);

    await sendOTPEmail(emailNorm, otp);

    res.json({ success: true, message: 'OTP sent! Check your email.' });

  } catch (err) {
    console.error('❌ send-otp error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP: ' + err.message
    });
  }
});

// ─── AUTH: VERIFY OTP ─────────────────────────────────────────
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const emailNorm = email.toLowerCase().trim();
    const record    = db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(emailNorm);

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found for this email. Please request a new code.'
      });
    }

    // Check expiry
    if (Math.floor(Date.now() / 1000) > record.expires_at) {
      db.prepare('DELETE FROM otp_codes WHERE email = ?').run(emailNorm);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new code.'
      });
    }

    // Rate limit: max 5 attempts
    if (record.attempts >= 5) {
      db.prepare('DELETE FROM otp_codes WHERE email = ?').run(emailNorm);
      return res.status(429).json({
        success: false,
        message: 'Too many wrong attempts. Please request a new code.'
      });
    }

    // Wrong OTP
    if (record.otp !== String(otp).trim()) {
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?').run(emailNorm);
      const attemptsLeft = 4 - record.attempts;
      return res.status(400).json({
        success: false,
        message: `Wrong code. ${attemptsLeft} attempt(s) remaining.`
      });
    }

    // ✅ Correct OTP — delete and approve
    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(emailNorm);
    console.log(`✅ Login verified for ${emailNorm}`);
    res.json({ success: true, message: 'Login successful!' });

  } catch (err) {
    console.error('❌ verify-otp error:', err.message);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

// ─── USER DATA: GET ONE KEY ───────────────────────────────────
app.get('/api/user-data', (req, res) => {
  try {
    const { email, key } = req.query;
    if (!email || !key) {
      return res.status(400).json({ error: 'email and key are required' });
    }

    const row = db.prepare('SELECT value FROM user_data WHERE email = ? AND key = ?')
                  .get(email.toLowerCase().trim(), key);

    if (!row) return res.status(404).json({ value: null });

    try { res.json({ value: JSON.parse(row.value) }); }
    catch { res.json({ value: row.value }); }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER DATA: SAVE ONE KEY ──────────────────────────────────
app.post('/api/user-data', (req, res) => {
  try {
    const { email, key, value } = req.body;
    if (!email || !key) {
      return res.status(400).json({ error: 'email and key are required' });
    }

    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    db.prepare(`
      INSERT INTO user_data (email, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(email, key) DO UPDATE SET
        value      = excluded.value,
        updated_at = strftime('%s','now')
    `).run(email.toLowerCase().trim(), key, serialized);

    res.json({ success: true, key });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER DATA: BULK SAVE ────────────────────────────────────
app.post('/api/user-data/bulk', (req, res) => {
  try {
    const { email, data } = req.body;
    if (!email || !data || typeof data !== 'object') {
      return res.status(400).json({ error: 'email and data object are required' });
    }

    const emailNorm = email.toLowerCase().trim();
    const upsert = db.prepare(`
      INSERT INTO user_data (email, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
      ON CONFLICT(email, key) DO UPDATE SET
        value      = excluded.value,
        updated_at = strftime('%s','now')
    `);

    const saveAll = db.transaction((entries) => {
      for (const [key, value] of entries) {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        upsert.run(emailNorm, key, serialized);
      }
    });

    saveAll(Object.entries(data));
    res.json({ success: true, saved: Object.keys(data).length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER DATA: GET ALL KEYS ──────────────────────────────────
app.get('/api/user-data/all', (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const rows = db.prepare('SELECT key, value FROM user_data WHERE email = ?')
                   .all(email.toLowerCase().trim());

    const result = {};
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value); }
      catch { result[row.key] = row.value; }
    }

    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER DATA: DELETE ONE KEY ────────────────────────────────
app.delete('/api/user-data', (req, res) => {
  try {
    const { email, key } = req.query;
    if (!email || !key) return res.status(400).json({ error: 'email and key are required' });
    db.prepare('DELETE FROM user_data WHERE email = ? AND key = ?')
      .run(email.toLowerCase().trim(), key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USER DATA: DELETE ALL FOR USER ──────────────────────────
app.delete('/api/user-data/all', (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email is required' });
    db.prepare('DELETE FROM user_data WHERE email = ?').run(email.toLowerCase().trim());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🚀 AI Receptionist backend running!');
  console.log(`📡 Port     : ${PORT}`);
  console.log(`📁 Database : ${path.join(DATA_DIR, 'receptionist.db')}`);
  console.log(`📧 Email    : ${transporter ? process.env.EMAIL_USER : 'DEV MODE (check Railway logs for OTPs)'}`);
  console.log('');
  console.log('Routes available:');
  console.log('  GET  /                      → health info');
  console.log('  GET  /health                → detailed health check');
  console.log('  POST /api/auth/send-otp     → send OTP email');
  console.log('  POST /api/auth/verify-otp   → verify OTP');
  console.log('  GET  /api/user-data         → get one key');
  console.log('  POST /api/user-data         → save one key');
  console.log('  POST /api/user-data/bulk    → save multiple keys');
  console.log('  GET  /api/user-data/all     → get all keys for user');
  console.log('  DELETE /api/user-data       → delete one key');
  console.log('  DELETE /api/user-data/all   → delete all user data');
  console.log('');
});
