# Denigma Online

A small static website that converts Finale `.musx` files to MusicXML, MNX, or
EnigmaXML with Denigma WebAssembly. Conversion runs in a Web Worker and all
document data stays in the browser.

## What it does

- Reads one local MUSX file.
- Discovers the score and linked parts from that file.
- Exports any selection of score and linked parts as MusicXML.
- Exports MNX with Denigma's playback-tempo, instrument-splitting, cue-layer,
  and JSON-formatting options.
- Extracts EnigmaXML without presenting nonexistent options.
- Preserves Denigma diagnostics and builds a copyable GitHub issue report.
- Saves through the File System Access API where supported and falls back to a
  standard browser download.
- Runs conversion off the UI thread and supports repeated conversions without
  reloading the page.
- Lazily loads OpenSheetMusicDisplay when a generated MusicXML document is
  explicitly previewed, then renders the complete document using page dimensions
  effective spatium size, and page margins read directly from musxdom's resolved
  score or linked-part page format. The preview recalculates OSMD's scale when
  resized so the spatium remains proportional to the page. Because OSMD accepts
  only one global margin set, the preview uses the resolved first-page vertical
  margins and the average of its left and right margins throughout.

There is no backend, service worker, analytics, telemetry, CDN, remote font, or
third-party runtime service. OSMD is bundled locally and is not downloaded
unless a user opens a preview.

## Requirements

- CMake 3.24 or newer
- Emscripten (tested with 5.0.7)
- Node.js 20 or newer (build script and tests only)
- Git and network access for the initial Denigma/dependency fetch

### Development prerequisites

Run the cross-platform environment check after cloning:

```sh
npm run doctor
```

It verifies Node.js, CMake, Git, and Emscripten. Emscripten can already be on
`PATH`, or the tooling can activate an emsdk checkout found through
`DENIGMA_EMSDK`, `EMSDK`, `../emsdk`, or `~/emsdk`.

For an official emsdk checkout on macOS or Linux:

```sh
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 5.0.7
./emsdk activate 5.0.7
source ./emsdk_env.sh
```

For Windows PowerShell:

```powershell
git clone https://github.com/emscripten-core/emsdk.git
Set-Location emsdk
.\emsdk.bat install 5.0.7
.\emsdk.bat activate 5.0.7
.\emsdk_env.bat
```

Setting `DENIGMA_EMSDK` to the checkout directory lets this repository's
scripts activate it automatically without requiring VS Code to be launched from
that shell.

## Build

The default build uses the Denigma revision pinned by `DENIGMA_GIT_TAG_PIN` in
`CMakeLists.txt`. Changing that pin re-fetches Denigma on the next configure of
an existing build directory. To build a different revision without editing the
pin, configure with `-DDENIGMA_GIT_TAG_OVERRIDE=<commit>` (and clear it with
`-DDENIGMA_GIT_TAG_OVERRIDE=` to return to the pin).

```sh
npm ci
emcmake cmake -S . -B build-wasm -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build build-wasm --target web_dist -j2
npm test
npm run test:wasm
```

The deployable site is generated in `dist/`. The build hashes the WASM, module,
worker, application, preview, renderer, utility module, and CSS filenames and
writes their names to `dist/asset-manifest.json`. It also generates
maximum-compression `.wasm.gz` and OSMD `.js.gz` sidecars for servers with
static gzip support.

For development against a local Denigma checkout:

```sh
emcmake cmake -S . -B build-wasm \
  -DCMAKE_BUILD_TYPE=MinSizeRel \
  -DDENIGMA_SOURCE_DIR=../denigma
cmake --build build-wasm --target web_dist -j2
```

Denigma's own local dependency overrides can also be passed to CMake. See its
build documentation for `MUSX_LOCAL_PATH`, `MX_LOCAL_PATH`,
`MNXDOM_LOCAL_PATH`, and `SMUFL_MAPPING_LOCAL_PATH`.

## Visual Studio Code

Repository-local recommendations are tracked in `.vscode_template/`. Create the
local configuration with a platform-neutral command; `.vscode/` remains ignored
and can be customized locally:

```sh
npm run setup:vscode
```

If `.vscode/` already exists and you intentionally want to refresh its shared
files from the template, run `npm run setup:vscode:force`. Files unique to your
local directory are preserved.

The template provides tasks for pinned or local-Denigma configuration, the full
WASM/site build, web-only rebuilds, both test suites, and the local development
server. It also provides Chrome and Edge launch configurations. See
`.vscode_template/README.md` for the first-run sequence.

To run the prerequisite check in VS Code, select **Terminal → Run Task…**, then
select **Environment: Check prerequisites**. You can instead open the Command
Palette with **Cmd+Shift+P** on macOS or **Ctrl+Shift+P** on Windows/Linux,
select **Tasks: Run Task**, and then select **Environment: Check
prerequisites**. If the task is not listed after creating `.vscode`, run
**Developer: Reload Window** from the Command Palette. Running `npm run doctor`
in a terminal performs the same check.

A new contributor's shortest path is:

```sh
npm run setup:vscode
npm run doctor
npm run configure
npm run build
```

Use `npm run configure:local` instead when Denigma is checked out at
`../denigma`. After that, press F5 with the Chrome or Edge launch configuration;
it rebuilds the site and starts the local server automatically.

`setup:vscode` also generates an ignored local `CMakeUserPresets.json` for the
active Emscripten installation. CMake Tools' **Build** button uses that preset
to build `web_dist` as `MinSizeRel`, so no compiler kit is needed. The ignored,
machine-local preset records the `PATH` from the shell that runs
`setup:vscode`; no machine-specific paths are committed. Rerun
`npm run setup:vscode:force` from a shell where `npm run doctor` succeeds after
changing tool installations. Saving a CMake file automatically reconfigures
`build-wasm` with the preset; merely opening the workspace does not.

## Tests

```sh
npm test
npm run test:wasm
```

The Node unit suite covers filenames, duplicate part names, diagnostic reports,
privacy/accessibility markup, and the worker boundary. Run
`test:wasm` after `web_dist`; it inspects a checked-in linked-parts MUSX fixture,
exports the score, one part, score plus part, MNX, and EnigmaXML, and verifies
that invalid MUSX bytes fail with diagnostics. A successful production build
also proves that the unified C++ wrapper links against all three real Denigma
exporters.

## Deploy

Copy the contents of `dist/` to any static HTTP server. WebAssembly modules and
module workers require HTTP(S); opening `index.html` directly with a `file:` URL
is not supported. The build includes `dist/.htaccess` with the recommended
Apache/cPanel caching, precompressed WASM, MIME type, and security-header rules.
Make sure hidden files are included when copying or uploading `dist/`.

Recommended response headers:

```text
# index.html (and preferably 404/error HTML)
Cache-Control: no-cache

# /assets/* (all filenames are content-hashed)
Cache-Control: public, max-age=31536000, immutable

# *.wasm
Content-Type: application/wasm

# optional, recommended for the generated *.wasm.gz sidecar
Serve it as the corresponding *.wasm URL when Accept-Encoding includes gzip

# all responses
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'
```

The tracked Apache source is `deploy/apache.htaccess`. An nginx example is
included at `deploy/nginx.conf.example`; it enables `gzip_static` for the
generated WASM sidecar. The HTML also has a matching CSP meta tag, but an HTTP
header is preferable in production. The policy retains the narrow
`wasm-unsafe-eval` token and also allows `unsafe-eval` because Safari versions
without support for the narrower token otherwise block WebAssembly startup.

Do not enable request-body upload handlers for this location. The application
only performs normal `GET` requests for its own static assets.

## Privacy

The selected MUSX bytes are transferred from the page to a same-origin Web
Worker and copied into WebAssembly memory. Generated files return to the page as
local `Blob` objects. Previewed MusicXML remains in the page and is passed
directly to the locally bundled OSMD renderer. No source or output bytes are
sent over the network.

The diagnostic report contains the Denigma version and commit, the Denigma
Online commit and build hash, output format, settings, and Denigma messages.
Verbose messages are always included in the report but kept out of the
on-screen diagnostic list. The report never embeds source file contents.
Users can review the copied text before putting it in an issue.

## Browser support

The baseline workflow uses standard file inputs, `ArrayBuffer`, Web Workers,
WebAssembly, `Blob`, object URLs, and download links. It is intended for current
desktop Firefox, Chrome, Edge, and Safari.

Chromium browsers can show a native-style save picker. Firefox and Safari use
the download fallback. Multiple MusicXML results are listed separately and can
be saved individually; “Save all files” uses one directory picker when
available and otherwise starts a standard download for each result.

Browsers control the last open/download folder for standard dialogs. Chromium's
save picker receives a stable picker ID so it can remember its last location.
No directory handles are persisted by the application.

OSMD is fetched as a separate, immutable, content-hashed asset only after a
Preview button is used. Its BSD-3-Clause license link is likewise shown only
inside the opened preview panel.

## WASM size

The production build contains one binary with all three exporters:

```text
denigma.f5cbf0f18a89.wasm:    5,474,666 bytes (5.22 MiB)
denigma.f5cbf0f18a89.wasm.gz: 1,463,669 bytes (1.40 MiB)
```

This size was measured from the verified Emscripten 5.0.7 MinSizeRel build at
the configured Denigma revision. The single binary
shares Denigma, MUSX parsing, XML, compression, and exporter dependencies and is
cached under a content-hashed immutable URL. C++ exception catching is enabled
across Denigma and all linked dependencies so conversion failures can be
reported without terminating the WebAssembly runtime.

## Preview renderer size

OSMD is a separate optional download:

```text
osmd.056b0d9b68c5.js:    1,320,279 bytes (1.26 MiB)
osmd.056b0d9b68c5.js.gz:   332,304 bytes (324.5 KiB)
```

The browser requests neither this asset nor the 4,196-byte preview adapter
until a user clicks Preview. With the generated Apache configuration, opening a
preview therefore adds 336,500 transferred bytes beyond the normal application
load. Subsequent previews reuse the immutable cached renderer.

## Updating Denigma

1. Choose and review a Denigma commit that contains the desired converter API.
2. Change `DENIGMA_GIT_TAG_PIN` in `CMakeLists.txt` to the full commit hash.
3. Configure `build-wasm` and build `web_dist`. The configure step detects the
   changed pin and re-fetches Denigma, so a clean build directory is not
   required.
4. Run `npm test` and test all three formats with a MUSX containing linked
   parts, warnings, and playback tempo changes.
5. Record the new WASM byte size in this README.
6. Deploy the complete new `dist/` directory. Old hashed assets may be removed
   after the old HTML cache has expired.

The website's C++ wrapper deliberately uses Denigma's converter option structs,
`ConversionResult`, random-access reader, and MusicXML multi-output callback.
Review the wrapper whenever those public interfaces change.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the inspection findings,
API mapping, output-selection mechanism, and future batch-processing seam.

## License

MIT License. Copyright Robert G. Patterson. See [LICENSE](LICENSE).
