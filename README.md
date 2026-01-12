# 🔭 Observatory Dashboard

A real-time observatory conditions dashboard built with Next.js, Supabase, and Raspberry Pi.

## ✨ Features

- **Real-time conditions**: Temperature, humidity, pressure, wind, rain
- **Sky quality monitoring**: SQM readings with historical graph  
- **Cloud detection**: AAG Cloudwatcher integration
- **AllSky camera**: Live all-sky images
- **External integrations**: BOM satellite, Clear Outside forecast, WeatherLink
- **Mobile responsive**: Works on all devices
- **Low cost**: ~$10-15/year (just the domain)

---

## 🚀 Quick Start

### Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Git](https://git-scm.com/)
- A [Supabase](https://supabase.com/) account (free)
- A [Vercel](https://vercel.com/) account (free)
- A Raspberry Pi (for data collection)

---

## 📦 Step 1: Clone and Open in VS Code

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/observatory-dashboard.git

# Open in VS Code
code observatory-dashboard
```

Or download the ZIP and extract it, then open the folder in VS Code.

**VS Code will prompt you to install recommended extensions** - click "Install All".

---

## 🗄️ Step 2: Set Up Supabase

1. Go to [supabase.com](https://supabase.com/) and create a free account
2. Click **"New Project"**
3. Choose a name and password, select a region close to you
4. Wait for the project to be created (~2 minutes)

### Run the Database Schema

5. Go to **SQL Editor** in the left sidebar
6. Click **"New Query"**
7. Copy the contents of `supabase/schema.sql` and paste it
8. Click **"Run"** (or press Cmd/Ctrl + Enter)

### Create the Image Storage Bucket

9. Go to **Storage** in the left sidebar
10. Click **"New Bucket"**
11. Name it `allsky-images`
12. Leave "Public bucket" **unchecked**
13. Click **"Create bucket"**

### Get Your API Keys

14. Go to **Settings** → **API**
15. Copy these values (you'll need them in the next step):
    - `Project URL` → This is your `SUPABASE_URL`
    - `anon public` key → This is your `SUPABASE_ANON_KEY`
    - `service_role` key → This is your `SUPABASE_SERVICE_KEY`

---

## ⚙️ Step 3: Configure Environment Variables

1. In VS Code, copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

2. Open `.env.local` and fill in your Supabase values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_KEY=eyJhbGc...
INGEST_API_KEY=generate-a-random-string-here
```

3. Generate a random API key for `INGEST_API_KEY`:

```bash
# On Mac/Linux:
openssl rand -base64 32

# Or just make up a long random string
```

---

## 🏃 Step 4: Run Locally

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

You should see the dashboard with **mock data** (since your Pi isn't connected yet).

---

## 🌐 Step 5: Deploy to Vercel

### Option A: Deploy via GitHub (Recommended)

1. Create a new repository on GitHub

2. Push your code:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/observatory-dashboard.git
git push -u origin main
```

3. Go to [vercel.com](https://vercel.com/) and sign in with GitHub

4. Click **"Add New Project"**

5. Import your `observatory-dashboard` repository

6. **Add Environment Variables** before deploying:
   
   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_ANON_KEY` | Your Supabase anon key |
   | `SUPABASE_SERVICE_KEY` | Your Supabase service key |
   | `INGEST_API_KEY` | Your random API key |

7. Click **"Deploy"**

8. Wait for deployment (~1 minute)

9. Your site is live at `https://your-project.vercel.app`!

### Option B: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Follow the prompts, then add environment variables in the Vercel dashboard
```

---

## 🏠 Step 6: Add a Custom Domain (Optional)

1. Buy a domain from [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) (~$10/year)

2. In Vercel, go to your project → **Settings** → **Domains**

3. Add your domain and follow the DNS instructions

---

## 🍓 Step 7: Set Up Raspberry Pi

### Install the Collector

SSH into your Raspberry Pi:

```bash
# Create directory
mkdir -p ~/observatory-collector
cd ~/observatory-collector

# Copy the files from raspberry-pi/ folder in this project
# You can use scp, rsync, or just copy-paste the contents

# Install Python dependencies
pip3 install -r requirements.txt

# Create your config
cp .env.example .env
nano .env
```

### Configure the Collector

Edit `~/observatory-collector/.env`:

```env
# Your Vercel URL
REMOTE_API_URL=https://your-site.vercel.app/api/ingest

# Must match INGEST_API_KEY in Vercel
API_KEY=your-secret-key-here

# Serial ports - find with: ls /dev/serial/by-id/
CLOUDWATCHER_PORT=/dev/ttyUSB0
SQM_PORT=/dev/ttyUSB1

# AllSky image path
ALLSKY_IMAGE_PATH=/home/pi/allsky/tmp/image.jpg
```

### Test the Collector

```bash
python3 collector.py
```

You should see:
```
Observatory Data Collector Starting
MQTT client started, connecting to localhost
Starting thread: cloudwatcher
Starting thread: sqm
Starting thread: pusher
Data pushed successfully at 2024-01-15 10:30:00
```

### Install as a System Service

```bash
# Copy service file
sudo cp observatory-collector.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable observatory-collector
sudo systemctl start observatory-collector

# Check status
sudo systemctl status observatory-collector

# View logs
journalctl -u observatory-collector -f
```

---

## 🎨 Step 8: Customize Your Dashboard

### Update Site Configuration

Edit `src/lib/config.ts`:

```typescript
export const siteConfig = {
  siteName: "My Observatory",           // Your observatory name
  siteSubtitle: "Site Meteo & Telemetry",
  latitude: -31.29,                      // Your latitude
  longitude: 149.09,                     // Your longitude
  bomSatelliteUrl: "http://www.bom.gov.au/gms/IDE00005.gif",
  weatherLinkId: "your-weatherlink-id",  // Or null for local data
  refreshInterval: 30000,                // 30 seconds
};
```

### Find Your BOM Satellite Image

1. Go to [BOM Satellite Images](http://www.bom.gov.au/australia/satellite/)
2. Select your region
3. Right-click the image → "Copy Image Address"
4. Paste into `bomSatelliteUrl`

### Find Your WeatherLink Embed ID

1. Go to [weatherlink.com](https://www.weatherlink.com/)
2. Find your station
3. Click "Share" → "Embed"
4. Copy the ID from the URL

---

## 📁 Project Structure

```
observatory-dashboard/
├── .vscode/                 # VS Code settings
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── current/     # GET current conditions
│   │   │   ├── ingest/      # POST data from Pi
│   │   │   │   ├── data/    # Weather data
│   │   │   │   └── image/   # AllSky images
│   │   │   └── allsky/      # Serve AllSky images
│   │   ├── layout.tsx       # Root layout
│   │   ├── page.tsx         # Main dashboard
│   │   └── globals.css      # Global styles
│   ├── components/          # React components
│   ├── lib/
│   │   ├── config.ts        # Site configuration
│   │   ├── supabase.ts      # Supabase client
│   │   └── weatherHelpers.ts
│   └── types/               # TypeScript types
├── raspberry-pi/            # Pi collector scripts
├── supabase/
│   └── schema.sql           # Database schema
├── .env.local.example       # Environment template
└── package.json
```

---

## 🔧 Troubleshooting

### Dashboard shows "Loading..." forever

- Check browser console for errors (F12)
- Verify `.env.local` has correct Supabase keys
- Make sure you ran the SQL schema in Supabase

### Data not updating from Pi

```bash
# Check collector logs
journalctl -u observatory-collector -f

# Test API manually
curl -X POST https://your-site.vercel.app/api/ingest/data \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 20}'
```

### Serial port permission denied

```bash
# Add user to dialout group
sudo usermod -a -G dialout pi

# Log out and back in, or reboot
```

### Can't find serial ports

```bash
# List USB devices
ls /dev/ttyUSB*
ls /dev/serial/by-id/

# Check dmesg for connection info
dmesg | grep tty
```

---

## 💰 Cost Breakdown

| Service | Free Tier | If Exceeded |
|---------|-----------|-------------|
| Vercel | 100GB bandwidth | $20/mo |
| Supabase | 500MB DB, 1GB storage | $25/mo |
| Domain | N/A | ~$10-15/yr |
| **Total** | **~$10-15/year** | |

---

## 🤝 Contributing

Pull requests welcome! Please open an issue first to discuss changes.

---

## 📄 License

MIT License - feel free to use for your own observatory!

---

## 🙏 Credits

Inspired by [Springbrook Remote Observatory Facility](https://springbrookremoteobservatoryfacility.com.au)
