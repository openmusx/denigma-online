// Copyright 2026 Robert G. Patterson.
// SPDX-License-Identifier: MIT

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(relativeUrl) {
  return JSON.parse(await readFile(new URL(relativeUrl, import.meta.url), 'utf8'));
}

test('HTML has privacy, status, accessible labels, and issue links', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /Technology preview:/);
  assert.match(html, /review exported files before relying on them/);
  assert.match(html, /entirely in your browser/);
  assert.match(html, /script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'/);
  assert.match(html, /href="\.\/LICENSE\.txt"/);
  assert.match(html, /MIT License and warranty disclaimer/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<label for="file"/);
  assert.match(html, /accept="[^"]*\.enigmaxml[^"]*\.zip/);
  assert.match(html, /id="inputError"[^>]*role="alert"[^>]*hidden/);
  assert.match(html, /MusicXML \(uncompressed\)/);
  assert.match(html, /MNX \(experimental\)/);
  assert.match(html, /EnigmaXML \(proprietary Finale XML\)/);
  assert.doesNotMatch(html, /id="verboseLogging"/);
  assert.match(html, /id="selectAllDocuments"[^>]*>Select all</);
  assert.match(html, /id="selectNoDocuments"[^>]*>Select none</);
  assert.match(html, /id="scoreName">Score</);
  assert.match(html, /id="previewSection"[^>]*hidden/);
  assert.match(html, /id="previewCanvas"[^>]*tabindex="0"[^>]*aria-label="Scrollable score preview"/);
  assert.match(html, /id="printPreview"[^>]*disabled>Print…<\/button>/);
  assert.match(html, /Looks wrong\?<\/strong> Open the downloaded MusicXML in your music app before reporting a problem\./);
  assert.match(html, /OpenSheetMusicDisplay 2\.1\.1/);
  assert.match(html, /href="\.\/LICENSE-OSMD\.txt"/);
  assert.match(html, /github\.com\/openmusx\/denigma\/issues/g);
  assert.doesNotMatch(html, /issues\/new/);
  assert.doesNotMatch(html, /https:\/\/(?!github\.com)/);
});

test('MusicXML documents can be selected or cleared as a group', async () => {
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  assert.match(app, /function setDocumentSelection\(checked\)/);
  assert.match(app, /input\.checked = checked/);
  assert.match(app, /selectAllDocuments\.addEventListener\('click', \(\) => setDocumentSelection\(true\)\)/);
  assert.match(app, /selectNoDocuments\.addEventListener\('click', \(\) => setDocumentSelection\(false\)\)/);
  assert.match(app, /documents\.addEventListener\('change'/);
});

test('MusicXML can preserve text when all source fonts are available', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/web/worker.js', import.meta.url), 'utf8');

  assert.match(html, /id="musicxmlAllFonts"[^>]*aria-describedby="musicxmlAllFontsHint"/);
  assert.match(html, /id="musicxmlAllFontsHint" role="tooltip" class="hint-bubble">[^<]{20,}</);
  assert.match(app, /formatKey === 'musicxml' && elements\.musicxmlAllFonts\.checked/);
  assert.match(worker, /options\.allFontsAvailable \? 1 : 0/);
});

test('MusicXML can preserve Finale whole-rest positions', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/web/worker.js', import.meta.url), 'utf8');

  assert.match(html, /id="musicxmlFinaleRestPosition"[^>]*aria-describedby="musicxmlFinaleRestPositionHint"/);
  assert.doesNotMatch(html, /id="musicxmlFinaleRestPosition"[^>]*checked/);
  assert.match(html, /id="musicxmlFinaleRestPositionHint" role="tooltip" class="hint-bubble">[^<]{20,}</);
  assert.match(app, /useFinaleRestPosition: formatKey === 'musicxml' && elements\.musicxmlFinaleRestPosition\.checked/);
  assert.match(worker, /options\.useFinaleRestPosition \? 1 : 0/);
});

test('conversion preferences are stored locally without cookies', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');

  assert.match(html, /conversion preferences may be saved in this browser/);
  assert.match(app, /const SETTINGS_STORAGE_KEY = 'denigma-online\.settings\.v1'/);
  assert.match(app, /localStorage\.setItem\(SETTINGS_STORAGE_KEY/);
  assert.match(app, /localStorage\.getItem\(SETTINGS_STORAGE_KEY/);
  assert.match(app, /restoreSettings\(\);/);
  assert.doesNotMatch(app, /document\.cookie/);
});

test('every option hint is described once and reachable by assistive technology', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8');

  const bubbles = Array.from(html.matchAll(/<span id="(\w+Hint)" role="tooltip" class="hint-bubble">([^<]*)</g));
  assert.ok(bubbles.length >= 5, 'expected a hint bubble for each explained option');
  for (const [, id, text] of bubbles) {
    assert.ok(text.trim().length > 0, `${id} is empty`);
    assert.match(html, new RegExp(`aria-describedby="${id}"`), `${id} is not referenced by its control`);
    assert.ok(!html.includes(`aria-label="${text}"`), `${id} text is duplicated into an aria-label`);
  }
  // aria-describedby only resolves while the bubble stays in the accessibility tree,
  // so hidden bubbles must fade with opacity rather than display/visibility.
  assert.match(css, /\.hint-bubble \{[^}]*opacity: 0;/s);
  assert.ok(!/\.hint-bubble \{[^}]*(display: none|visibility: hidden)/s.test(css));
});

test('invalid ZIP input is rejected beside the picker and clears its selection', async () => {
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const rejection = app.slice(app.indexOf('if (!isSupportedInputFile(file))'), app.indexOf('clearInputError();'));
  assert.match(app, /filename must end in \.enigmaxml\.zip/);
  assert.match(app, /function showInputError\(message\)/);
  assert.match(app, /elements\.file\.value = ''/);
  assert.match(app, /elements\.inputError\.hidden = false/);
  assert.match(app, /elements\.dropZone\.classList\.add\('invalid'\)/);
  assert.match(rejection, /setStatus\(''\)/);
  assert.doesNotMatch(rejection, /setStatus\(message/);
});

test('outputs download from real links so picker-less browsers keep working', async () => {
  const html = await readFile(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="saveAll"[^>]*>Save all to folder…</);
  assert.match(html, /id="downloadZip"[^>]*>Download \.zip</);
  assert.match(app, /link\.download = output\.name/);
  assert.match(app, /canPickSaveFile = 'showSaveFilePicker' in window/);
  assert.match(app, /canPickDirectory = 'showDirectoryPicker' in window/);
  assert.match(app, /elements\.saveAll\.hidden = !canPickDirectory/);
  assert.match(app, /elements\.downloadZip\.hidden = !canZip/);

  // The picker paths must never quietly manufacture a download; that mismatch is
  // what the visible filename links replaced.
  const saveOutput = app.slice(app.indexOf('async function saveOutput'), app.indexOf('function renderOutputs'));
  const saveAll = app.slice(app.indexOf('elements.saveAll.addEventListener'), app.indexOf('elements.copyReport.addEventListener'));
  assert.doesNotMatch(saveOutput, /createElement/);
  assert.doesNotMatch(saveAll, /createElement/);
});

test('MusicXML previews lazy-load OSMD and render the complete score', async () => {
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const preview = await readFile(new URL('../src/web/preview.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/web/styles.css', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-web.mjs', import.meta.url), 'utf8');
  assert.match(app, /formatKey === 'musicxml'/);
  assert.match(app, /preview\.textContent = 'Preview'/);
  assert.match(app, /elements\.previewStatus\.textContent = 'Preview ready\.'/);
  assert.match(app, /elements\.printPreview\.disabled = false/);
  assert.match(app, /sheet\.insertRule\(`@page \{ size: \$\{width\}mm \$\{height\}mm; margin: 0; \}`/);
  assert.match(app, /window\.addEventListener\('afterprint', removePageRule/);
  assert.match(app, /window\.print\(\)/);
  assert.doesNotMatch(app, /source page size|source page layout|spatium \(\$\{/);
  assert.match(app, /import\(new URL\(PREVIEW_MODULE_URL, import\.meta\.url\)\.href\)/);
  assert.match(app, /renderMusicXmlPreview\(elements\.previewCanvas, output\.blob, output\.pageSize\)/);
  assert.match(preview, /document\.createElement\('script'\)/);
  assert.match(preview, /renderSurface\.className = 'preview-render-surface'/);
  assert.match(preview, /new OpenSheetMusicDisplay\(renderSurface/);
  assert.match(preview, /newPageFromXML: true/);
  assert.match(preview, /newSystemFromXML: true/);
  assert.match(preview, /renderer\.setCustomPageFormat/);
  assert.match(preview, /Object\.assign\(renderer\.EngravingRules, sourceMargins\)/);
  assert.match(preview, /renderer\.Zoom = sourceZoom/);
  assert.match(preview, /new ResizeObserver/);
  assert.match(preview, /resizeObserver\?\.observe\(renderSurface\)/);
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /width: calc\(100% \+ 1rem\)/);
  assert.match(styles, /@media print/);
  assert.match(styles, /\.preview-render-surface > div \+ div \{ break-before: page; page-break-before: always; \}/);
  assert.match(styles, /border-radius: 0; margin: 0; max-height: none !important/);
  assert.match(styles, /max-height: none !important/);
  assert.match(styles, /break-inside: avoid; margin: 0 !important; page-break-inside: avoid/);
  assert.match(styles, /width: calc\(100% - 1px\) !important/);
  assert.match(preview, /firstPage\.getBoundingClientRect\(\)\.height/);
  assert.match(preview, /container\.style\.maxHeight = `\$\{previewHeight\}px`/);
  assert.match(preview, /autoResize: false/);
  assert.doesNotMatch(preview, /TextDecoder|DOMParser|page-width/);
  assert.match(preview, /renderer\.render\(\)/);
  assert.doesNotMatch(preview, /drawUpToPageNumber/);
  assert.match(build, /opensheetmusicdisplay\.min\.js/);
  assert.match(build, /LICENSE-OSMD\.txt/);
});

test('worker owns WASM conversion so the UI thread stays responsive', async () => {
  const app = await readFile(new URL('../src/web/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/web/worker.js', import.meta.url), 'utf8');
  assert.match(app, /new Worker/);
  assert.match(app, /github\.com\/openmusx\/denigma\/issues'/);
  assert.doesNotMatch(app, /issues\/new/);
  assert.match(worker, /_denigma_convert/);
  assert.match(worker, /_denigma_result_score_name/);
  assert.match(worker, /_denigma_result_score_page_width_mm/);
  assert.match(worker, /_denigma_result_score_spatium_mm/);
  assert.match(worker, /_denigma_result_score_has_page_margins/);
  assert.match(worker, /_denigma_result_score_page_margin_left_sp/);
  assert.match(worker, /_denigma_result_part_page_width_mm/);
  assert.match(worker, /_denigma_result_part_spatium_mm/);
  assert.match(worker, /_denigma_result_part_has_page_margins/);
  assert.match(worker, /_denigma_result_part_page_margin_left_sp/);
  assert.match(worker, /_denigma_result_output_index/);
  assert.match(worker, /denigmaOnlineCommit: '__DENIGMA_ONLINE_COMMIT__'/);
  assert.match(worker, /postMessage\(\{ type: 'converted'/);
});

test('production builds include Apache caching and compressed WASM rules', async () => {
  const build = await readFile(new URL('../scripts/build-web.mjs', import.meta.url), 'utf8');
  const apache = await readFile(new URL('../deploy/apache.htaccess', import.meta.url), 'utf8');

  assert.match(build, /apache\.htaccess.*\.htaccess/);
  assert.match(apache, /max-age=31536000, immutable/);
  assert.match(apache, /Content-Encoding "gzip"/);
  assert.match(apache, /Content-Type "application\/wasm"/);
  assert.match(apache, /Content-Type "text\/javascript"/);
  assert.match(apache, /Content-Security-Policy/);
  assert.match(apache, /'wasm-unsafe-eval' 'unsafe-eval'/);
});

test('the WebAssembly module comes from Denigma, prebuilt or built by its own project', async () => {
  const cmake = await readFile(new URL('../CMakeLists.txt', import.meta.url), 'utf8');

  // Denigma owns the module's build; this project neither compiles a wrapper of
  // its own nor sets Denigma's compiler options or build flags for it.
  assert.doesNotMatch(cmake, /add_executable|add_library|target_link_options|CMAKE_CXX_FLAGS|denigma_BUILD_/);
  assert.match(cmake, /scripts\/fetch-denigma-wasm\.mjs/);
  assert.match(cmake, /ExternalProject_Add\(denigma/);
  assert.match(cmake, /--target denigma_wasm/);
  assert.match(cmake, /-DDENIGMA_CXX_STANDARD=20/);
  assert.match(cmake, /set\(_denigma_binary_dir "\$\{DENIGMA_SOURCE_DIR\}\/build-wasm"\)/);
  assert.match(cmake, /BUILD_ALWAYS TRUE/);
  // A local checkout is always built from its working tree, never downloaded.
  assert.match(cmake, /if\(NOT DENIGMA_SOURCE_DIR AND DENIGMA_WASM_PREBUILT\)/);
});

test('VS Code setup generates Emscripten presets for the CMake Build button', async () => {
  const setup = await readFile(new URL('../scripts/setup-vscode.mjs', import.meta.url), 'utf8');
  const cmake = await readFile(new URL('../CMakeLists.txt', import.meta.url), 'utf8');

  assert.match(setup, /em-config/);
  assert.match(setup, /CMakeUserPresets\.json/);
  assert.match(setup, /Emscripten\.cmake/);
  assert.match(setup, /targets: \['web_dist'\]/);
  assert.match(setup, /PATH: environment\.PATH/);
  assert.match(setup, /DENIGMA_SOURCE_DIR: ''/);
  assert.match(cmake, /add_custom_target\(web_dist ALL/);
});

test('VS Code template is valid and exposes the onboarding workflow', async () => {
  const settings = await readJson('../.vscode_template/settings.json');
  const extensions = await readJson('../.vscode_template/extensions.json');
  const launch = await readJson('../.vscode_template/launch.json');
  const tasks = await readJson('../.vscode_template/tasks.json');

  assert.equal(settings['cmake.configureOnOpen'], false);
  assert.equal(settings['cmake.configureOnEdit'], true);
  assert.equal(settings['cmake.automaticReconfigure'], true);
  assert.equal(settings['cmake.useCMakePresets'], 'always');
  assert.equal(settings['cmake.loggingLevel'], 'debug');
  assert.equal(settings['cmake.revealLog'], 'always');
  assert.equal(settings['cmake.clearOutputBeforeBuild'], true);
  assert.ok(extensions.recommendations.includes('ms-vscode.cmake-tools'));
  assert.ok(launch.configurations.some(({ preLaunchTask }) => preLaunchTask === 'Dev: Build and serve'));

  const labels = new Set(tasks.tasks.map(({ label }) => label));
  for (const label of [
    'Environment: Check prerequisites',
    'WASM: Configure (pinned Denigma)',
    'WASM: Configure (local Denigma)',
    'WASM: Build site',
    'Test: All',
    'Dev: Build and serve'
  ]) {
    assert.ok(labels.has(label), `missing VS Code task: ${label}`);
  }
});
