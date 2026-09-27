// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mnxPageLayout,
  mnxScorePageSizes,
  previewHeightForPage,
  sourcePageMargins,
  sourcePageZoom
} from '../src/web/preview.js';

test('source page zoom preserves the spatium-to-page-width ratio', () => {
  const pageSize = { widthMm: 215.9, heightMm: 279.4, spatiumMm: 1.81 };
  const zoom = sourcePageZoom(760, pageSize);
  const renderedSpatiumPx = 10 * zoom;
  assert.ok(Math.abs(renderedSpatiumPx / 760 - pageSize.spatiumMm / pageSize.widthMm) < 1e-12);
});

test('source page zoom rejects incomplete or invalid metrics', () => {
  assert.equal(sourcePageZoom(0, { widthMm: 215.9, spatiumMm: 1.81 }), undefined);
  assert.equal(sourcePageZoom(760, { widthMm: 0, spatiumMm: 1.81 }), undefined);
  assert.equal(sourcePageZoom(760, { widthMm: 215.9, spatiumMm: 0 }), undefined);
});

test('preview viewport shows at most one and a half rendered pages', () => {
  assert.equal(previewHeightForPage(1000, 34), 1534);
  assert.equal(previewHeightForPage(0, 34), undefined);
});

test('source page margins map to OSMD engraving rules with averaged horizontal margins', () => {
  assert.deepEqual(sourcePageMargins({
    hasMargins: true,
    marginTopSp: 6,
    marginBottomSp: 7,
    marginLeftSp: 8,
    marginRightSp: 9
  }), {
    PageTopMargin: 6,
    PageBottomMargin: 7,
    PageLeftMargin: 8.5,
    PageRightMargin: 8.5
  });
  assert.equal(sourcePageMargins({ hasMargins: false }), undefined);
});

test('MNX page layout keeps the source page proportions and spatium ratio', () => {
  const pageSize = { widthMm: 215.9, heightMm: 279.4, spatiumMm: 1.81 };
  const layout = mnxPageLayout(pageSize);
  assert.equal(layout.pageWidth, 800);
  assert.ok(Math.abs(layout.pageHeight / layout.pageWidth - pageSize.heightMm / pageSize.widthMm) < 1e-12);
  assert.ok(Math.abs(layout.spatium / layout.pageWidth - pageSize.spatiumMm / pageSize.widthMm) < 1e-12);
  assert.equal(layout.pageMargins, undefined);
});

test('MNX page layout keeps all four source margins in staff spaces', () => {
  const layout = mnxPageLayout({
    widthMm: 200,
    heightMm: 300,
    spatiumMm: 2,
    hasMargins: true,
    marginTopSp: 6,
    marginBottomSp: 7,
    marginLeftSp: 8,
    marginRightSp: 9
  });
  assert.equal(layout.spatium, 8);
  assert.deepEqual(layout.pageMargins, { top: 48, right: 72, bottom: 56, left: 64 });
});

test('MNX page layout falls back to Viritura defaults for incomplete metrics', () => {
  assert.equal(mnxPageLayout(undefined), undefined);
  assert.equal(mnxPageLayout({ widthMm: 0, heightMm: 279.4 }), undefined);
  assert.deepEqual(mnxPageLayout({ widthMm: 200, heightMm: 300, spatiumMm: 0, hasMargins: true, marginTopSp: 1 }),
    { pageWidth: 800, pageHeight: 1200 });
  assert.equal(mnxPageLayout({
    widthMm: 200, heightMm: 300, spatiumMm: 2, hasMargins: true, marginTopSp: 6, marginBottomSp: Number.NaN, marginLeftSp: 8, marginRightSp: 9
  }).pageMargins, undefined);
});

test('MNX scores take the page size of the score or part with the same name', () => {
  const score = { widthMm: 1 };
  const violin = { widthMm: 2 };
  const firstPart = { widthMm: 3 };
  const secondPart = { widthMm: 4 };
  const candidates = [
    { name: 'Score', pageSize: score },
    { name: 'Violin', pageSize: violin },
    { name: 'Part', pageSize: firstPart },
    { name: 'Part', pageSize: secondPart }
  ];
  assert.deepEqual(mnxScorePageSizes(['Score', 'Part', 'Violin', 'Part', 'Unknown'], candidates),
    [score, firstPart, violin, secondPart, undefined]);
});
