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

- `WASM: Configure (local Denigma)` when `../denigma` is available.
- `WASM: Configure (pinned Denigma)` to fetch the pinned commit.

After configuration, `WASM: Build site` is the default build task and
`Test: All` is the default test task. The Chrome and Edge launch configurations
build the site, start the local server, and open `http://127.0.0.1:8080/`. The
tasks use Node/npm and VS Code's platform-neutral command resolution on Windows,
macOS, and Linux.
