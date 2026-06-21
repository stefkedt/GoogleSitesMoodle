// Static HTML5 website builder
// Takes a crawled site JSON and produces a .zip with a multi-page HTML5 site + CSS

const archiver = require('archiver');
const fs = require('fs');

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
    <span class="site-title">${esc(siteTitle)}</span>
  </header>
  <div class="layout">
    <aside class="sidebar">
      <nav>
        ${nav}
      </nav>
    </aside>
    <main class="content">
      <article>
        <h1>${pageTitle}</h1>
        ${blocksHtml || '<p class="empty">Deze pagina bevat geen inhoud.</p>'}
      </article>
    </main>
  </div>
  <footer class="site-footer">
    <p>Gegenereerd uit Google Sites • ${esc(siteTitle)}</p>
  </footer>
</body>
</html>`;
}

// De gedeelde CSS — CVO Antwerpen huisstijl
function buildCss() {
  return `:root {
  --cvo-teal: #34B0AD;
  --cvo-teal-dark: #2A9994;
  --cvo-teal-light: #E8F7F7;
  --cvo-gray: #565657;
  --cvo-gray-light: #f4f4f4;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Segoe UI', 'Calibri', 'Helvetica Neue', sans-serif;
  color: var(--cvo-gray);
  background: var(--cvo-gray-light);
  line-height: 1.6;
}

/* Header */
.site-header {
  background: var(--cvo-teal);
  color: #fff;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
  position: sticky;
  top: 0;
  z-index: 20;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.site-title { font-size: 18px; font-weight: 700; letter-spacing: 0.3px; }
.nav-toggle {
  display: none;
  background: rgba(255,255,255,0.2);
  border: none;
  color: #fff;
  font-size: 20px;
  padding: 4px 12px;
  border-radius: 8px;
  cursor: pointer;
}

/* Layout */
.layout { display: flex; min-height: calc(100vh - 56px); align-items: stretch; }

/* Sidebar */
.sidebar {
  width: 300px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e2e8f0;
  padding: 20px 0;
  overflow-y: auto;
  max-height: calc(100vh - 56px);
  position: sticky;
  top: 56px;
}
.nav-tree, .nav-tree ul { list-style: none; }
.nav-tree { padding: 0 12px; }
.nav-tree ul { margin-left: 14px; border-left: 1px solid #e2e8f0; padding-left: 6px; }
.nav-tree a {
  display: block;
  padding: 7px 12px;
  color: var(--cvo-gray);
  text-decoration: none;
  border-radius: 8px;
  font-size: 14px;
  transition: background 0.15s, color 0.15s;
}
.nav-tree a:hover { background: var(--cvo-teal-light); color: var(--cvo-teal-dark); }
.nav-tree a.active { background: var(--cvo-teal); color: #fff; font-weight: 600; }

/* Content */
.content {
  flex: 1;
  padding: 36px 48px;
  max-width: 900px;
  margin: 0 auto;
}
article h1 {
  font-size: 30px;
  font-weight: 800;
  color: #1a202c;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 3px solid var(--cvo-teal);
}
article h2 { font-size: 23px; font-weight: 700; color: #2d3748; margin: 28px 0 12px; }
article h3 { font-size: 19px; font-weight: 700; color: #2d3748; margin: 22px 0 10px; }
article h4, article h5, article h6 { font-size: 16px; font-weight: 700; margin: 18px 0 8px; }
article p { margin: 0 0 14px; }
article ul { margin: 0 0 16px 24px; }
article li { margin-bottom: 6px; }

figure { margin: 20px 0; }
figure img {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: block;
}
figcaption { font-size: 13px; color: #718096; margin-top: 8px; font-style: italic; }

.empty { color: #a0aec0; font-style: italic; }

/* Footer */
.site-footer {
  background: var(--cvo-gray);
  color: rgba(255,255,255,0.8);
  text-align: center;
  padding: 18px;
  font-size: 13px;
}

/* Responsive */
@media (max-width: 768px) {
  .nav-toggle { display: block; }
  .sidebar {
    position: fixed;
    top: 56px;
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

    // Afbeeldingen
    if (imagesSourceDir && fs.existsSync(imagesSourceDir)) {
      archive.directory(imagesSourceDir, 'images');
    }

    archive.finalize();
  });
}

module.exports = { buildHtmlSite };
