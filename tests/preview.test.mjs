// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { previewHeightForPage, sourcePageZoom } from '../src/web/preview.js';

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
