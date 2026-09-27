// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

const OSMD_SCRIPT_URL = '__OSMD_SCRIPT_URL__';
const VIRITURA_VIEWER_URL = '__VIRITURA_VIEWER_URL__';
// Viritura lays pages out in display-list units; at zoom 1 one unit is one CSS pixel.
const MNX_PAGE_WIDTH = 800;
const MNX_PAGE_GAP = 16;
let constructorPromise;
let virituraViewerPromise;

export function sourcePageZoom(widthPx, pageSize) {
  if (!(widthPx > 0 && pageSize?.widthMm > 0 && pageSize?.spatiumMm > 0)) return undefined;
  return widthPx * pageSize.spatiumMm / pageSize.widthMm / 10;
}

export function previewHeightForPage(pageHeightPx, verticalChromePx = 0) {
  if (!(pageHeightPx > 0)) return undefined;
  return pageHeightPx * 1.5 + verticalChromePx;
}

export function sourcePageMargins(pageSize) {
  if (!pageSize?.hasMargins) return undefined;
  const values = [pageSize.marginTopSp, pageSize.marginBottomSp, pageSize.marginLeftSp, pageSize.marginRightSp];
  if (!values.every(Number.isFinite)) return undefined;
  const horizontalMargin = (pageSize.marginLeftSp + pageSize.marginRightSp) / 2;
  return {
    PageTopMargin: pageSize.marginTopSp,
    PageBottomMargin: pageSize.marginBottomSp,
    PageLeftMargin: horizontalMargin,
    PageRightMargin: horizontalMargin
  };
}

// Maps Denigma's source page metrics to Viritura's page options, keeping the
// page proportions and the ratio of spatium to page width. Unlike OSMD, Viritura
// takes all four margins, so none are averaged.
export function mnxPageLayout(pageSize, pageWidth = MNX_PAGE_WIDTH) {
  if (!(pageSize?.widthMm > 0 && pageSize?.heightMm > 0)) return undefined;
  const unitsPerMm = pageWidth / pageSize.widthMm;
  const layout = { pageWidth, pageHeight: pageSize.heightMm * unitsPerMm };
  if (!(pageSize.spatiumMm > 0)) return layout;
  layout.spatium = pageSize.spatiumMm * unitsPerMm;
  const margins = [pageSize.marginTopSp, pageSize.marginRightSp, pageSize.marginBottomSp, pageSize.marginLeftSp];
  if (pageSize.hasMargins && margins.every(Number.isFinite)) {
    const [top, right, bottom, left] = margins.map((value) => value * layout.spatium);
    layout.pageMargins = { top, right, bottom, left };
  }
  return layout;
}

// Denigma writes one MNX score per linked part, named as inspection names the
// score and parts. Names are matched in order, so duplicates pair up in turn; a
// score with no match keeps Viritura's default page.
export function mnxScorePageSizes(scoreNames, candidates) {
  const unused = [...candidates];
  return scoreNames.map((name) => {
    const index = unused.findIndex((candidate) => candidate.name === name);
    return index < 0 ? undefined : unused.splice(index, 1)[0].pageSize;
  });
}

function loadOsmd() {
  if (globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay) {
    return Promise.resolve(globalThis.opensheetmusicdisplay.OpenSheetMusicDisplay);
  }
  if (constructorPromise) return constructorPromise;
  constructorPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(OSMD_SCRIPT_URL, import.meta.url).href;
    script.async = true;
    script.addEventListener('load', () => {
      const constructor = globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay;
      if (constructor) resolve(constructor);
      else reject(new Error('OSMD loaded without exposing its renderer.'));
    }, { once: true });
    script.addEventListener('error', () => {
      constructorPromise = undefined;
      reject(new Error('Unable to load the OSMD preview renderer.'));
    }, { once: true });
    document.head.append(script);
  });
  return constructorPromise;
}

export async function renderMusicXmlPreview(container, musicXml, pageSize) {
  container.style.maxHeight = '';
  const renderSurface = document.createElement('div');
  renderSurface.className = 'preview-render-surface';
  container.replaceChildren(renderSurface);
  const validPageSize = pageSize?.widthMm > 0 && pageSize?.heightMm > 0 ? pageSize : undefined;
  const hasSourceSpatium = validPageSize?.spatiumMm > 0;
  const OpenSheetMusicDisplay = await loadOsmd();
  const renderer = new OpenSheetMusicDisplay(renderSurface, {
    backend: 'svg',
    autoResize: false,
    drawTitle: true,
    newPageFromXML: true,
    newSystemFromXML: true,
    pageBackgroundColor: '#ffffff'
  });
  if (validPageSize) renderer.setCustomPageFormat(validPageSize.widthMm, validPageSize.heightMm);
  // Denigma declares <supports element="stem" type="no"/> and leaves stem
  // directions to the renderer. Without this rule OSMD forces every note of a
  // secondary voice (a Finale layer other than 1) stem-down even where that
  // layer is alone in the measure; Finale gives such notes pitch-based stems.
  renderer.EngravingRules.AutoStemSecondaryVoicesWhenAloneInMeasure = true;
  // VexFlow pushes the beam of a run deep into ledger lines far from the
  // staff to honor minimum stem lengths. This pulls it back toward the staff
  // by lengthening stems only, closer to how Finale engraves such runs.
  renderer.EngravingRules.OptimizeExtremeLedgerBeams = true;
  const sourceMargins = sourcePageMargins(validPageSize);
  if (sourceMargins) Object.assign(renderer.EngravingRules, sourceMargins);
  await renderer.load(musicXml);

  let lastWidth = 0;
  function renderAtCurrentWidth() {
    const width = renderSurface.offsetWidth;
    if (width <= 0) return;
    const sourceZoom = hasSourceSpatium ? sourcePageZoom(width, validPageSize) : undefined;
    if (sourceZoom) renderer.Zoom = sourceZoom;
    renderer.render();
    const firstPage = renderSurface.querySelector('svg');
    if (firstPage) {
      const styles = getComputedStyle(container);
      const verticalChrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
        .reduce((total, property) => total + (Number.parseFloat(styles[property]) || 0), 0);
      const previewHeight = previewHeightForPage(firstPage.getBoundingClientRect().height, verticalChrome);
      if (previewHeight) container.style.maxHeight = `${previewHeight}px`;
    }
    lastWidth = width;
  }

  renderAtCurrentWidth();
  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
    if (Math.abs(renderSurface.offsetWidth - lastWidth) >= 1) renderAtCurrentWidth();
  });
  resizeObserver?.observe(renderSurface);

  return {
    renderer,
    pageSize: validPageSize,
    destroy() {
      resizeObserver?.disconnect();
      renderer.clear();
      renderSurface.remove();
      container.style.maxHeight = '';
    }
  };
}

function loadViritura() {
  virituraViewerPromise ||= import(new URL(VIRITURA_VIEWER_URL, import.meta.url).href).catch((error) => {
    virituraViewerPromise = undefined;
    throw error;
  });
  return virituraViewerPromise;
}

// Every page option is passed, so switching to a score without source metrics
// returns it to Viritura's defaults instead of keeping the previous score's.
function virituraPageOptions(pageSize) {
  return { pageWidth: undefined, pageHeight: undefined, spatium: undefined, pageMargins: undefined, ...mnxPageLayout(pageSize) };
}

export async function renderMnxPreview(container, mnx, candidates, { onError } = {}) {
  const text = typeof mnx === 'string' ? mnx : await mnx.text();
  const parsed = JSON.parse(text);
  const scores = (Array.isArray(parsed.scores) ? parsed.scores : [])
    .map((score, index) => ({ index, name: typeof score?.name === 'string' ? score.name : '' }));
  // Without scores[] Viritura renders the full score, which has the score's page.
  const pageSizes = scores.length
    ? mnxScorePageSizes(scores.map(({ name }) => name), candidates)
    : [candidates[0]?.pageSize];
  let scoreIndex = 0;

  container.style.maxHeight = '';
  container.classList.add('preview-canvas-viritura');
  const renderSurface = document.createElement('div');
  renderSurface.className = 'preview-viritura-surface';
  container.replaceChildren(renderSurface);
  const { mountScore } = await loadViritura();

  let viewer;
  let settled = false;
  let lastHeight = 0;
  // The viewer scrolls inside the surface; like the OSMD preview, show at most
  // one and a half pages of the first page's rendered height.
  function sizeToFirstPage() {
    const { positions, height } = viewer.arrangement;
    const firstPage = positions[0];
    if (!firstPage) return;
    const surfaceHeight = Math.min(height, previewHeightForPage(firstPage.height)) + 2 * MNX_PAGE_GAP;
    if (Math.abs(surfaceHeight - lastHeight) < 1) return;
    lastHeight = surfaceHeight;
    renderSurface.style.height = `${surfaceHeight}px`;
  }

  await new Promise((resolve, reject) => {
    viewer = mountScore(renderSurface, text, {
      viewMode: 'page',
      zoom: 'fit-width',
      contentAlign: 'center',
      pageGap: MNX_PAGE_GAP,
      pageBackground: '#ffffff',
      useWorker: true,
      scoreIndex,
      ...virituraPageOptions(pageSizes[scoreIndex]),
      onLayout() {
        sizeToFirstPage();
        if (!settled) {
          settled = true;
          resolve();
        }
      },
      onPaint: () => sizeToFirstPage(),
      onError(error) {
        if (!settled) {
          settled = true;
          reject(error);
        } else {
          onError?.(error);
        }
      }
    });
  }).catch((error) => {
    viewer?.destroy();
    renderSurface.remove();
    container.classList.remove('preview-canvas-viritura');
    throw error;
  });

  return {
    renderer: viewer,
    scores,
    get scoreIndex() {
      return scoreIndex;
    },
    get pageSize() {
      return pageSizes[scoreIndex];
    },
    setScoreIndex(index) {
      if (!Number.isInteger(index) || index < 0 || index >= scores.length || index === scoreIndex) return;
      scoreIndex = index;
      viewer.setOptions({ scoreIndex, ...virituraPageOptions(pageSizes[scoreIndex]) });
    },
    // The viewer paints only the pages in view, so printing uses a standalone
    // SVG of every page, shown only in print media.
    async preparePrint() {
      const { engine, displayList, measurements } = viewer;
      if (!engine || !displayList || !measurements) throw new Error('The preview has not finished rendering.');
      const printPages = document.createElement('div');
      printPages.className = 'preview-print-pages';
      for (let page = 0; page < measurements.pageCount; page += 1) {
        const image = new Image();
        image.alt = `Page ${page + 1}`;
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await engine.toSvg(displayList, { page }))}`;
        printPages.append(image);
      }
      await Promise.all(Array.from(printPages.children, (image) => image.decode().catch(() => {})));
      container.append(printPages);
      return () => printPages.remove();
    },
    destroy() {
      viewer.destroy();
      renderSurface.remove();
      container.querySelector('.preview-print-pages')?.remove();
      container.classList.remove('preview-canvas-viritura');
    }
  };
}
