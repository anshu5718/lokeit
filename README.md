# 🖥 LokIT — Live Loksewa IT Vacancies Nepal

**Real IT vacancies from PSC Nepal, scraped daily, with eligibility checking.**

Vacancies are scraped from:
- [psc.gov.np](https://psc.gov.np) — Central PSC
- [psconline1.psc.gov.np](https://psconline1.psc.gov.np) — Online application portal
- [spsc.bagamati.gov.np](https://spsc.bagamati.gov.np) — Bagmati Province PSC (Hetauda)

---

## 🚀 How to Deploy (Step by Step)

### Step 1 — Create a GitHub Repository

1. Go to [github.com](https://github.com) → Sign in → **New repository**
2. Name it `lokit` (or anything you want)
3. Set it to **Public** (or Private — both work)
4. Click **Create repository**

### Step 2 — Upload this project

Option A — GitHub web UI (easy):
1. Drag and drop all files into the repo via the web interface

Option B — Git command line:
```bash
cd lokit-project
git init
git add .
git commit -m "Initial LokIT setup"
git remote add origin https://github.com/YOUR_USERNAME/lokit.git
git push -u origin main
```

---

### Step 3 — Set up Email Notifications (Optional but recommended)

You need a Gmail account with an **App Password**:

1. Go to your Google Account → **Security** → Turn on **2-Step Verification**
2. Then go to **Security** → **App passwords**
3. Create a new App password (select "Mail" + "Other")
4. Copy the 16-character password

Now add secrets to GitHub:
1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** for each:

| Secret Name   | Value                                  |
|---------------|----------------------------------------|
| `GMAIL_USER`  | your Gmail address (e.g. `you@gmail.com`) |
| `GMAIL_PASS`  | the App Password (16 chars, no spaces) |
| `NOTIFY_EMAIL`| email where you want alerts sent      |

---

### Step 4 — Host on Netlify (Free)

1. Go to [netlify.com](https://netlify.com) → Sign up / Sign in
2. Click **Add new site** → **Import an existing project**
3. Choose **GitHub** → Authorize → Select your `lokit` repo
4. Netlify auto-detects the `netlify.toml` config
5. Click **Deploy site**
6. Your site is live! Netlify gives you a URL like `https://random-name.netlify.app`
7. Optionally set a custom domain in Netlify settings

**Auto-deploy:** Every time GitHub Actions scrapes new vacancies and commits
`public/vacancies.json`, Netlify automatically redeploys the site. ✅

---

### Step 5 — (Optional) Netlify Build Hook

If Netlify doesn't auto-deploy on push, create a Build Hook:

1. Netlify → Site settings → **Build & deploy** → **Build hooks**
2. Click **Add build hook** → Name it "GitHub Actions"
3. Copy the webhook URL
4. Add it as a GitHub secret named `NETLIFY_BUILD_HOOK`

---

### Step 6 — Run the scraper manually (first time)

1. Go to your GitHub repo → **Actions** tab
2. Click **Daily LokIT PSC Vacancy Scraper**
3. Click **Run workflow** → **Run workflow**
4. Wait ~5 minutes for it to complete
5. Check `public/vacancies.json` in your repo — it should now have real data!

---

## 🔧 How it works

```
Every day at 6:30 AM Nepal time:
  GitHub Actions runs scraper/scrape.js
    → Opens PSC Nepal websites with headless Chrome (Puppeteer)
    → Intercepts API calls and parses rendered HTML
    → Filters for IT-related vacancies
    → Compares with previous vacancies.json
    → If new IT vacancies found → sends email
    → Commits updated vacancies.json to GitHub
  Netlify detects the commit → auto-deploys
  Website visitors see live data
```

---

## 📁 Project Structure

```
lokit/
├── public/
│   ├── index.html        ← The website (fetches vacancies.json)
│   └── vacancies.json    ← Updated daily by scraper
├── scraper/
│   ├── scrape.js         ← Puppeteer scraper (runs in GitHub Actions)
│   └── package.json      ← Node.js dependencies
├── .github/
│   └── workflows/
│       └── daily-scrape.yml  ← Runs the scraper every day
├── netlify.toml          ← Netlify hosting config
└── README.md             ← This file
```

---

## ⚙️ Customising the IT keyword filter

In `scraper/scrape.js`, find the `IT_KEYWORDS` array and add/remove keywords:

```js
const IT_KEYWORDS = [
  'information technology',
  'computer',
  'software',
  // add more here...
];
```

---

## 🔔 Notification notes

- Email is sent via **Gmail SMTP** using **nodemailer**
- The email lists all new IT vacancies with a direct Apply link
- Only sent when **new** vacancies appear (not on every run)

---

## ⚠️ Important

- PSC Nepal websites change frequently — if the scraper stops finding vacancies,
  check the GitHub Actions logs for errors and update `scrape.js` selectors
- Eligibility checking is **indicative only** — always verify on the official PSC notice
- This site does not store any personal data on a server — your profile stays in your browser

---

## 🐛 Troubleshooting

**Vacancies.json is empty after running scraper:**
PSC websites may have changed their structure. Check GitHub Actions logs.
The scraper may need the CSS selectors updated in `scrape.js`.

**Email not sending:**
- Check Gmail App Password is correct (no spaces)
- Make sure 2FA is enabled on Gmail
- Check GitHub Actions logs for nodemailer errors

**Netlify not updating:**
- Check the GitHub Actions workflow completed successfully
- Add the `NETLIFY_BUILD_HOOK` secret if auto-deploy isn't working
