# Inspection and architecture notes

## Repositories inspected

The design was based on local checkouts of:

- `denigma-examples` commit `fdee3075f5c28118b80b9f650ca0bb974a62ea67`
- `denigma` commit `4916d16a5205e5fb389efffdcbd7824c05770cd4`
  (version 4.0.0)

The examples expose three small C functions, each in its own WASM build. They
copy a MUSX buffer into `BufferRandomAccessReader`, call a typed converter, and
copy one output string back. Those examples establish the supported Emscripten
settings and memory ownership pattern, but they do not expose diagnostics,
linked-part discovery, arbitrary MusicXML output selection, or all exporters in
one module.

## Denigma API findings

Denigma's actual conversion API is in `include/denigma/conversion.h` and the
three format headers:

- `MusxToEnigmaXmlConverter` is reader-backed and produces one stream.
- `MusxToMnxJsonConverter` is reader-backed and produces one stream.
- `MusxToMusicXmlMultiOutputConverter` is reader-backed and calls
  `MultiOutputCallback` once for the score and/or each linked part.
- `ConversionResult` contains typed diagnostics and marks error severity.
- `CommonOptions::logCallback` receives info, warning, error, and verbose
  messages. All of them are captured for diagnostic reports, but only warnings
  and errors appear in the on-screen diagnostic list; info and verbose messages
  are report-only.

Existing meaningful options are:

| Format | Denigma options exposed by the site |
| --- | --- |
| MusicXML | `includeTempoTool`, `allFontsAvailable`, `useFinaleRestPosition`, `cueLayer`, score/linked-part selection |
| MNX | `includeTempoTool`, `splitInstruments`, `indentSpaces`, `cueLayer` |
| EnigmaXML | None |

MusicXML's existing `allPartsAndScore` mode emits score first, followed by the
non-score `PartDefinition` array order. `partName` selects only the first prefix
match, so it cannot reliably represent duplicate names or arbitrary multiple
selection.

The wrapper therefore inspects `PartDefinition` objects through Denigma's
existing MUSX document construction path. It gives every displayed part its
stable converter output index. At conversion time Denigma performs its normal
multi-output export and the wrapper retains exactly the selected callback
indices. Names are presentation only, so duplicate or empty part names remain
unambiguous. Empty names use the same `Part <id>` fallback as Denigma.

This is the smallest integration-side API addition: no Finale XML parsing or
conversion logic is duplicated in JavaScript, and no unimplemented Denigma API
is assumed.

## Runtime structure

```text
index.html + app.js
        │ ArrayBuffer / transferable output buffers
        ▼
module Web Worker
        │ small C ABI with opaque result handles
        ▼
one Emscripten module
        │
        ├── denigma::musicxml
        ├── denigma::mnx
        └── denigma::enigmaxml
```

The C ABI returns opaque result handles with indexed getters for diagnostics,
parts, output names, and output byte spans. JavaScript copies transferable
output buffers before destroying the result. Input and result allocations are
released on every success and error path. The page revokes generated object
URLs before a new conversion and on `pagehide`.

Denigma's public converter adapters take the MUSX archive as bytes and extract it
on every call, which would mean re-inflating and re-deobfuscating the same file for
the inspection and then again for each conversion. The wrapper instead extracts
once into a module-level `CommandInputData` cache, keyed on the source name plus
the input size and an FNV-1a hash of its bytes, and drives the `detail` entry
points behind those adapters. A different file replaces the cached entry and
releases the previous extraction. EnigmaXML output needs no converter at all: it
is the cached primary buffer.

The parsed `musx::dom` document is still built per call, and MusicXML generation
still runs for every linked part even when only some are selected. Sharing a
parsed document across calls needs a document-taking entry point that Denigma does
not expose yet, and MusicXML parses with `PartVoicingPolicy::Apply` where
inspection and MNX use `Ignore`, so one cached document cannot serve all three.

The wrapper described above now lives in the Denigma repository as
`src/wasm/denigma_wasm.cpp`, built by Denigma's `denigma_wasm` target; this
repository consumes the resulting `denigma.js`/`denigma.wasm` pair (downloaded
from Denigma's CI for a pinned commit, or built by Denigma's own CMake project
from the pinned or a local source tree). Denigma's CMake configuration enables
Emscripten's `-fexceptions` at compile and link time before adding its
dependencies, which keeps exception handling consistent across the wrapper and
everything it links so conversion failures reach the wrapper's diagnostic
handling instead of aborting the WebAssembly runtime.

## Module lifetime

WebAssembly memory grows but never shrinks, so an instance keeps the peak heap of
the largest file it has converted. Loading a large score peaks well above the
document it produces, because the XML parser's tree exists alongside it. A
discarded instance's memory returns only when it is garbage collected, but
terminating a worker releases its whole heap at once.

Each worker therefore holds one instance for its whole life, and the page's
worker host (`src/web/worker-host.js`) terminates it and starts a fresh worker
for each new file and after any failed request, since an abort leaves the
instance unusable. A worker started after a failure receives the selected file
with its first request. The first worker compiles the WASM and returns the
compiled module to the page, which passes it to every later worker, so a fresh
worker only instantiates it.

MNX schema and semantic validation is a large share of MNX conversion time, so
it runs only when the MNX option "Validate MNX output" is checked. Its findings
then appear among the conversion's diagnostics.

The worker retains one selected input today. Its request/response messages and
per-result diagnostics already provide the seam for a future coordinator that
holds multiple files and schedules one conversion per file. No batch UI or
directory access is included in v1.

## Static production build

`scripts/build-web.mjs` hashes every immutable asset and substitutes only local,
relative module URLs. `index.html` is intentionally unhashed. The worker fetches
and compiles the hashed WASM URL itself and hands each instance to Emscripten
through `instantiateWasm`, so the generated module never depends on an unhashed
WASM alias.

The worker's one fetch is that same-origin WASM asset; every other network
request is a normal static module or stylesheet request.

## MNX preview

MNX previews use Viritura's standalone score engine and viewer, fetched for a
pinned `score-engine-v*` release by `scripts/fetch-viritura-viewer.mjs` and
checked against the distribution's `manifest.json`. The build publishes its
modules, `wasm/`, and `fonts/` under one content-hashed directory without
renaming any file, because the modules resolve those files and their layout
worker relative to their own URL. `preview.js` imports `score-viewer.js` only
when an MNX document is previewed.

OSMD stays the MusicXML previewer. The Viritura distribution renders MNX only,
and a MusicXML preview has to show the MusicXML file the user downloads rather
than a different conversion of the same score.

Denigma writes the score and each linked part as an entry in MNX `scores[]`,
named the same way the inspection names them (including the `Score` and
`Part <id>` fallbacks). The preview pairs each entry with the inspected page
size by name, converts the page size, spatium, and four margins to Viritura's
layout units, and relays out when another entry is selected. The viewer
creates canvases only for visible pages, so printing first exports every page
with `engine.toSvg` into print-only images.
