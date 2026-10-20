# VS Code workspace template

Create the local `.vscode` directory with the cross-platform setup command:

```sh
npm run setup:vscode
```

The active `.vscode` directory is ignored by Git, so you can customize it
without changing tracked repository files. The setup command refuses to
overwrite an existing `.vscode` directory. To replace the template-provided
files in an existing directory intentionally, run:

```sh
npm run setup:vscode:force
```

After copying, open the Extensions view and install the workspace
recommendations.

Run the prerequisite check first:

1. In VS Code, select **Terminal → Run Task…**. Alternatively, open the Command
   Palette with **Cmd+Shift+P** on macOS or **Ctrl+Shift+P** on Windows/Linux,
   then select **Tasks: Run Task**.
2. Select **Environment: Check prerequisites**.

If the task does not appear after creating `.vscode`, run **Developer: Reload
Window** from the Command Palette. The same check can always be run from a
terminal with `npm run doctor`.

The check verifies Node.js, CMake, Git, and Emscripten and reports actionable
failures. Emscripten is found through the current `PATH`, `DENIGMA_EMSDK`,
`EMSDK`, a sibling `../emsdk` checkout, or `~/emsdk`; detected emsdk
installations are activated for child build tasks.

Before the first build, run one of these tasks from **Terminal → Run Task**:

- `WASM: Configure (local Denigma)` when `../denigma` is available; the site
  is then built from that checkout's working tree.
- `WASM: Configure (pinned Denigma)` to use the module Denigma's CI built for
  the pinned commit (sign in with `gh auth login` or set `GITHUB_TOKEN` so it
  can be downloaded), building Denigma from source only if there is none.
- `WASM: Configure (pinned Denigma, build from source)` to build the pinned
  commit from source regardless.

After configuration, `WASM: Build site` is the default build task and
`Test: All` is the default test task. The Chrome and Edge launch configurations
build the site, start the local server, and open `http://127.0.0.1:8080/`. The
tasks use Node/npm and VS Code's platform-neutral command resolution on Windows,
macOS, and Linux.

The setup command also detects the active Emscripten installation and generates
an ignored local `CMakeUserPresets.json`. CMake Tools' **Build** button then uses
that preset to build the `web_dist` target; no compiler kit is needed. The ignored, machine-local preset records the `PATH` from the shell that
runs `setup:vscode`; no machine-specific paths are committed. Rerun
`npm run setup:vscode:force` from a shell where `npm run doctor` succeeds after
changing tool installations.

Saving `CMakeLists.txt` or another CMake file immediately reconfigures
`build-wasm` with the Emscripten preset. Opening the workspace does not configure
automatically. Configure and build operations reveal the CMake output channel
without stealing focus from selection prompts. Build operations clear previous
output when they start.

For a server already running on port 8080, select **Denigma Online: Chrome
(running server)** in Run and Debug and press **F5**. This profile rebuilds the
web assets without starting a second server. Otherwise, use **Denigma Online:
Chrome**, which builds and starts the server automatically. Debugger file paths
resolve to the generated `dist/` directory.

To test legacy input, open `tests/data/F100-note.mus` or
`tests/data/F2008-parts-voiced.mus` in the site's file picker, or drag it onto the
page. The first legacy import downloads the configured support ZIP; subsequent
imports use the browser cache. Select a custom MacSymbolFonts.txt to test the
remembered override, or use Restore default to remove it.
