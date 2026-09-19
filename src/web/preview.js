// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

const OSMD_SCRIPT_URL = '__OSMD_SCRIPT_URL__';
let constructorPromise;

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
