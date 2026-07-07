# 4-instrument grid mode (2x2) alongside the existing 16-instrument grid (4x4)

## Context

BeatViz's live-performance visualizer (`CubeGrid.js`) is a fixed 4x4 `InstancedMesh` of 16 wireframe cubes, one per instrument, driven by MIDI notes 48-63 and matching keyboard/GUI triggers defined in `main.js`'s `INSTRUMENTS` object. Every array and loop in `CubeGrid.js` is hardcoded to 16.

We want a second, simpler mode: a 2x2 grid of just 4 instruments (Kick, Snare, Closed Hihat, Open Hihat — notes 48-51), selectable at runtime from the existing lil-gui control panel, for a more focused/simplified live-performance view. This is scoped entirely to the live-performance layer (MIDI/keyboard/GUI triggering the `CubeGrid`) — the sequencer/gamepad system (`SeqEngine`, `SeqUI`, `GamepadManager`) is currently disconnected from `main.js` (reverted earlier this session) and is explicitly out of scope here.

## Goals

- A GUI dropdown ("Grid Mode": 16 Instruments / 4 Instruments) that switches the `CubeGrid` between a 4x4 layout of all 16 instruments and a 2x2 layout of Kick/Snare/Closed HH/Open HH.
- The 2x2 mode is a genuine 2-column-by-2-row layout (not 4 of the 16 existing cubes hidden in a corner) — cubes are enlarged so the 4-pad grid occupies a similar visual footprint to the 16-pad grid.
- MIDI, keyboard, and GUI triggering for Kick/Snare/Closed HH/Open HH works identically in both modes (same notes, same keys, same synthesis).
- Closed HH / Open HH choke behavior (already implemented in `DrumSynth._chokeOpenHihat`) is unaffected — it doesn't depend on the grid at all.

## Non-goals

- No changes to the sequencer/gamepad system (`SeqEngine.js`, `SeqUI.js`, `GamepadManager.js`, `KeyboardGamepad.js`) — none of it is wired into `main.js` right now, and this feature doesn't reconnect it.
- No persistence of the selected mode across page reloads — every load starts in 16-instrument mode.
- No changes to the "Macros" GUI folder (its per-column volume macros span both kept and hidden instruments; reworking it per-mode is a larger, separate concern not requested here).
- No note-to-cube remapping table — see Architecture below for why a plain modulo now suffices.

## Architecture

`CubeGrid`'s constructor gains a `padCount` parameter (default 16, or 4). Internally:
- `gridSize = Math.sqrt(padCount)` (2 or 4) drives the row/column layout math that already exists (`ix = i % gridSize`, `iz = Math.floor(i / gridSize)`).
- Every array currently sized to a literal 16 (`this.pads`, `this.padColors`, `brightnessData`, `padColorData`, `volLevels`) is sized to `padCount` instead, and every `for (let i = 0; i < 16; i++)` loop in the class (`init`, `update`, `setCC`, `_restoreNormalColors`, etc.) iterates `padCount` instead.
- In 4-instrument mode, `cellSize` is doubled (`0.9 → 1.8`) so the 2x2 grid's total footprint is comparable to the 4x4 grid's; `gap` stays at its current value (`0.25`) unchanged in both modes. `gridOffset`'s existing formula already accounts for `gridSize`/`cellSize`/`gap`, so no other geometry math changes.

Switching modes is infrequent (a GUI dropdown click), so `Visualizer` handles it by **disposing the current `CubeGrid` and constructing a new one** with the new `padCount`, rather than trying to resize an existing `InstancedMesh` in place (Three.js instance counts are fixed at creation). `Visualizer` gains a `setGridMode(padCount)` method: it removes the old mesh from `gridGroup`, disposes its geometry/material, and creates+adds a fresh `CubeGrid(this.gridGroup, this.renderer, padCount)`. Any in-flight bounce/flash animation on the old grid is simply discarded — acceptable since this is a rare, deliberate user action, not a per-frame concern.

**Note-to-cube mapping simplification:** the 4-instrument set (Kick=48, Snare=49, Closed HH=50, Open HH=51) is sequential starting at the same base note (48) as the 16-instrument set, and in exactly the row-major order needed for the 2x2 layout (Kick=index 0 top-left, Snare=index 1 top-right, Closed HH=index 2 bottom-left, Open HH=index 3 bottom-right). This means **no explicit note→cube lookup table is needed** — `Visualizer.triggerNote(note, velocity)` computes `cellIndex = note % padCount` and `hue = cellIndex / padCount`, using whatever `padCount` is currently active. `Visualizer` tracks its own `this.padCount` (updated by `setGridMode`) instead of the current hardcoded `% 16`.

## GUI changes (`main.js`)

- A new dropdown control at the top of the lil-gui panel (before the "Visual" folder): `gui.add(gridModeParams, 'mode', ['16 Instruments', '4 Instruments']).name('Grid Mode')`, defaulting to `'16 Instruments'`. Its `onChange` handler calls `visualizer.setGridMode(4 or 16)` and toggles GUI folder visibility (below).
- When switching to 4-instrument mode: the individual per-instrument folders for the 12 unused instruments (Snare stays, so: Closed HH stays, Open HH stays, Kick stays — the 12 that hide are Tom High, Clap, Clave, Crash, Tom Mid, Rimshot, Shaker, Ride, Tom Low, Cowbell, Tambourine, Conga) are hidden via lil-gui's `folder.hide()`, along with their corresponding rows in the "MIDI Routing" folder. Switching back to 16-instrument mode calls `folder.show()` on all of them.
- The "Macros" folder is left completely untouched in both modes (see Non-goals).
- MIDI/keyboard triggering logic in `main.js` (the `noteOn` handler and `setupKeyboard()`) is unaffected — Kick/Snare/Closed HH/Open HH already trigger identically today; the other 12 instruments' handlers simply won't produce a visible cube reaction in 4-instrument mode (their notes fall outside `0..padCount-1` after the modulo, so `CubeGrid.trigger()`'s existing bounds check silently ignores them) — sound synthesis for hidden instruments is also moot since their GUI/MIDI paths are hidden/unused, not actively blocked, which is fine since nothing will actually invoke them once their controls are hidden.

## Error handling / edge cases

- **Mesh disposal:** `setGridMode` must remove the old `CubeGrid`'s mesh from `gridGroup` and call `.dispose()` on its geometry and material before creating the new one, to avoid leaking GPU resources across repeated mode toggles.
- **Mid-animation switch:** if the user switches modes while cubes are mid-bounce or mid-flash, that animation state is discarded with the old mesh — no special handling needed.
- **Notes outside the active range:** already handled by `CubeGrid.trigger()`'s existing `if (index >= 0 && index < 16)` bounds check (generalized to `padCount`) — a stray note that maps outside range is a no-op, not an error.

## Testing

No test framework exists in this repo (no `package.json`, no test runner) — verification is manual: start the dev server, use the GUI dropdown to switch modes, and confirm (a) the 2x2 grid renders centered and appropriately sized, (b) Kick/Snare/Closed HH/Open HH still trigger via MIDI/keyboard/GUI in both modes, (c) the 12 other instruments' GUI folders hide/show correctly, and (d) switching modes repeatedly doesn't visibly leak or degrade performance.
