/**
 * LokIT — PSC Nepal IT Vacancy Scraper
 * Runs daily via GitHub Actions.
 * Scrapes psconline1.psc.gov.np + psc.gov.np, filters IT posts,
 * writes public/vacancies.json, sends email if new ones found.
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const nodemailer = require('nodemailer');

const IS_DRY    = process.argv.includes('--dry-run');
const OUT_PATH  = path.resolve(__dirname, '../public/vacancies.json');

// ─── IT keyword filter ────────────────────────────────────────────────────────
const IT_KEYWORDS = [
  'information technology', 'सूचना प्रविधि',
  'computer', 'कम्प्युटर',
  'software', 'सफ्टवेयर',
  'network', 'नेटवर्क',
  'database', 'डेटाबेस',
  'cyber', 'साइबर',
  'web developer', 'वेब',
  'mis officer', 'mis',
  'system', 'प्रणाली',
  'electronics', 'इलेक्ट्रोनिक्स',
  'ict', 'आईसीटी',
  'it officer', 'it assistant',
  'programmer', 'प्रोग्रामर',
  'hardware', 'हार्डवेयर',
  'infrastructure engineer',
  'data', 'डाटा',
];

function isIT(text) {
  const t = (text || '').toLowerCase();
  return IT_KEYWORDS.some(k => t.includes(k));
}

// ─── Load existing vacancies ──────────────────────────────────────────────────
function loadExisting() {
  try {
    const raw = fs.readFileSync(OUT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { vacancies: [], lastUpdated: null };
  }
}

// ─── Save vacancies ───────────────────────────────────────────────────────────
function saveVacancies(data) {
  if (IS_DRY) { console.log('[DRY RUN] Would save:', JSON.stringify(data, null, 2).slice(0, 500)); return; }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
  console.log(`✅ Saved ${data.vacancies.length} IT vacancies to ${OUT_PATH}`);
}

// ─── Browser launch helper ────────────────────────────────────────────────────
async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
    ],
  });
}

// ─── SCRAPER 1: psconline1.psc.gov.np (React SPA — intercept API calls) ───────
async function scrapeOnlinePortal(browser) {
  console.log('🔍 Scraping psconline1.psc.gov.np …');
  const page = await browser.newPage();
  const captured = [];

  // Intercept all XHR / fetch responses to find the vacancy API
  page.on('response', async (res) => {
    const url = res.url();
    const ct  = res.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    // Look for responses that likely contain vacancy/advertisement data
    if (
      url.includes('advertisement') ||
      url.includes('vacancy') ||
      url.includes('notice') ||
      url.includes('post') ||
      url.includes('job')
    ) {
      try {
        const json = await res.json();
        captured.push({ url, json });
        console.log(`  → Captured API: ${url}`);
      } catch { /* ignore non-JSON */ }
    }
  });

  try {
    await page.goto('https://psconline1.psc.gov.np/#/', {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    // Wait a moment for lazy-loaded data
    await page.waitForTimeout(3000);

    // Try clicking on "Advertisements" / "Vacancies" links if present
    const clicked = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a, button, li')];
      const target = links.find(el => {
        const t = el.textContent.toLowerCase();
        return t.includes('advertisement') || t.includes('vacancy') || t.includes('notice');
      });
      if (target) { target.click(); return true; }
      return false;
    });

    if (clicked) {
      await page.waitForTimeout(4000);
    }
  } catch (err) {
    console.warn('  ⚠ Portal navigation error:', err.message);
  }

  await page.close();

  // Parse captured API responses
  const vacancies = [];
  for (const { url, json } of captured) {
    const items = extractItemsFromJson(json);
    for (const item of items) {
      if (isIT(item.title) || isIT(item.description)) {
        vacancies.push(normalizeVacancy(item, 'psconline1'));
      }
    }
  }

  console.log(`  → Found ${vacancies.length} IT vacancies from online portal`);
  return vacancies;
}

// Recursively extract array items that look like vacancies
function extractItemsFromJson(obj, depth = 0) {
  if (depth > 5) return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object') return obj;
    return obj.flatMap(i => extractItemsFromJson(i, depth + 1));
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.values(obj).flatMap(v => extractItemsFromJson(v, depth + 1));
  }
  return [];
}

// ─── SCRAPER 2: psc.gov.np (static/server-rendered notices) ──────────────────
async function scrapeMainSite(browser) {
  console.log('🔍 Scraping psc.gov.np …');
  const pages = [
    'https://psc.gov.np/category/notice-advertisement.html',
    'https://psc.gov.np/category/recruitment-notices.html',
    'https://psc.gov.np/category/sangathit-vacancies.html',
    'https://psc.gov.np/',
  ];

  const allVacancies = [];
  const page = await browser.newPage();

  for (const url of pages) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const items = await page.evaluate(() => {
        const results = [];
        // Common patterns for govt site listings
        const selectors = [
          'article', '.post', '.entry', '.notice-item', '.vacancy-item',
          'li.post', '.list-item', 'tr', '.news-item',
          '[class*="vacancy"]', '[class*="notice"]', '[class*="post"]',
        ];

        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length < 2) continue;
          for (const el of els) {
            const text = el.textContent.trim();
            if (text.length < 10) continue;
            const link = el.querySelector('a');
            results.push({
              title: (el.querySelector('h1,h2,h3,h4,a') || el).textContent.trim().slice(0, 200),
              description: text.slice(0, 300),
              link: link ? link.href : '',
              dateText: (el.querySelector('time,.date,.published,.meta') || {}).textContent || '',
            });
          }
          if (results.length > 0) break;
        }

        // Fallback: grab all links that look like vacancy notices
        if (results.length === 0) {
          document.querySelectorAll('a').forEach(a => {
            const t = a.textContent.trim();
            if (t.length > 15 && t.length < 300) {
              results.push({ title: t, description: t, link: a.href, dateText: '' });
            }
          });
        }

        return results;
      });

      for (const item of items) {
        if (isIT(item.title) || isIT(item.description)) {
          allVacancies.push(normalizeVacancy(item, 'psc.gov.np'));
        }
      }

      console.log(`  → ${url}: found ${items.filter(i => isIT(i.title) || isIT(i.description)).length} IT notices`);
    } catch (err) {
      console.warn(`  ⚠ Failed to scrape ${url}:`, err.message);
    }
  }

  await page.close();
  return allVacancies;
}

// ─── SCRAPER 3: Bagmati Province PSC (Hetauda-specific) ──────────────────────
async function scrapeProvincePSC(browser) {
  console.log('🔍 Scraping Bagmati Province PSC (spsc.bagamati.gov.np) …');
  const page = await browser.newPage();
  const vacancies = [];

  try {
    await page.goto('https://spsc.bagamati.gov.np/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const items = await page.evaluate(() => {
      const results = [];
      const selectors = ['article', '.post', 'li', 'tr', '.notice', '.vacancy', '[class*="job"]'];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length < 2) continue;
        for (const el of els) {
          const link = el.querySelector('a');
          const text = el.textContent.trim();
          if (text.length < 10) continue;
          results.push({
            title: (el.querySelector('h1,h2,h3,h4,a') || el).textContent.trim().slice(0, 200),
            description: text.slice(0, 300),
            link: link ? link.href : '',
            dateText: (el.querySelector('time,.date,.published') || {}).textContent || '',
            district: 'Hetauda / Bagmati Province',
          });
        }
        if (results.length > 0) break;
      }
      return results;
    });

    for (const item of items) {
      if (isIT(item.title) || isIT(item.description)) {
        vacancies.push(normalizeVacancy({ ...item, district: 'Hetauda / Bagmati Province' }, 'spsc.bagamati.gov.np'));
      }
    }
    console.log(`  → Found ${vacancies.length} IT vacancies from Bagmati Province PSC`);
  } catch (err) {
    console.warn('  ⚠ Bagmati PSC error:', err.message);
  }

  await page.close();
  return vacancies;
}

// ─── Normalise a raw scraped item → standard vacancy shape ───────────────────
let idCounter = 1;
function normalizeVacancy(raw, source) {
  return {
    id: `${source}-${Date.now()}-${idCounter++}`,
    source,
    title:       cleanText(raw.title || raw.post_name || raw.jobTitle || raw.name || 'Untitled'),
    org:         cleanText(raw.organization || raw.office || raw.department || raw.org || ''),
    district:    cleanText(raw.district || raw.location || raw.district_name || ''),
    posts:       parseInt(raw.posts || raw.vacancy || raw.noOfPost || raw.vacancies || 1, 10) || 1,
    deadline:    parseDeadline(raw.deadline || raw.lastDate || raw.closingDate || raw.dateText || ''),
    link:        raw.link || raw.applyUrl || raw.url || 'https://psconline1.psc.gov.np/#/login',
    applyUrl:    'https://psconline1.psc.gov.np/#/login',
    advNo:       raw.advNo || raw.advertisementNo || raw.noticeNo || '',
    level:       guessLevel(raw.title || ''),
    isNew:       true,
    scrapedAt:   new Date().toISOString(),
    rawTitle:    raw.title || '',
  };
}

function cleanText(t) {
  return (t || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function parseDeadline(raw) {
  if (!raw) return '';
  // Try to find a date in format YYYY-MM-DD or DD/MM/YYYY
  const iso = String(raw).match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const nep = String(raw).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (nep) {
    const [, d, m, y] = nep;
    const year = y.length === 2 ? '20' + y : y;
    return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return String(raw).slice(0, 30);
}

function guessLevel(title) {
  const t = title.toLowerCase();
  if (t.includes('senior') || t.includes('chief') || t.includes('director')) return 'Senior Officer';
  if (t.includes('officer')) return 'Officer';
  if (t.includes('assistant') || t.includes('operator')) return 'Assistant';
  if (t.includes('engineer')) return 'Engineer';
  return 'Technical';
}

// ─── Dedup by title+district ──────────────────────────────────────────────────
function deduplicate(vacancies) {
  const seen = new Set();
  return vacancies.filter(v => {
    const key = `${v.title.slice(0,50).toLowerCase()}|${v.district.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Find new vacancies vs stored ────────────────────────────────────────────
function findNew(freshList, storedList) {
  const storedKeys = new Set(storedList.map(v =>
    `${v.title.slice(0,50).toLowerCase()}|${v.district.toLowerCase()}`
  ));
  return freshList.filter(v =>
    !storedKeys.has(`${v.title.slice(0,50).toLowerCase()}|${v.district.toLowerCase()}`)
  );
}

// ─── Email notification ───────────────────────────────────────────────────────
async function sendEmail(newVacancies) {
  const { GMAIL_USER, GMAIL_PASS, NOTIFY_EMAIL } = process.env;
  if (!GMAIL_USER || !GMAIL_PASS || !NOTIFY_EMAIL) {
    console.log('ℹ Email not configured — skipping notification. (Set GMAIL_USER, GMAIL_PASS, NOTIFY_EMAIL secrets)');
    return;
  }

  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const listHtml = newVacancies.map(v => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #eee;">
        <strong style="color:#0d47a1">${v.title}</strong><br>
        <span style="color:#555">${v.org || 'PSC Nepal'}</span><br>
        📍 ${v.district || 'Nepal'} &nbsp;|&nbsp; 📅 Deadline: ${v.deadline || 'TBD'} &nbsp;|&nbsp; Posts: ${v.posts}
      </td>
      <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:middle;">
        <a href="${v.applyUrl}" style="background:#00e5ff;color:#000;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:bold;">Apply →</a>
      </td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
      <div style="background:#060b14;color:#00e5ff;padding:20px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:22px;">🖥 LokIT — New IT Vacancies Found!</h1>
        <p style="margin:5px 0 0;color:#aaa;font-size:14px;">${new Date().toDateString()} | PSC Nepal</p>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #eee;">
        <p style="color:#333;font-size:15px;margin-top:0;">
          <strong>${newVacancies.length}</strong> new IT-related Loksewa vacancies were published on PSC Nepal since your last check.
        </p>
        <table width="100%" style="border-collapse:collapse;">
          ${listHtml}
        </table>
        <p style="margin-top:20px;font-size:13px;color:#888;">
          ⚠ Always verify eligibility and details on the official <a href="https://psc.gov.np">psc.gov.np</a> notice.
          Apply at <a href="https://psconline1.psc.gov.np/#/login">psconline1.psc.gov.np</a>.
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"LokIT Alerts" <${GMAIL_USER}>`,
    to:   NOTIFY_EMAIL,
    subject: `🔔 LokIT: ${newVacancies.length} New IT Loksewa Vacancies (${new Date().toDateString()})`,
    html,
  });

  console.log(`📧 Email sent to ${NOTIFY_EMAIL}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 LokIT Scraper — ${new Date().toISOString()}\n`);

  const existing = loadExisting();
  console.log(`📂 Existing vacancies: ${existing.vacancies?.length || 0}`);

  const browser = await launchBrowser();
  let allFresh = [];

  try {
    const [portal, main, province] = await Promise.all([
      scrapeOnlinePortal(browser).catch(e => { console.warn('Portal failed:', e.message); return []; }),
      scrapeMainSite(browser).catch(e => { console.warn('Main site failed:', e.message); return []; }),
      scrapeProvincePSC(browser).catch(e => { console.warn('Province PSC failed:', e.message); return []; }),
    ]);
    allFresh = [...portal, ...main, ...province];
  } finally {
    await browser.close();
  }

  const deduped = deduplicate(allFresh);
  const newOnes = findNew(deduped, existing.vacancies || []);

  console.log(`\n📊 Results:`);
  console.log(`   Fresh scraped : ${allFresh.length}`);
  console.log(`   After dedup   : ${deduped.length}`);
  console.log(`   New this run  : ${newOnes.length}`);

  // Mark which ones are new
  const merged = deduped.map(v => ({
    ...v,
    isNew: newOnes.some(n => n.id === v.id),
  }));

  // Keep old ones that weren't found this run (might be due to scrape failure)
  // but mark them as not-new
  const oldKept = (existing.vacancies || [])
    .filter(old => !merged.some(m =>
      m.title.slice(0,50).toLowerCase() === old.title.slice(0,50).toLowerCase() &&
      m.district.toLowerCase() === old.district.toLowerCase()
    ))
    .map(v => ({ ...v, isNew: false }));

  const finalList = [...merged, ...oldKept];

  const output = {
    vacancies:   finalList,
    lastUpdated: new Date().toISOString(),
    totalIT:     finalList.length,
    newCount:    newOnes.length,
    sources:     ['psc.gov.np', 'psconline1.psc.gov.np', 'spsc.bagamati.gov.np'],
  };

  saveVacancies(output);

  if (newOnes.length > 0) {
    console.log(`\n🆕 New IT vacancies:`);
    newOnes.forEach(v => console.log(`   • ${v.title} — ${v.district}`));

    if (!IS_DRY) {
      await sendEmail(newOnes).catch(e => console.warn('Email failed:', e.message));
    }
  } else {
    console.log('\n✓ No new IT vacancies since last run.');
  }

  console.log('\n✅ Done.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
