/**
 * AI Receptionist — Backend Server
 * Runs on Railway. Handles:
 *  - OTP auth (email via nodemailer / console fallback)
 *  - Per-user key-value storage (SQLite)
 *  - CORS for your frontend domain
 */

const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── DATABASE SETUP ───────────────────────────────────────────
// Railway gives you a persistent /data volume — use it.
// Fallback to local ./data for development.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'receptionist.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS user_data (
    email TEXT NOT NULL,
    key   TEXT NOT NULL,
    value TEXT,
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

// ─── CORS ─────────────────────────────────────────────────────
// Allow requests from any origin (your HTML file, localhost, etc.)
// Lock this down to your domain in production if needed:
//   origin: ['https://yourdomain.com']
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));  // 10MB — enough for leads + call records

// ─── EMAIL (OTP) ──────────────────────────────────────────────
// Set these env vars in Railway:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// If not set, OTP is printed to Railway logs (good for testing).
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('✅ Email transporter configured');
} else {
  console.log('⚠️  No SMTP config — OTPs will be printed to logs (dev mode)');
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOTPEmail(email, otp) {
  if (!transporter) {
    // Dev mode — just log it
    console.log(`\n🔑 OTP for ${email}: ${otp}\n`);
    return true;
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Your AI Receptionist Login Code',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px">
        <h2 style="color:#5b5ef4">AI Receptionist</h2>
        <p>Your one-time login code is:</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#5b5ef4;padding:20px 0">${otp}</div>
        <p style="color:#888">This code expires in 10 minutes.</p>
      </div>
    `,
  });
  return true;
}

// ─── AUTH ROUTES ──────────────────────────────────────────────

// POST /api/auth/send-otp
app.post('/api/auth/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address' });
  }

  const otp = generateOTP();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  // Upsert OTP record
  db.prepare(`
    INSERT INTO otp_codes (email, otp, expires_at, attempts)
    VALUES (?, ?, ?, 0)
    ON CONFLICT(email) DO UPDATE SET
      otp = excluded.otp,
      expires_at = excluded.expires_at,
      attempts = 0
  `).run(email.toLowerCase().trim(), otp, expiresAt);

  try {
    await sendOTPEmail(email, otp);
    res.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ success: false, message: 'Failed to send email. Check SMTP config.' });
  }
});

// POST /api/auth/verify-otp
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP required' });
  }

  const emailNorm = email.toLowerCase().trim();
  const record = db.prepare('SELECT * FROM otp_codes WHERE email = ?').get(emailNorm);

  if (!record) {
    return res.status(400).json({ success: false, message: 'No OTP sent for this email. Request a new one.' });
  }

  // Check expiry
  if (Math.floor(Date.now() / 1000) > record.expires_at) {
    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(emailNorm);
    return res.status(400).json({ success: false, message: 'OTP expired. Please request a new code.' });
  }

  // Rate limit: max 5 attempts
  if (record.attempts >= 5) {
    db.prepare('DELETE FROM otp_codes WHERE email = ?').run(emailNorm);
    return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.' });
  }

  if (record.otp !== String(otp).trim()) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?').run(emailNorm);
    const left = 4 - record.attempts;
    return res.status(400).json({ success: false, message: `Invalid code. ${left} attempt(s) left.` });
  }

  // Success — delete used OTP
  db.prepare('DELETE FROM otp_codes WHERE email = ?').run(emailNorm);
  res.json({ success: true, message: 'Verified' });
});

// ─── USER DATA ROUTES ─────────────────────────────────────────

// GET /api/user-data?email=x&key=y  — load one key
app.get('/api/user-data', (req, res) => {
  const { email, key } = req.query;
  if (!email || !key) {
    return res.status(400).json({ error: 'email and key required' });
  }

  const row = db.prepare('SELECT value FROM user_data WHERE email = ? AND key = ?')
                .get(email.toLowerCase().trim(), key);

  if (!row) {
    return res.status(404).json({ value: null });
  }

  try {
    // Try to return parsed JSON (for objects/arrays)
    res.json({ value: JSON.parse(row.value) });
  } catch {
    // Return as plain string if not JSON
    res.json({ value: row.value });
  }
});

// POST /api/user-data  — save one key
app.post('/api/user-data', (req, res) => {
  const { email, key, value } = req.body;
  if (!email || !key) {
    return res.status(400).json({ error: 'email and key required' });
  }

  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  db.prepare(`
    INSERT INTO user_data (email, key, value, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(email, key) DO UPDATE SET
      value = excluded.value,
      updated_at = strftime('%s','now')
  `).run(email.toLowerCase().trim(), key, serialized);

  res.json({ success: true, key, value });
});

// POST /api/user-data/bulk  — save multiple keys at once (faster)
app.post('/api/user-data/bulk', (req, res) => {
  const { email, data } = req.body;  // data = { key: value, key2: value2, ... }
  if (!email || !data || typeof data !== 'object') {
    return res.status(400).json({ error: 'email and data object required' });
  }

  const emailNorm = email.toLowerCase().trim();
  const upsert = db.prepare(`
    INSERT INTO user_data (email, key, value, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(email, key) DO UPDATE SET
      value = excluded.value,
      updated_at = strftime('%s','now')
  `);

  // Run all upserts in a single transaction (fast)
  const saveAll = db.transaction((entries) => {
    for (const [key, value] of entries) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      upsert.run(emailNorm, key, serialized);
    }
  });

  saveAll(Object.entries(data));
  res.json({ success: true, saved: Object.keys(data).length });
});

// GET /api/user-data/all?email=x  — load ALL keys for a user (one round-trip)
app.get('/api/user-data/all', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });

  const rows = db.prepare('SELECT key, value FROM user_data WHERE email = ?')
                 .all(email.toLowerCase().trim());

  const result = {};
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value); }
    catch { result[row.key] = row.value; }
  }

  res.json(result);
});

// DELETE /api/user-data?email=x&key=y  — delete one key
app.delete('/api/user-data', (req, res) => {
  const { email, key } = req.query;
  if (!email || !key) return res.status(400).json({ error: 'email and key required' });
  db.prepare('DELETE FROM user_data WHERE email = ? AND key = ?')
    .run(email.toLowerCase().trim(), key);
  res.json({ success: true });
});

// DELETE /api/user-data/all?email=x  — wipe all data for a user
app.delete('/api/user-data/all', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });
  db.prepare('DELETE FROM user_data WHERE email = ?').run(email.toLowerCase().trim());
  res.json({ success: true });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(DISTINCT email) as c FROM user_data').get().c;
  res.json({ status: 'ok', users: userCount, uptime: process.uptime() });
});

app.get('/', (req, res) => {
  res.json({ service: 'AI Receptionist API', version: '2.0', status: 'running' });
});

// ─── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 AI Receptionist backend running on port ${PORT}`);
  console.log(`📁 Database: ${path.join(DATA_DIR, 'receptionist.db')}`);
  console.log(`📧 Email: ${transporter ? 'SMTP configured' : 'Dev mode (OTPs logged)'}`);
});