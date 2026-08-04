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
  messages. Verbose messages are always captured for diagnostic reports but
  filtered out of the on-screen diagnostic list.

Existing meaningful options are:

| Format | Denigma options exposed by the site |
| --- | --- |
| MusicXML | `includeTempoTool`, `cueLayer`, score/linked-part selection |
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

The root CMake configuration enables Emscripten's `-fexceptions` at compile and
link time before adding Denigma. This keeps exception handling consistent across
the wrapper and all linked dependencies, allowing conversion failures to reach
the wrapper's diagnostic handling instead of aborting the WebAssembly runtime.

The worker retains one selected input today. Its request/response messages and
per-result diagnostics already provide the seam for a future coordinator that
holds multiple files and schedules one conversion per file. No batch UI or
directory access is included in v1.

## Static production build

`scripts/build-web.mjs` hashes every immutable asset and substitutes only local,
relative module URLs. `index.html` is intentionally unhashed. The worker passes
the hashed WASM URL to Emscripten's `locateFile`, so the generated module never
depends on an unhashed WASM alias.

The application makes no fetch/XHR calls. Emscripten fetches its same-origin
WASM asset as part of module initialization; every other network request is a
normal static module or stylesheet request.
