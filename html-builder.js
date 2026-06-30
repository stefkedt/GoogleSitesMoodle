// Static HTML5 website builder
// Takes a crawled site JSON and produces a .zip with a multi-page HTML5 site + CSS
// Supports multiple visual themes.

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
  if (block.type === 'video') {
    const src = esc(block.src);
    return `<div class="video-embed"><iframe src="${src}" title="${esc(block.provider || 'video')}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
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
function buildPageHtml(node, root, siteTitle, themeKey) {
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
<body class="theme-${themeKey}">
  <header class="site-header">
    <button class="nav-toggle" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
    <img class="brand-logo" src="assets/logo-cvo.png" alt="GO! CVO Antwerpen — volwassenenonderwijs">
    <span class="brand-title">${esc(siteTitle)}</span>
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

// ---------------------------------------------------------------------------
// Gedeelde structurele CSS (layout, navigatie, responsive) — themaonafhankelijk
// ---------------------------------------------------------------------------
function baseCss() {
  return `* { box-sizing: border-box; margin: 0; padding: 0; }
body { line-height: 1.55; font-size: 16px; }
img { max-width: 100%; }

.site-header {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 28px; position: sticky; top: 0; z-index: 20;
}
.brand-logo { height: 46px; width: auto; }
.nav-toggle {
  display: none; border: none; font-size: 20px;
  padding: 4px 12px; border-radius: 8px; cursor: pointer;
}

.layout { display: flex; align-items: stretch; min-height: calc(100vh - 74px); }

.sidebar {
  width: 300px; flex-shrink: 0; padding: 20px 0;
  overflow-y: auto; max-height: calc(100vh - 74px);
  position: sticky; top: 74px;
}
.nav-tree, .nav-tree ul { list-style: none; }
.nav-tree { padding: 0 12px; }
.nav-tree ul { margin-left: 14px; padding-left: 6px; }
.nav-tree a {
  display: block; padding: 7px 12px; text-decoration: none;
  border-radius: 8px; font-size: 14px;
  transition: background 0.15s, color 0.15s;
}

.content { flex: 1; padding: 40px 56px; max-width: 920px; margin: 0 auto; width: 100%; }
article p { margin: 0 0 14px; }
article ul { margin: 0 0 16px 26px; }
article li { margin-bottom: 6px; }
figure { margin: 22px 0; }
figure img { height: auto; display: block; }
figcaption { font-size: 13px; margin-top: 8px; font-style: italic; }
.video-embed { position: relative; width: 100%; padding-top: 56.25%; margin: 22px 0; border-radius: 10px; overflow: hidden; background: #000; }
.video-embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.empty { font-style: italic; opacity: 0.6; }

.site-footer { margin-top: auto; }
.brand-lines { width: 100%; max-height: 90px; object-fit: cover; display: block; }
.site-footer p { font-size: 13px; padding: 14px 18px 20px; text-align: center; }

@media (max-width: 768px) {
  .nav-toggle { display: block; }
  .sidebar {
    position: fixed; top: 74px; left: -300px; bottom: 0;
    max-height: none; transition: left 0.25s; z-index: 15;
    box-shadow: 2px 0 12px rgba(0,0,0,0.15);
  }
  body.nav-open .sidebar { left: 0; }
  .content { padding: 24px 20px; }
}
`;
}

// ---------------------------------------------------------------------------
// Thema's: elk levert de visuele CSS bovenop baseCss()
// ---------------------------------------------------------------------------
const THEMES = {
  // 1) CVO cursussjabloon (huidige) — Word-sjabloon "Sjabloon cursusmateriaal"
  cvo: {
    label: 'CVO cursussjabloon',
    description: 'Huisstijl uit het Word-cursussjabloon: logo, teal titels in hoofdletters, berglijnen-footer.',
    showLogo: true, showBrandTitle: false, showBrandLines: true,
    css: `
:root { --teal:#34B0AD; --teal-dark:#2A9994; --teal-light:#E8F7F7; --heading:#4E4E4E; }
body { font-family:'Arial','Calibri','Segoe UI',sans-serif; color:#2d2d2d; background:#fff; }
.site-header { background:#fff; border-bottom:3px solid var(--teal); box-shadow:0 1px 6px rgba(0,0,0,0.06); }
.brand-title { display:none; }
.nav-toggle { background:var(--teal); color:#fff; }
.sidebar { background:#f4f4f4; border-right:1px solid #e2e8f0; }
.nav-tree ul { border-left:1px solid #d8dde3; }
.nav-tree a { color:var(--heading); }
.nav-tree a:hover { background:var(--teal-light); color:var(--teal-dark); }
.nav-tree a.active { background:var(--teal); color:#fff; font-weight:700; }
.page-title { font-size:26px; font-weight:700; color:var(--teal); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:26px; padding-bottom:12px; border-bottom:2px solid var(--teal); }
article h2 { font-size:21px; font-weight:700; color:var(--heading); margin:28px 0 12px; }
article h3 { font-size:18px; font-weight:700; color:var(--heading); margin:22px 0 10px; }
article h4,article h5,article h6 { font-size:16px; font-weight:700; color:var(--heading); margin:18px 0 8px; }
article a { color:var(--teal-dark); }
figure img { border-radius:10px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
figcaption { color:#6b7280; }
.site-footer { background:#fff; }
.site-footer p { color:var(--heading); }
`
  },

  // 2) Modern (de eerste versie) — teal balk, witte logo, afgeronde stijl
  modern: {
    label: 'Modern (eerste versie)',
    description: 'Strakke moderne look: teal headerbalk met wit logo, afgeronde afbeeldingen, donkere footer.',
    showLogo: true, showBrandTitle: true, showBrandLines: false,
    css: `
:root { --teal:#34B0AD; --teal-dark:#2A9994; --teal-light:#E8F7F7; --gray:#565657; }
body { font-family:'Segoe UI','Calibri','Helvetica Neue',sans-serif; color:var(--gray); background:#f4f4f4; }
.site-header { background:var(--teal); color:#fff; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
.brand-logo { filter:brightness(0) invert(1); }
.brand-title { font-size:18px; font-weight:700; letter-spacing:0.3px; padding-left:16px; border-left:2px solid rgba(255,255,255,0.4); }
.nav-toggle { background:rgba(255,255,255,0.2); color:#fff; }
.sidebar { background:#fff; border-right:1px solid #e2e8f0; }
.nav-tree ul { border-left:1px solid #e2e8f0; }
.nav-tree a { color:var(--gray); }
.nav-tree a:hover { background:var(--teal-light); color:var(--teal-dark); }
.nav-tree a.active { background:var(--teal); color:#fff; font-weight:600; }
.content { background:#fff; border-radius:14px; box-shadow:0 1px 4px rgba(0,0,0,0.08); margin:24px auto; }
.page-title { font-size:30px; font-weight:800; color:#1a202c; margin-bottom:24px; padding-bottom:12px; border-bottom:3px solid var(--teal); }
article h2 { font-size:23px; font-weight:700; color:#2d3748; margin:28px 0 12px; }
article h3 { font-size:19px; font-weight:700; color:#2d3748; margin:22px 0 10px; }
article h4,article h5,article h6 { font-size:16px; font-weight:700; color:#2d3748; margin:18px 0 8px; }
article a { color:var(--teal-dark); }
figure img { border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
figcaption { color:#718096; }
.site-footer { background:var(--gray); }
.site-footer p { color:rgba(255,255,255,0.85); }
`
  },

  // 3) Google Sites — schone, minimale Google-look
  google: {
    label: 'Google Sites',
    description: 'Lijkt op de oorspronkelijke Google Site: schoon, Roboto-lettertype, blauwe accenten, minimalistisch.',
    showLogo: false, showBrandTitle: true, showBrandLines: false,
    css: `
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
:root { --g-blue:#1a73e8; --g-blue-light:#e8f0fe; --g-text:#3c4043; --g-border:#dadce0; }
body { font-family:'Roboto','Arial',sans-serif; color:var(--g-text); background:#fff; }
.site-header { background:#fff; border-bottom:1px solid var(--g-border); box-shadow:none; }
.brand-logo { display:none; }
.brand-title { font-size:22px; font-weight:400; color:var(--g-text); }
.nav-toggle { background:transparent; color:var(--g-text); }
.sidebar { background:#fff; border-right:1px solid var(--g-border); }
.nav-tree ul { border-left:1px solid var(--g-border); }
.nav-tree a { color:var(--g-text); border-radius:0 20px 20px 0; font-weight:500; }
.nav-tree a:hover { background:#f1f3f4; }
.nav-tree a.active { background:var(--g-blue-light); color:var(--g-blue); font-weight:500; }
.page-title { font-size:34px; font-weight:400; color:#202124; margin-bottom:24px; padding-bottom:0; }
article h2 { font-size:24px; font-weight:400; color:#202124; margin:30px 0 12px; }
article h3 { font-size:20px; font-weight:500; color:#202124; margin:22px 0 10px; }
article h4,article h5,article h6 { font-size:16px; font-weight:500; color:#202124; margin:18px 0 8px; }
article a { color:var(--g-blue); }
article p, article li { font-size:16px; color:var(--g-text); }
figure img { border-radius:8px; border:1px solid var(--g-border); }
figcaption { color:#5f6368; }
.site-footer { background:#f8f9fa; border-top:1px solid var(--g-border); }
.site-footer p { color:#5f6368; }
`
  }
};

function buildCss(themeKey) {
  const theme = THEMES[themeKey] || THEMES.cvo;
  let css = baseCss() + '\n' + theme.css;
  // Verberg merk-elementen die dit thema niet gebruikt
  if (!theme.showLogo)       css += '\n.brand-logo { display:none; }';
  if (!theme.showBrandTitle) css += '\n.brand-title { display:none; }';
  if (!theme.showBrandLines) css += '\n.brand-lines { display:none; }';
  return css;
}

// Bouw de .zip met de volledige HTML5 site en schrijf naar destPath
function buildHtmlSite(siteResult, imagesSourceDir, destPath, themeKey = 'cvo') {
  if (!THEMES[themeKey]) themeKey = 'cvo';
  return new Promise((resolve, reject) => {
    const root = siteResult.site;
    const siteTitle = root.title || 'Website';
    const pages = flattenPages(root);

    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // Thema-CSS
    archive.append(buildCss(themeKey), { name: 'style.css' });

    // Eén HTML-bestand per pagina
    for (const { node } of pages) {
      const html = buildPageHtml(node, root, siteTitle, themeKey);
      archive.append(html, { name: node._file });
    }

    // Huisstijl-assets (logo + berglijnen)
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

// Lijst met beschikbare thema's (voor de UI)
function listThemes() {
  return Object.entries(THEMES).map(([key, t]) => ({
    key, label: t.label, description: t.description
  }));
}

module.exports = { buildHtmlSite, listThemes, THEMES };
