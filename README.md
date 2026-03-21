# AI Receptionist — Backend Server

Express.js OTP auth server using Resend.com for email delivery. Deploy on Railway in under 5 minutes.

---

## 🚀 Step-by-Step Deployment

### STEP 1 — Get a Resend API Key (free)

1. Go to https://resend.com and sign up (free)
2. Click **API Keys** in the left sidebar
3. Click **Create API Key** → give it any name → click **Add**
4. **Copy the key** (starts with `re_...`) — you only see it once!

---

### STEP 2 — Push this code to GitHub

1. Create a new repo on https://github.com/new
   - Name: `ai-receptionist-server`
   - Set to **Private**
   - Click **Create repository**

2. Open a terminal in this folder and run:

```bash
git init
git add .
git commit -m "Initial server setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-receptionist-server.git
git push -u origin main
```

---

### STEP 3 — Deploy on Railway

1. Go to https://railway.app and log in (use GitHub)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `ai-receptionist-server` repo
4. Railway will auto-detect Node.js and start deploying

---

### STEP 4 — Set Environment Variables on Railway

In your Railway project, click your service → **Variables** tab → add these:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` (your key from Step 1) |
| `FROM_EMAIL` | `AI Receptionist <you@yourdomain.com>` |
| `PORT` | `3000` |

> **Note on FROM_EMAIL:**
> - If you haven't verified a domain on Resend, use: `onboarding@resend.dev`
> - If you have your own domain verified on Resend, use: `noreply@yourdomain.com`

After adding variables, Railway will auto-redeploy.

---

### STEP 5 — Get your Railway URL

1. In Railway, click your service → **Settings** tab
2. Under **Networking** → click **Generate Domain**
3. Copy the URL — it looks like: `https://ai-receptionist-server-production-xxxx.up.railway.app`

---

### STEP 6 — Update your index.html

Open your `index.html` and find this line near the top of the `<script>` section:

```javascript
const WORKER_URL = "https://server-production-14a0.up.railway.app";
```

Replace with your new Railway URL:

```javascript
const WORKER_URL = "https://YOUR-NEW-URL.up.railway.app";
```

---

## ✅ Test It

Visit your Railway URL in browser — you should see:
```json
{ "status": "ok", "message": "AI Receptionist Server is running ✅" }
```

Then try logging in with your email on the portal. You'll get a 6-digit OTP in your inbox!

---

## 🔧 Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | ✅ Yes | Your Resend API key (`re_...`) |
| `FROM_EMAIL` | Optional | Sender email shown to recipients |
| `PORT` | Optional | Port number (Railway sets this automatically) |

---

## 📋 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/health` | Health check with timestamp |
| POST | `/api/auth/send-otp` | Send OTP to email |
| POST | `/api/auth/verify-otp` | Verify submitted OTP |

---

## 🛡️ Security Features

- OTPs expire after **10 minutes**
- Max **5 verification attempts** per OTP
- **60-second cooldown** between OTP requests
- OTPs are deleted after successful verification (single-use)
- Expired OTPs are auto-cleaned every 5 minutes
