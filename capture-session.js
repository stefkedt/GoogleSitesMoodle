// Lokaal hulpscript: legt je ingelogde Google-sessie vast in google-session.json
// Gebruik:  node capture-session.js
// 1) Er opent een Chrome-venster op de Google-inlogpagina.
// 2) Log in met je Google-account (inclusief 2FA als dat nodig is).
// 3) Ga eventueel naar je private Google Site om te bevestigen dat je toegang hebt.
// 4) Kom terug naar dit venster (de terminal) en druk op Enter.
// 5) Er wordt een bestand 'google-session.json' aangemaakt — upload dat in de webapp.

const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, 'google-session.json');

(async () => {
  console.log('\n=== Google-sessie vastleggen ===\n');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });

  console.log('Er is een Chrome-venster geopend.');
  console.log('  1. Log in met je Google-account (ook 2FA indien gevraagd).');
  console.log('  2. Open eventueel je private Google Site om te checken dat je toegang hebt.');
  console.log('  3. Kom hier terug en druk op ENTER om je sessie op te slaan.\n');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => resolve());
  });

  await context.storageState({ path: OUT });
  await browser.close();

  console.log(`\n✓ Sessie opgeslagen in:\n  ${OUT}`);
  console.log('\nUpload dit bestand in de webapp bij "Private site? Upload Google-sessie".');
  console.log('Let op: dit bestand bevat je ingelogde sessie — deel het met niemand.\n');
  process.exit(0);
})();
