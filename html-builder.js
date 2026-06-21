// Static HTML5 website builder
// Takes a crawled site JSON and produces a .zip with a multi-page HTML5 site + CSS

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'html-assets');

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Maak een veilige, unieke bestandsnaam (slug) per pagina
function slugify(text, fallback) {
  let s = (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accenten weg
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

// Bouw een platte lijst van pagina's uit de boomstructuur, met stabiele filenames
function flattenPages(root) {
  const pages = [];
  const usedNames = new Set();

  function assignName(node, isRoot) {
    if (isRoot) { node._file = 'index.html'; usedNames.add('index.html'); return; }
    const slug = slugify(node.title, slugify(node.url.split('/').pop(), 'pagina'));
    let name = slug + '.html';
    let i = 2;
    while (usedNames.has(name)) { name = slug + '-' + i + '.html'; i++; }
    usedNames.add(name);
    node._file = name;
  }

  function walk(node, depth, isRoot) {
    assignName(node, isRoot);
    pages.push({ node, depth });
    for (const child of (node.children || [])) {
      walk(child, depth + 1, false);
    }
  }

  walk(root, 0, true);
  return pages;
}

// Render één inhoudsblok naar HTML
function blockToHtml(block) {
  if (block.type === 'heading') {
    const lvl = Math.min(Math.max(block.level || 2, 2), 6); // h1 reserveren voor paginatitel
    return `<h${lvl}>${esc(block.text)}</h${lvl}>`;
  }
  if (block.type === 'paragraph') {
    return `<p>${esc(block.text)}</p>`;
  }
  if (block.type === 'list') {
    return '<ul>' + (block.items || []).map(i => `<li>${esc(i)}</li>`).join('') + '</ul>';
  }
  if (block.type === 'image') {
    const src = esc(block.src);
    const alt = esc(block.alt || '');
    return `<figure><img src="${src}" alt="${alt}" loading="lazy">${
      block.alt ? `<figcaption>${alt}</figcaption>` : ''
    }</figure>`;
  }
  return '';
}

// Bouw de navigatie-zijbalk (geneste lijst)
function buildNav(root, currentFile) {
  function renderNode(node, isRoot) {
    const active = node._file === currentFile ? ' class="active"' : '';
    const label = esc(node.title || node.url.split('/').pop() || 'Pagina');
    let html = `<li><a href="${node._file}"${active}>${label}</a>`;
    if (node.children && node.children.length) {
      html += '<ul>' + node.children.map(c => renderNode(c, false)).join('') + '</ul>';
    }
    html += '</li>';
    return html;
  }
  return '<ul class="nav-tree">' + renderNode(root, true) + '</ul>';
}

// Bouw de volledige HTML voor één pagina
function buildPageHtml(node, root, siteTitle) {
  const nav = buildNav(root, node._file);
  const blocksHtml = (node.blocks || []).map(blockToHtml).filter(Boolean).join('\n      ');
  const pageTitle = esc(node.title || siteTitle);

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} — ${esc(siteTitle)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header">
    <button class="nav-toggle" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
    <img class="brand-logo" src="assets/logo-cvo.png" alt="GO! CVO Antwerpen — volwassenenonderwijs">
  </header>
  <div class="layout">
    <aside class="sidebar">
      <nav>
        ${nav}
      </nav>
    </aside>
    <main class="content">
      <article>
        <h1 class="page-title">${pageTitle}</h1>
        ${blocksHtml || '<p class="empty">Deze pagina bevat geen inhoud.</p>'}
      </article>
    </main>
  </div>
  <footer class="site-footer">
    <img class="brand-lines" src="assets/brand-lines.png" alt="">
    <p>${esc(siteTitle)} — GO! CVO Antwerpen · volwassenenonderwijs</p>
  </footer>
</body>
</html>`;
}

// De gedeelde CSS — gebaseerd op het Word-sjabloon "Sjabloon cursusmateriaal"
// Huisstijl GO! CVO Antwerpen: teal #34B0AD, donkergrijze koppen #4E4E4E, Arial/Calibri
function buildCss() {
  return `:root {
  --cvo-teal: #34B0AD;        /* Titel CVO kleur uit het Word-sjabloon */
  --cvo-teal-dark: #2A9994;
  --cvo-teal-light: #E8F7F7;
  --cvo-heading: #4E4E4E;     /* kopkleur uit het Word-sjabloon */
  --cvo-text: #2d2d2d;
  --cvo-note-bg: #CED5DF;     /* lichtblauwgrijs van de note-iconen */
  --cvo-gray-light: #f4f4f4;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  /* Word-sjabloon gebruikt Arial (docDefaults) met Calibri als thema-fallback */
  font-family: 'Arial', 'Calibri', 'Segoe UI', 'Helvetica Neue', sans-serif;
  color: var(--cvo-text);
  background: #fff;
  line-height: 1.55;
  font-size: 16px;
}

/* Header — logo op witte achtergrond, zoals in het Word-document */
.site-header {
  background: #fff;
  padding: 14px 28px;
  display: flex;
  align-items: center;
  gap: 16px;
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 3px solid var(--cvo-teal);
  box-shadow: 0 1px 6px rgba(0,0,0,0.06);
}
.brand-logo { height: 46px; width: auto; }
.nav-toggle {
  display: none;
  background: var(--cvo-teal);
  border: none;
  color: #fff;
  font-size: 20px;
  padding: 4px 12px;
  border-radius: 8px;
  cursor: pointer;
}

/* Layout */
.layout { display: flex; min-height: calc(100vh - 67px); align-items: stretch; }

/* Sidebar */
.sidebar {
  width: 300px;
  flex-shrink: 0;
  background: var(--cvo-gray-light);
  border-right: 1px solid #e2e8f0;
  padding: 20px 0;
  overflow-y: auto;
  max-height: calc(100vh - 67px);
  position: sticky;
  top: 67px;
}
.nav-tree, .nav-tree ul { list-style: none; }
.nav-tree { padding: 0 12px; }
.nav-tree ul { margin-left: 14px; border-left: 1px solid #d8dde3; padding-left: 6px; }
.nav-tree a {
  display: block;
  padding: 7px 12px;
  color: var(--cvo-heading);
  text-decoration: none;
  border-radius: 8px;
  font-size: 14px;
  transition: background 0.15s, color 0.15s;
}
.nav-tree a:hover { background: var(--cvo-teal-light); color: var(--cvo-teal-dark); }
.nav-tree a.active { background: var(--cvo-teal); color: #fff; font-weight: 700; }

/* Content */
.content {
  flex: 1;
  padding: 40px 56px;
  max-width: 920px;
  margin: 0 auto;
  width: 100%;
}

/* Paginatitel — "Titel CVO" stijl: hoofdletters, teal, bold, lichte letterspatiëring */
.page-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--cvo-teal);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 26px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--cvo-teal);
}

/* Koppen — donkergrijs zoals het Word-sjabloon */
article h2 { font-size: 21px; font-weight: 700; color: var(--cvo-heading); margin: 28px 0 12px; }
article h3 { font-size: 18px; font-weight: 700; color: var(--cvo-heading); margin: 22px 0 10px; }
article h4, article h5, article h6 { font-size: 16px; font-weight: 700; color: var(--cvo-heading); margin: 18px 0 8px; }
article p { margin: 0 0 14px; }
article ul { margin: 0 0 16px 26px; }
article li { margin-bottom: 6px; }
article a { color: var(--cvo-teal-dark); }

figure { margin: 22px 0; }
figure img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: block;
}
figcaption { font-size: 13px; color: #6b7280; margin-top: 8px; font-style: italic; }

.empty { color: #a0aec0; font-style: italic; }

/* Footer — kleurrijke "berglijnen" huisstijlgraphic */
.site-footer {
  margin-top: auto;
  background: #fff;
  text-align: center;
}
.brand-lines { width: 100%; max-height: 90px; object-fit: cover; display: block; }
.site-footer p {
  color: var(--cvo-heading);
  font-size: 13px;
  padding: 14px 18px 20px;
}

/* Responsive */
@media (max-width: 768px) {
  .nav-toggle { display: block; }
  .sidebar {
    position: fixed;
    top: 67px;
    left: -300px;
    bottom: 0;
    max-height: none;
    transition: left 0.25s;
    z-index: 15;
    box-shadow: 2px 0 12px rgba(0,0,0,0.15);
  }
  body.nav-open .sidebar { left: 0; }
  .content { padding: 24px 20px; }
}
`;
}

// Bouw de .zip met de volledige HTML5 site en schrijf naar destPath
function buildHtmlSite(siteResult, imagesSourceDir, destPath) {
  return new Promise((resolve, reject) => {
    const root = siteResult.site;
    const siteTitle = root.title || 'Website';
    const pages = flattenPages(root);

    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // Gedeelde CSS
    archive.append(buildCss(), { name: 'style.css' });

    // Eén HTML-bestand per pagina
    for (const { node } of pages) {
      const html = buildPageHtml(node, root, siteTitle);
      archive.append(html, { name: node._file });
    }

    // Huisstijl-assets (logo + berglijnen) uit het Word-sjabloon
    if (fs.existsSync(ASSETS_DIR)) {
      archive.directory(ASSETS_DIR, 'assets');
    }

    // Afbeeldingen
    if (imagesSourceDir && fs.existsSync(imagesSourceDir)) {
      archive.directory(imagesSourceDir, 'images');
    }

    archive.finalize();
  });
}

module.exports = { buildHtmlSite };
