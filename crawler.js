// Google Sites Crawler — outputs full site structure as JSON
// Usage: node crawler.js <google-sites-url> [output.json]

const { chromium } = require('playwright');
const fs = require('fs');

const START_URL = process.argv[2] || 'https://sites.google.com/cvoantwerpen.org/gooddesign';
const OUTPUT_FILE = process.argv[3] || 'site-structure.json';

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

// Extract structured content using Playwright locators (auto-pierces shadow DOM)
async function extractPageContent(page, url) {
  // Page title from h1 (first heading on page)
  const h1s = await page.locator('h1').allTextContents().catch(() => []);
  const title = (h1s[0] || '').replace(/\s+/g, ' ').trim();

  const blocks = [];

  // Collect all content elements in DOM order via a combined locator
  // We tag each element with its type by evaluating them together
  const elements = await page.locator('h1, h2, h3, h4, h5, h6, p, li, img').evaluateAll(els => {
    return els
      .filter(el => {
        // Skip elements inside nav/header
        if (el.closest('nav, header, [role="navigation"], [role="banner"]')) return false;
        // Skip <p> and <h*> that are nested inside <li> (avoids duplicates)
        const tag = el.tagName.toLowerCase();
        if ((tag === 'p' || /^h[1-6]$/.test(tag)) && el.closest('li')) return false;
        return true;
      })
      .map(el => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'img') {
          return { type: 'image', src: el.src || '', alt: el.alt || '' };
        }
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        if (/^h[1-6]$/.test(tag)) return { type: 'heading', level: parseInt(tag[1]), text };
        if (tag === 'p') return { type: 'paragraph', text };
        if (tag === 'li') return { type: 'list-item', text };
        return null;
      })
      .filter(Boolean);
  });

  // Group consecutive list items into lists
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
      if (el.src && !el.src.startsWith('data:')) blocks.push(el);
    } else {
      blocks.push(el);
    }
  }

  // Deduplicate consecutive identical blocks
  const deduped = blocks.filter((b, i) => {
    if (i === 0) return true;
    const prev = blocks[i - 1];
    return !(b.type === prev.type && b.text === prev.text);
  });

  return { title, url, blocks: deduped };
}

// Extract all internal navigation links using Playwright locator
async function extractNavLinks(page, baseUrl) {
  const hrefs = await page.locator('a[href]').evaluateAll(anchors =>
    anchors.map(a => a.href).filter(h => h && h.startsWith('http') && !h.includes('#'))
  );
  return [...new Set(hrefs.filter(l => isSameSite(l, baseUrl)).map(normalise))];
}

function buildTree(pages, baseUrl) {
  const base = new URL(baseUrl);
  const sitePrefix = base.pathname.replace(/\/$/, '');

  const sorted = [...pages].sort((a, b) => {
    const da = a.url.split('/').length;
    const db = b.url.split('/').length;
    return da !== db ? da - db : a.url.localeCompare(b.url);
  });

  const root = { url: normalise(baseUrl), children: [] };
  const byUrl = { [normalise(baseUrl)]: root };

  for (const page of sorted) {
    const norm = normalise(page.url);
    if (norm === normalise(baseUrl)) { Object.assign(root, page); continue; }

    const parts = new URL(norm).pathname.replace(sitePrefix, '').split('/').filter(Boolean);
    let parent = root;
    for (let i = parts.length - 1; i >= 0; i--) {
      const parentPath = sitePrefix + '/' + parts.slice(0, i).join('/');
      const parentUrl = normalise(base.origin + parentPath);
      if (byUrl[parentUrl]) { parent = byUrl[parentUrl]; break; }
    }

    const node = { ...page, children: [] };
    byUrl[norm] = node;
    if (!parent.children) parent.children = [];
    parent.children.push(node);
  }

  return root;
}

async function crawl() {
  console.log(`Crawling: ${START_URL}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });
  const page = await context.newPage();

  const visited = new Set();
  const queue = [normalise(START_URL)];
  const pages = [];

  while (queue.length > 0) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`  [${pages.length + 1}] ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const content = await extractPageContent(page, url);
      pages.push(content);
      console.log(`       → "${content.title}" (${content.blocks.length} blocks)`);

      const navLinks = await extractNavLinks(page, START_URL);
      for (const link of navLinks) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    } catch (err) {
      console.warn(`  SKIPPED: ${err.message}`);
      pages.push({ url, title: '', blocks: [], error: err.message });
    }
  }

  await browser.close();

  const tree = buildTree(pages, START_URL);
  const output = {
    crawledAt: new Date().toISOString(),
    startUrl: START_URL,
    totalPages: pages.length,
    site: tree
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nDone! ${pages.length} pages → ${OUTPUT_FILE}`);
}

crawl().catch(err => { console.error(err); process.exit(1); });
