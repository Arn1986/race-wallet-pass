# Complete Cloudflare Deployment Guide: Wallet Pass Platform

This step-by-step guide walks you through deploying the **Multi-Tenant Wallet Pass Management Platform** to Cloudflare using **Cloudflare Pages / Workers**, **D1 Database (SQLite)**, **R2 Object Storage**, and **Cloudflare Queues**.

---

## 📋 Prerequisites

Before you start, make sure you have:
1. A **Cloudflare account** ([Sign up for free](https://dash.cloudflare.com/sign-up)).
2. **Node.js 20+** installed on your workstation.
3. A **walletwallet.dev API Key** (optional for local mock testing, required for production APNs/FCM certificate signing).
4. A **Resend API Key** ([resend.com](https://resend.com)) for transactional email delivery.

---

## 🛠️ Step 1: Install Wrangler & Log in to Cloudflare

Cloudflare's official CLI is **Wrangler**. If you do not have it globally installed, install it or run it via `npx`:

```bash
# Verify or install Wrangler
npm install -g wrangler

# Authenticate with your Cloudflare account
npx wrangler login
```
*A browser window will open asking you to authorize Wrangler with your Cloudflare account.*

---

## 🗄️ Step 2: Create the Cloudflare D1 Database

Run the following command to provision the serverless SQLite database on Cloudflare edge:

```bash
npx wrangler d1 create wallet_pass_db
```

### Expected Output:
```text
✅ Successfully created DB 'wallet_pass_db'!

Add the following to your wrangler.toml:

[[d1_databases]]
binding = "DB"
database_name = "wallet_pass_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

> ⚠️ **Important:** Copy the generated `database_id` value. You will paste it into `wrangler.toml` in Step 6.

---

## 📜 Step 3: Execute Database Schema Migrations on D1

Initialize the tables (`Organizations`, `Templates`, `Races`, `Runners`, `Passes`) using the included `schema.sql` file.

### For Local Development / Emulator:
```bash
npx wrangler d1 execute wallet_pass_db --local --file=./schema.sql
```

### For Production (Remote Edge Data Centers):
```bash
npx wrangler d1 execute wallet_pass_db --remote --file=./schema.sql
```

### Verify Tables:
```bash
npx wrangler d1 execute wallet_pass_db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
```

---

## 🪣 Step 4: Create the Cloudflare R2 Object Storage Bucket

Create the R2 storage bucket to store Apple Wallet strip hero graphics, logos, and badge assets:

```bash
npx wrangler r2 bucket create wallet-pass-assets
```

### Enable Public Access (or Custom Domain) for R2
Pass graphics must be publicly accessible by Apple Wallet and Google Wallet:

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **R2 Storage** > Click on `wallet-pass-assets`.
3. Go to the **Settings** tab.
4. Under **Public Access**, either:
   * Click **Connect Domain** to map a custom domain (e.g. `assets.yourdomain.com`), OR
   * Enable the **R2.dev Subdomain** (e.g. `pub-xxxxxxxxxxxx.r2.dev`).

---

## 📬 Step 5: Create the Cloudflare Queue

Create the `pass-issuance-queue` used for non-blocking asynchronous CSV batch imports:

```bash
npx wrangler queues create pass-issuance-queue
```

---

## ⚙️ Step 6: Update `wrangler.toml`

Open `wrangler.toml` in the project root and replace `database_id` with the UUID you obtained in **Step 2**:

```toml
name = "wallet-pass-platform"
compatibility_date = "2026-10-10"

# Cloudflare D1 Database
[[d1_databases]]
binding = "DB"
database_name = "wallet_pass_db"
database_id = "REPLACE_WITH_YOUR_ACTUAL_D1_DATABASE_ID"

# Cloudflare R2 Bucket
[[r2_buckets]]
binding = "ASSETS_BUCKET"
bucket_name = "wallet-pass-assets"

# Cloudflare Queue (Producer / Consumer)
[[queues.producers]]
queue = "pass-issuance-queue"
binding = "PASS_QUEUE"

[[queues.consumers]]
queue = "pass-issuance-queue"
max_batch_size = 10
max_batch_timeout = 30

[vars]
PUBLIC_DOMAIN = "https://yourdomain.com"
WALLETWALLET_API_URL = "https://api.walletwallet.dev/v1"
```

---

## 🔐 Step 7: Configure Production Secrets & Email Delivery (Resend)

Pass invitation emails and self-service lookup notifications are delivered using **Resend** (`https://resend.com`).

You have two convenient ways to configure your **RESEND_API_KEY**:

### Method 1: Directly via the Web Application UI (Recommended)
1. In your deployed application, open the **Admin Console** (`#/admin/cloudflare`).
2. Click the **API Credentials & Environment** sub-tab.
3. Paste your Resend API Key (`re_...`) into **RESEND_API_KEY**.
4. (Optional) Set **EMAIL_FROM** (default: `Wallet Pass <onboarding@resend.dev>`).
5. Click **Save Configuration to D1**.
6. Use the built-in **Live Resend Delivery Smoke Test** on the same page to send a test email and verify the live connection!

### Method 2: Via Cloudflare Dashboard / Wrangler CLI
```bash
# 1. Resend Transactional Email API Key
npx wrangler secret put RESEND_API_KEY
# Enter your Resend token (re_...) when prompted

# 2. walletwallet.dev API Secret Key (optional for mock preview)
npx wrangler secret put WALLETWALLET_API_KEY
```
*Or in the Cloudflare Dashboard: Go to **Workers & Pages** > Your Project > **Settings** > **Variables and Secrets** > **Add Secret** (`RESEND_API_KEY`).*

---

## ❓ Troubleshooting: "Why didn't I receive an email with the pass?"

If you registered yourself or an attendee but did not receive an email:

1. **Check if RESEND_API_KEY is configured:**
   - Go to **Admin Console** > **Settings** sub-tab. Check if the status badge shows *Resend Key Active* or *RESEND_API_KEY Missing*. If missing, add your API key from [resend.com/api-keys](https://resend.com/api-keys).

2. **Resend Free Account Testing Restriction (`onboarding@resend.dev`):**
   - **Crucial:** Resend's free default sender domain (`onboarding@resend.dev`) will **ONLY deliver to the email address you used to register your Resend account**.
   - If you register a different participant email without a verified domain, Resend rejects it with:
     `You can only send testing emails to your own email address (...)`.
   - **Solution:** Either test using your own Resend account email, or add and verify a custom domain (SPF/DKIM) at [resend.com/domains](https://resend.com/domains) and set `EMAIL_FROM` to e.g. `Passes <tickets@yourdomain.com>`.

3. **Check the Participant Roster & Instant Pass Link:**
   - Every participant created is immediately saved in the Cloudflare D1 database.
   - In **Races & Participants**, click the **Mail** icon on any runner to retry sending the email with real-time feedback.
   - Click the **Copy Link** button or **Open Pass** (`ExternalLink` icon) to instantly access the pass URL (`/pass/{runnerId}`) in any iPhone/Android browser without needing email!

---

## 🚀 Step 8: Build and Deploy

### Option A: Deploy with Cloudflare Pages (Recommended for Full-Stack Frontend + Functions)

```bash
# Build production bundle
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=wallet-pass-platform
```

### Option B: Deploy via Cloudflare Workers

If deploying using Astro's Cloudflare adapter or Worker entry point:

```bash
# Deploy Worker
npx wrangler deploy
```

---

## 🧪 Step 9: Post-Deployment Smoke Test

Once deployed, verify all endpoints using your production URL (e.g., `https://wallet-pass-platform.pages.dev`):

### 1. Test D1 & API Status:
```bash
curl -s https://wallet-pass-platform.pages.dev/api/stats | jq
```

### 2. Test Apple Wallet `.pkpass` Binary Streaming Proxy:
```bash
curl -I https://wallet-pass-platform.pages.dev/api/pass/download/run-marathon-1042
```
*Verify that `Content-Type: application/vnd.apple.pkpass` is returned.*

### 3. Test Participant Self-Service Lookup:
```bash
curl -X POST https://wallet-pass-platform.pages.dev/api/lookup \
  -H "Content-Type: application/json" \
  -d '{"email":"arnoldcaisip@gmail.com"}'
```

### 4. Test Lockscreen Push Updates:
```bash
curl -X PUT https://wallet-pass-platform.pages.dev/api/runner/update \
  -H "Content-Type: application/json" \
  -d '{
    "runner_id": "run-marathon-1042",
    "dynamic_data": { "start_wave": "Wave A (06:45 AM)" },
    "field_changed": "start_wave",
    "old_value": "Wave A (06:30 AM)",
    "new_value": "Wave A (06:45 AM)"
  }'
```

---

## 📱 Architecture Flow Summary

```
                       [ Athlete Mobile Device ]
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
    "Add to Apple Wallet"                       APNs Lockscreen Push
              │                                         │
              ▼                                         ▼
   /api/pass/download/:id                     /api/runner/update
              │                                         │
    (Cloudflare Edge Proxy)                    (D1 DB Mutation)
              │                                         │
              ├──► Query D1 Database                    ├──► Update Runners Row
              ├──► Read R2 Graphic Assets               └──► walletwallet.dev PUT
              └──► Stream .pkpass binary                     (Triggers APNs/FCM)
```

You are now fully running a zero-friction, serverless wallet pass management system on the Cloudflare edge network!
