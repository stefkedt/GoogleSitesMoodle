// H5P Interactive Book builder
// Takes a crawled site JSON and produces a .h5p ZIP buffer

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');

const TEMPLATE_PATH = path.join(__dirname, 'h5p-libraries-template.h5p');
const EXTRA_LIBS_DIR = path.join(__dirname, 'h5p-extra-libs'); // o.a. H5P.Video

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeAdvancedText(html) {
  return {
    content: {
      params: { text: html },
      library: 'H5P.AdvancedText 1.1',
      metadata: { contentType: 'Text', license: 'U', title: 'Tekst' },
      subContentId: uuidv4()
    },
    useSeparator: 'auto'
  };
}

function makeImage(block) {
  const isLocal = !block.src.startsWith('http');
  const filePath = isLocal ? block.src : block.src;
  const mime = filePath.endsWith('.png') ? 'image/png'
             : filePath.endsWith('.gif') ? 'image/gif'
             : filePath.endsWith('.webp') ? 'image/webp'
             : 'image/jpeg';

  return {
    content: {
      params: {
        decorative: !block.alt,
        contentName: 'Afbeelding',
        expandImage: 'Vergroot afbeelding',
        minimizeImage: 'Verklein afbeelding',
        file: {
          path: isLocal ? filePath : block.src,
          mime,
          copyright: { license: 'U' },
          width: 800,
          height: 600
        },
        alt: esc(block.alt || ''),
        title: esc(block.alt || 'Afbeelding')
      },
      library: 'H5P.Image 1.1',
      metadata: { contentType: 'Image', license: 'U', title: block.alt || 'Afbeelding' },
      subContentId: uuidv4()
    },
    useSeparator: 'auto'
  };
}

// Speelbare YouTube-video als H5P.Video-node
function makeVideo(block) {
  return {
    content: {
      params: {
        sources: [{ path: block.src, mime: 'video/YouTube', copyright: { license: 'U' } }],
        visuals: { fit: false, controls: true },
        playback: { autoplay: false, loop: false }
      },
      library: 'H5P.Video 1.6',
      metadata: { contentType: 'Video', license: 'U', title: 'Video' },
      subContentId: uuidv4()
    },
    useSeparator: 'auto'
  };
}

function blocksToColumnContent(blocks) {
  const content = [];
  let htmlBuffer = '';

  const flushText = () => {
    if (htmlBuffer.trim()) {
      content.push(makeAdvancedText(htmlBuffer));
      htmlBuffer = '';
    }
  };

  for (const block of blocks) {
    if (block.type === 'image') {
      flushText();
      content.push(makeImage(block));
    } else if (block.type === 'heading') {
      htmlBuffer += `<h${block.level}>${esc(block.text)}</h${block.level}>\n`;
    } else if (block.type === 'paragraph') {
      htmlBuffer += `<p>${block.html || esc(block.text)}</p>\n`;
    } else if (block.type === 'list') {
      htmlBuffer += '<ul>' + block.items.map((it, i) => {
        const h = block.itemsHtml && block.itemsHtml[i];
        return `<li>${h || esc(it)}</li>`;
      }).join('') + '</ul>\n';
    } else if (block.type === 'link') {
      htmlBuffer += `<p><a href="${esc(block.href)}">${esc(block.text)}</a></p>\n`;
    } else if (block.type === 'video') {
      if (block.provider === 'youtube') {
        flushText();
        content.push(makeVideo(block)); // echt afspeelbaar
      } else {
        // Vimeo/Dailymotion/Drive: link (H5P.Video YouTube-handler dekt deze niet betrouwbaar)
        htmlBuffer += `<p>🎬 Video: <a href="${esc(block.src)}">${esc(block.src)}</a></p>\n`;
      }
    }
  }
  flushText();

  return content;
}

function buildChapters(node, chapters = []) {
  const hasContent = (node.blocks || []).length > 0;

  if (hasContent) {
    chapters.push({
      params: { content: blocksToColumnContent(node.blocks) },
      library: 'H5P.Column 1.18',           // match installed version
      subContentId: uuidv4(),
      metadata: { contentType: 'Page', license: 'U', title: node.title || 'Hoofdstuk' }
    });
  }

  for (const child of (node.children || [])) {
    buildChapters(child, chapters);
  }

  return chapters;
}

function buildH5PContent(siteResult) {
  const chapters = buildChapters(siteResult.site);
  // Root-level l10n keys exactly as Moodle 1.11 generates them
  return {
    showCoverPage: false,
    bookCover: { coverDescription: '<p></p>' },
    chapters,
    behaviour: {
      baseColor: '#3DBDB5',
      defaultTableOfContents: true,
      progressIndicators: true,
      progressAuto: true,
      displaySummary: true,
      enableRetry: true
    },
    read: 'Lezen',
    displayTOC: "Toon 'Inhoudsopgave'",
    hideTOC: "Verberg 'Inhoudsopgave'",
    nextPage: 'Volgende pagina',
    previousPage: 'Vorige pagina',
    chapterCompleted: 'Pagina voltooid!',
    partCompleted: '@pages van @total voltooid',
    incompleteChapter: 'Onvoltooide pagina',
    navigateToTop: 'Navigeer naar boven',
    markAsFinished: 'Ik heb deze pagina voltooid',
    fullscreen: 'Volledig scherm',
    exitFullscreen: 'Volledig scherm afsluiten',
    bookProgressSubtext: '@count van @total pagina\'s',
    interactionsProgressSubtext: '@count van @total interacties',
    submitReport: 'Rapport verzenden',
    restartLabel: 'Opnieuw starten',
    summaryHeader: 'Samenvatting',
    allInteractions: 'Alle interacties',
    unansweredInteractions: 'Niet-beantwoorde interacties',
    scoreText: '@score / @maxscore',
    leftOutOfTotalCompleted: '@left van @max interacties afgerond',
    noInteractions: 'Geen interacties',
    score: 'Score',
    summaryAndSubmit: 'Samenvatting & verzenden',
    noChapterInteractionBoldText: 'Er zijn geen interacties met pagina\'s.',
    noChapterInteractionText: 'Je moet tenminste één interactie hebben voltooid om de samenvatting te kunnen zien.',
    yourAnswersAreSubmittedForReview: 'Je antwoorden zijn verzonden voor beoordeling!',
    bookProgress: 'Boekvoortgang',
    interactionsProgress: 'Interactievoortgang',
    totalScoreLabel: 'Totaalscore',
    a11y: {
      progress: 'Pagina @page van @total.',
      menu: 'Uit-/invouwen navigatiemenu'
    }
  };
}

function buildH5PMeta(title) {
  // Versions as STRINGS, no authors/changes — exactly like Moodle's own export
  return {
    title: title || 'Interactief Boek',
    language: 'und',
    mainLibrary: 'H5P.InteractiveBook',
    embedTypes: ['iframe'],
    license: 'U',
    defaultLanguage: 'nl',
    preloadedDependencies: [
      { machineName: 'H5P.AdvancedText',      majorVersion: '1', minorVersion: '1' },
      { machineName: 'H5P.Image',             majorVersion: '1', minorVersion: '1' },
      { machineName: 'H5P.Video',             majorVersion: '1', minorVersion: '6' },
      { machineName: 'H5P.Column',            majorVersion: '1', minorVersion: '18' },
      { machineName: 'H5P.InteractiveBook',   majorVersion: '1', minorVersion: '11' },
      { machineName: 'FontAwesome',           majorVersion: '4', minorVersion: '5' },
      { machineName: 'H5P.JoubelUI',          majorVersion: '1', minorVersion: '3' },
      { machineName: 'H5P.FontIcons',         majorVersion: '1', minorVersion: '0' },
      { machineName: 'H5P.Transition',        majorVersion: '1', minorVersion: '0' }
    ]
  };
}

// Extract library folders from the template .h5p and add to archive
function addLibrariesFromTemplate(archive) {
  if (!fs.existsSync(TEMPLATE_PATH)) return;
  try {
    const zip = new AdmZip(TEMPLATE_PATH);
    const entries = zip.getEntries();
    const seen = new Set();
    for (const entry of entries) {
      const name = entry.entryName;
      // Only include library folders (not content/ or h5p.json)
      if (name.startsWith('content/') || name === 'h5p.json') continue;
      // Skip editor-only libraries
      if (name.startsWith('H5PEditor.')) continue;
      if (!entry.isDirectory && name.includes('/')) {
        const topDir = name.split('/')[0];
        if (!seen.has(name)) {
          seen.add(name);
          archive.append(entry.getData(), { name });
        }
      }
    }
  } catch (e) {
    console.warn('Kon bibliotheken niet uit template laden:', e.message);
  }
}

// Build the .h5p ZIP and write to destPath
function buildH5PFile(siteResult, imagesSourceDir, destPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // h5p.json
    const meta = buildH5PMeta(siteResult.site.title);
    archive.append(JSON.stringify(meta), { name: 'h5p.json' });

    // content/content.json
    const content = buildH5PContent(siteResult);
    archive.append(JSON.stringify(content), { name: 'content/content.json' });

    // Images
    if (imagesSourceDir && fs.existsSync(imagesSourceDir)) {
      archive.directory(imagesSourceDir, 'content/images');
    }

    // Library files from template
    addLibrariesFromTemplate(archive);

    // Extra bibliotheken (o.a. H5P.Video) — mappen op de root van de .h5p
    if (fs.existsSync(EXTRA_LIBS_DIR)) {
      archive.directory(EXTRA_LIBS_DIR, false);
    }

    archive.finalize();
  });
}

module.exports = { buildH5PFile };
