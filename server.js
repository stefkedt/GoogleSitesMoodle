const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const archiver = require('archiver');
const { buildH5PFile } = require('./h5p-builder');
const { buildHtmlSite, listThemes } = require('./html-builder');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory job store
const jobs = {};

// Download an image URL to imagesDir, return the local relative path (or original URL on failure)
function downloadImage(imgUrl, imagesDir) {
  return new Promise((resolve) => {
    try {
      const ext = (imgUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)/i) || ['', '.jpg'])[0] || '.jpg';
      const hash = crypto.createHash('md5').update(imgUrl).digest('hex').slice(0, 12);
      const filename = hash + ext;
      const dest = path.join(imagesDir, filename);

      if (fs.existsSync(dest)) { resolve('images/' + filename); return; }

      const client = imgUrl.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      const req = client.get(imgUrl, { timeout: 15000 }, (res) => {
        if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); resolve(imgUrl); return; }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve('images/' + filename); });
      });
      req.on('error', () => { file.close(); try { fs.unlinkSync(dest); } catch {} resolve(imgUrl); });
      req.on('timeout', () => { req.destroy(); resolve(imgUrl); });
    } catch { resolve(imgUrl); }
  });
}

function normalise(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    u.pathname = u.pathname.replace(/\/$/, '') || '/';
    return u.toString();
  } catch { return url; }
}

function isSameSite(url, baseUrl) {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    const sitePrefix = b.pathname.split('/').slice(0, 3).join('/');
    return u.origin === b.origin && u.pathname.startsWith(sitePrefix);
  } catch { return false; }
}

async function extractPageContent(page, url, imagesDir) {
  const h1s = await page.locator('h1').allTextContents().catch(() => []);
  const title = (h1s[0] || '').replace(/\s+/g, ' ').trim();
  const blocks = [];

  // Stap 1: tekst-elementen via gecombineerde locator (pierces shadow DOM)
  const elements = await page.locator('h1, h2, h3, h4, h5, h6, p, li, img').evaluateAll(els => {
    return els
      .filter(el => {
        if (el.closest('nav, header, [role="navigation"], [role="banner"]')) return false;
        const tag = el.tagName.toLowerCase();
        if ((tag === 'p' || /^h[1-6]$/.test(tag)) && el.closest('li')) return false;
        return true;
      })
      .map(el => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'img') return { type: 'image', src: el.src || '', alt: el.alt || '' };
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        if (/^h[1-6]$/.test(tag)) return { type: 'heading', level: parseInt(tag[1]), text };
        if (tag === 'p') return { type: 'paragraph', text };
        if (tag === 'li') return { type: 'list-item', text };
        return null;
      })
      .filter(Boolean);
  });

  // Stap 2: aparte volledige beeldextractie als fallback voor lazy-loaded images
  const allImgSrcs = await page.locator('img').evaluateAll(els =>
    els
      .filter(el => el.src && !el.src.startsWith('data:') && el.naturalWidth > 0
                 && !el.closest('nav, header, [role="navigation"], [role="banner"]'))
      .map(el => ({ src: el.src, alt: el.alt || '' }))
  );
  // Bouw set van al gevonden srcs in stap 1
  const foundSrcs = new Set(elements.filter(e => e.type === 'image').map(e => e.src));

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.type === 'list-item') {
      const items = [el.text];
      while (i + 1 < elements.length && elements[i + 1].type === 'list-item') {
        i++;
        items.push(elements[i].text);
      }
      blocks.push({ type: 'list', items });
    } else if (el.type === 'image') {
      if (el.src && !el.src.startsWith('data:')) {
        const localSrc = imagesDir ? await downloadImage(el.src, imagesDir) : el.src;
        blocks.push({ ...el, src: localSrc, originalSrc: el.src });
      }
    } else {
      blocks.push(el);
    }
  }

  // Voeg ontbrekende afbeeldingen toe (gevonden via fallback maar niet via combined locator)
  for (const img of allImgSrcs) {
    if (!foundSrcs.has(img.src)) {
      const localSrc = imagesDir ? await downloadImage(img.src, imagesDir) : img.src;
      blocks.push({ type: 'image', src: localSrc, originalSrc: img.src, alt: img.alt });
    }
  }

  return {
    title,
    url,
    blocks: blocks.filter((b, i) => {
      if (i === 0) return true;
      const prev = blocks[i - 1];
      if (b.type === 'image') return b.src !== prev.src; // afbeeldingen: vergelijk op src
      return !(b.type === prev.type && b.text === prev.text);
    })
  };
}

async function runCrawl(jobId, startUrl) {
  const job = jobs[jobId];
  job.status = 'running';
  job.log = [];
  job.pages = [];

  const log = (msg) => { job.log.push(msg); };

  try {
    // Create a per-job images folder inside public/exports/
    const exportBase = path.join(__dirname, 'public', 'exports', jobId);
    const imagesDir = path.join(exportBase, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
    });

    const visited = new Set();
    const queue = [normalise(startUrl)];

    while (queue.length > 0) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      log(`Bezoek pagina ${job.pages.length + 1}: ${url}`);
      try {
        // Nieuwe context per URL
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          // Zeer groot viewport: alle elementen zijn direct "in view" voor IntersectionObserver
          viewport: { width: 1280, height: 8000 }
        });
        const page = await context.newPage();

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        // Extra wacht: IntersectionObserver callbacks afhandelen + images laden
        await page.waitForTimeout(2000);
        // Scroll alsnog om eventuele resterende lazy content te triggeren
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const content = await extractPageContent(page, url, imagesDir);
        const imgCount = content.blocks.filter(b => b.type === 'image').length;
        job.pages.push(content);
        log(`✓ "${content.title}" — ${content.blocks.length} blokken, ${imgCount} afb. opgeslagen`);

        const hrefs = await page.locator('a[href]').evaluateAll(anchors =>
          anchors.map(a => a.href).filter(h => h && h.startsWith('http') && !h.includes('#'))
        );
        const newLinks = [...new Set(hrefs.filter(l => isSameSite(l, startUrl)).map(normalise))];
        for (const link of newLinks) {
          if (!visited.has(link) && !queue.includes(link)) queue.push(link);
        }
        await context.close(); // sluit context zodat Service Worker cache niet overgedragen wordt
      } catch (err) {
        log(`✗ Overgeslagen: ${err.message.slice(0, 80)}`);
        job.pages.push({ url, title: '', blocks: [], error: err.message });
      }
    }

    await browser.close();

    // Build tree
    const base = new URL(startUrl);
    const sitePrefix = base.pathname.replace(/\/$/, '');
    const sorted = [...job.pages].sort((a, b) => {
      const da = a.url.split('/').length, db = b.url.split('/').length;
      return da !== db ? da - db : a.url.localeCompare(b.url);
    });
    const root = { url: normalise(startUrl), children: [] };
    const byUrl = { [normalise(startUrl)]: root };
    for (const p of sorted) {
      const norm = normalise(p.url);
      if (norm === normalise(startUrl)) { Object.assign(root, p); continue; }
      const parts = new URL(norm).pathname.replace(sitePrefix, '').split('/').filter(Boolean);
      let parent = root;
      for (let i = parts.length - 1; i >= 0; i--) {
        const parentUrl = normalise(base.origin + sitePrefix + '/' + parts.slice(0, i).join('/'));
        if (byUrl[parentUrl]) { parent = byUrl[parentUrl]; break; }
      }
      const node = { ...p, children: [] };
      byUrl[norm] = node;
      if (!parent.children) parent.children = [];
      parent.children.push(node);
    }

    const imgTotal = job.pages.reduce((n, p) => n + p.blocks.filter(b => b.type === 'image').length, 0);
    job.result = { crawledAt: new Date().toISOString(), startUrl, totalPages: job.pages.length, totalImages: imgTotal, site: root };
    job.status = 'done';
    log(`\nKlaar! ${job.pages.length} pagina's, ${imgTotal} afbeeldingen opgeslagen.`);

    // Save JSON next to the images folder
    const filename = `${jobId}/site.json`;
    fs.writeFileSync(path.join(__dirname, 'public', 'exports', filename), JSON.stringify(job.result, null, 2));
    job.filename = filename;
    job.exportDir = jobId;

  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    log(`Fout: ${err.message}`);
  }
}

// API routes
app.post('/api/crawl', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('https://sites.google.com/')) {
    return res.status(400).json({ error: 'Geef een geldig Google Sites URL op (https://sites.google.com/...)' });
  }
  const jobId = Date.now().toString();
  jobs[jobId] = { id: jobId, status: 'starting', log: [], pages: [], startUrl: url };
  runCrawl(jobId, url);
  res.json({ jobId });
});

app.get('/api/job/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job niet gevonden' });
  res.json({
    id: job.id,
    status: job.status,
    log: job.log,
    totalPages: job.pages.length,
    filename: job.filename,
    error: job.error,
    result: job.status === 'done' ? job.result : null
  });
});

app.get('/api/download/:jobId', (req, res) => {
  const exportDir = path.join(__dirname, 'public', 'exports', req.params.jobId);
  if (!fs.existsSync(exportDir)) return res.status(404).send('Niet gevonden');

  const siteName = req.query.name || 'site';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${siteName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => res.status(500).send(err.message));
  archive.pipe(res);
  archive.directory(exportDir, false); // flatten: images/ + site.json at root of zip
  archive.finalize();
});

// Reload an existing export from disk into memory (survives server restarts)
app.post('/api/load/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const jsonPath = path.join(__dirname, 'public', 'exports', jobId, 'site.json');
  if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'Export niet gevonden' });
  try {
    const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    jobs[jobId] = { id: jobId, status: 'done', log: [], pages: [], result, filename: `${jobId}/site.json`, exportDir: jobId };
    res.json({ ok: true, title: result.site.title, totalPages: result.totalPages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Convert crawled site to H5P Interactive Book
app.post('/api/convert/:jobId', async (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== 'done') return res.status(400).json({ error: 'Job niet klaar' });

  const exportDir = path.join(__dirname, 'public', 'exports', req.params.jobId);
  const imagesDir = path.join(exportDir, 'images');
  const h5pPath   = path.join(exportDir, 'interactive-book.h5p');

  try {
    await buildH5PFile(job.result, imagesDir, h5pPath);
    res.json({ h5pFile: `${req.params.jobId}/interactive-book.h5p` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/h5p/:jobId', (req, res) => {
  const h5pPath = path.join(__dirname, 'public', 'exports', req.params.jobId, 'interactive-book.h5p');
  if (!fs.existsSync(h5pPath)) return res.status(404).send('Niet gevonden');
  const job = jobs[req.params.jobId];
  const name = ((job && job.result && job.result.site && job.result.site.title) || 'interactive-book')
    .replace(/[^a-z0-9]/gi, '-').toLowerCase();
  res.download(h5pPath, `${name}.h5p`);
});

// List of available HTML themes
app.get('/api/html-themes', (req, res) => {
  res.json({ themes: listThemes() });
});

// Convert crawled site to a static HTML5 website
app.post('/api/convert-html/:jobId', async (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== 'done') return res.status(400).json({ error: 'Job niet klaar' });

  const style = (req.body && req.body.style) || 'cvo';
  const exportDir = path.join(__dirname, 'public', 'exports', req.params.jobId);
  const imagesDir = path.join(exportDir, 'images');
  const zipPath   = path.join(exportDir, 'html-site.zip');

  try {
    await buildHtmlSite(job.result, imagesDir, zipPath, style);
    res.json({ htmlFile: `${req.params.jobId}/html-site.zip` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/html/:jobId', (req, res) => {
  const zipPath = path.join(__dirname, 'public', 'exports', req.params.jobId, 'html-site.zip');
  if (!fs.existsSync(zipPath)) return res.status(404).send('Niet gevonden');
  const job = jobs[req.params.jobId];
  const name = ((job && job.result && job.result.site && job.result.site.title) || 'html-site')
    .replace(/[^a-z0-9]/gi, '-').toLowerCase();
  res.download(zipPath, `${name}-website.zip`);
});

// Ensure exports dir exists
fs.mkdirSync(path.join(__dirname, 'public', 'exports'), { recursive: true });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server actief op http://localhost:${PORT}`));
