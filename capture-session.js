// Lokaal hulpscript: legt je ingelogde Google-sessie vast in google-session.json
// Gebruik:  node capture-session.js
// Er opent een Chrome-venster op de Google-inlogpagina. Log in (incl. 2FA).
// Zodra je ingelogd bent, slaat het script je sessie automatisch op en sluit het venster.

const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, 'google-session.json');
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minuten om in te loggen

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gebruik bij voorkeur de op het systeem geïnstalleerde Chrome/Edge,
// en val anders terug op de door Playwright gedownloade browser.
async function launchBrowser() {
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ headless: false, channel }); }
    catch (e) { /* kanaal niet beschikbaar, probeer volgende */ }
  }
  return await chromium.launch({ headless: false });
}

(async () => {
  console.log('\n=== Google-sessie vastleggen ===\n');
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });

  console.log('Een Chrome-venster is geopend. Log in met je Google-account (ook 2FA).');
  console.log('Zodra je ingelogd bent, wordt je sessie automatisch opgeslagen…\n');

  const start = Date.now();
  let loggedIn = false;
  while (Date.now() - start < TIMEOUT_MS) {
    const cookies = await context.cookies();
    // Na een geslaagde login zet Google een 'SID'-cookie op .google.com
    const sid = cookies.find(c => c.name === 'SID' && /google\.com$/.test(c.domain) && c.value);
    if (sid) { loggedIn = true; break; }
    await sleep(2000);
  }

  if (!loggedIn) {
    console.log('\n✗ Geen login gedetecteerd binnen de tijdslimiet. Probeer opnieuw.');
    await browser.close();
    process.exit(1);
  }

  // Bezoek sites.google.com zodat ook die cookies in de sessie zitten
  try {
    await page.goto('https://sites.google.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);
  } catch {}

  await context.storageState({ path: OUT });
  await browser.close();

  console.log(`\n✓ Sessie opgeslagen in:\n  ${OUT}`);
  console.log('\nUpload dit bestand in de webapp bij "Private site? Upload Google-sessie".');
  console.log('Let op: dit bestand bevat je ingelogde sessie — deel het met niemand.\n');
  process.exit(0);
})();
