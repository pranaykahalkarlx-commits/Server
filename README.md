# 📞 AI Receptionist — OTP Email App

Built with **Express** + **Resend**, deployable to **Railway**.

## 🚀 Deploy to Railway

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/otp-app.git
git push -u origin main
```
> ⚠️ `.env` is gitignored — set variables in Railway dashboard instead.

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select your repo — Railway auto-runs `npm start`

### 3. Set Environment Variables in Railway dashboard → Variables tab:

| Key | Value |
|-----|-------|
| `RESEND_API_KEY` | `re_GJjQJrPp_A1Gk58Fa27PF3iBK97SRjQzF` |
| `FROM_EMAIL` | `AI Receptionist <onboarding@resend.dev>` |

Railway sets `PORT` automatically.

## 🔌 API

| Method | Route | Body |
|--------|-------|------|
| POST | `/api/send-otp` | `{ email }` |
| POST | `/api/verify-otp` | `{ email, otp }` |

## 💡 Notes
- OTPs expire after 5 minutes
- `onboarding@resend.dev` only sends to your Resend-registered email
- To send to any email, verify your domain at resend.com/domains
