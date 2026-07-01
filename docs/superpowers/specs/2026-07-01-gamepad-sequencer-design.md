# Gamepad-driven step sequencer on CubeGrid

## Context

BeatViz has two separate subsystems today:

- **CubeGrid** (`CubeGrid.js`): a 4x4 `InstancedMesh` where each of the 16 cubes is permanently bound to one instrument (kick, snare, toms, etc. — see `INSTRUMENTS` in `main.js`). Cubes flash on MIDI/keyboard trigger with a color derived from note hue.
- **Sequencer** (`SeqEngine.js` / `SeqUI.js`): a step sequencer limited to 4 tracks (Kick, Snare, Closed HH, Open HH), each with 16 steps. Steps are edited via a mouse-driven horizontal row UI (`SeqUI`), independent from CubeGrid.

We want to add gamepad control (Xbox/XInput-style controller, exposed to the browser via the standard Gamepad API) that repurposes CubeGrid itself as the step-editing surface, and extends the sequencer to cover all 16 instruments.

## Goals

- Connect a 4-button (A/B/X/Y) + D-pad gamepad and use it to program step patterns directly on the existing CubeGrid, without a separate step-grid UI.
- Extend the sequencer engine from 4 to 16 tracks (one per instrument) so every instrument is programmable.
- Keep existing MIDI/keyboard live-trigger behavior working unmodified when no gamepad is connected.

## Non-goals

- No support for MIDI controllers driving step navigation/editing (MIDI keeps its current role: live triggering + CC learn).
- No per-step velocity/condition editing via gamepad (that still requires the existing popover, which will no longer be reachable once `SeqUI` step rows are removed — acceptable, out of scope for this project).
- No multi-gamepad support; only the first detected controller is used.
- No support for non-"standard"-mapping gamepads; unsupported controllers are ignored with a console warning.

## Button mapping

| Control | Action |
|---|---|
| D-pad (↑↓←→) | Move cursor within the 4x4 grid. One discrete step per press — no auto-repeat on hold. |
| B | Toggle the step at the cursor position, for the currently active instrument. |
| Y | Next instrument (cycles through all 16; cursor position is preserved). |
| X | Previous instrument (cycles through all 16; cursor position is preserved). |
| A | Play / Stop the sequencer. |

Instrument cycle order (Y = next, X = previous), matching `INSTRUMENTS` declaration order in `main.js`:

Kick → Snare → ClosedHH → OpenHH → TomHigh → Clap → Clave → Crash → TomMid → Rimshot → Shaker → Ride → TomLow → Cowbell → Tambourine → Conga → (wraps to Kick)

## Architecture

### `GamepadManager.js` (new)

Mirrors `MidiManager.js`'s event-emitter shape. No dedicated `requestAnimationFrame` loop — it exposes a `poll()` method called once per frame from inside `Visualizer.js`'s existing render loop (which already runs continuously via the WebGPU renderer).

- Listens for native `gamepadconnected` / `gamepaddisconnected` browser events, tracks the first detected gamepad's index; ignores any additional controllers.
- On `poll()`, reads `navigator.getGamepads()[index]`, requires `gamepad.mapping === 'standard'` (satisfied by XInput controllers in Chrome/Edge on Windows) — if not, logs a console warning once and does nothing further.
- Diffs current button/axis state against the previous frame's snapshot to detect rising edges only (press, not hold — no repeat-while-held).
- Emits: `connected`, `disconnected`, `dpad` (`'up'|'down'|'left'|'right'`), `button` (`'A'|'B'|'X'|'Y'`).
- Standard mapping indices used: buttons 0-3 = A/B/X/Y, buttons 12-15 = D-pad up/down/left/right.

### `SeqEngine.js` (modified)

- `createPattern()` builds 16 tracks (one per `INSTRUMENTS` entry, same order) instead of 4.
- `_fireSoundAt` resolves the instrument by name and calls `drumSynth[name](vel)` generically (mirroring the dispatch already used for MIDI/keyboard in `main.js`), instead of a 4-case `switch`. Track 0 (kick) keeps its special-cased melodic `midiNote` behavior; no other track has per-step note editing.
- `loadPattern` backfills any missing tracks (e.g. a previously saved 4-track pattern) with fresh default 16-step tracks, so old `localStorage` slots/autosave don't break when loaded after this change.

### `CubeGrid.js` (modified)

Gains an `editMode` boolean, toggled by `main.js` on gamepad connect/disconnect:

- **`editMode = false` (default, no gamepad):** unchanged — each cube is a fixed instrument, live-trigger flashes render on their own dedicated cube as today.
- **`editMode = true`:** the 16 cubes represent the 16 steps of whichever instrument is currently selected. A new `setEditState({ instrumentIdx, cursorIndex, activeSteps, playheadIndex })` method recomputes `aBrightness` / `aPadColor` per cube per the approved visual scheme:
  - empty step → dim gray fill
  - active (marked) step → dim orange fill
  - cursor position → bright white ring/border, combinable with any fill state
  - playhead (currently sounding, only for the displayed instrument's track) → bright yellow glow, combinable with active-step fill
- A separate `flashGlobal(hue)` method drives a brief whole-grid pulse tinted by a note's hue. While `editMode` is on, this replaces the old fixed-cube flash for **any** live trigger (MIDI, keyboard, or another track firing during playback) — since there's no single fixed cube per instrument anymore in this mode.

### `main.js` (modified)

- Instantiates `GamepadManager`, keeps `currentInstrumentIdx` (persists across instrument switches) and `cursorIndex` in local state.
- `dpad` events move `cursorIndex` within the 4x4 grid; `B` calls `seqEngine.toggleStep(currentInstrumentIdx, cursorIndex)`; `Y`/`X` cycle `currentInstrumentIdx`; `A` toggles play/stop on `seqEngine`.
- On `connected`/`disconnected`, toggles `cubeGrid.editMode` (state — `currentInstrumentIdx`/`cursorIndex` — is kept in memory across a disconnect/reconnect, not reset).
- `SeqEngine.onStepFire(trackIdx, stepIdx)`: if `trackIdx === currentInstrumentIdx`, feeds `playheadIndex` into `cubeGrid.setEditState`; otherwise calls `cubeGrid.flashGlobal(hue)` for that track's instrument note (same treatment as a live MIDI trigger).

### `SeqUI.js` / sequencer panel (modified)

Step rows are removed. The panel keeps only its existing header controls: BPM, swing, Play/Stop, save/load slots — unchanged behavior, just no step-row rendering underneath. It does not grow to 16 rows.

## Error handling / edge cases

- **Old saved patterns (4 tracks):** `loadPattern` pads missing tracks with fresh defaults rather than throwing, so existing slots/autosave in `localStorage` keep working.
- **Non-standard gamepad mapping:** ignored with a one-time console warning; no attempt to guess a custom mapping.
- **Multiple gamepads connected:** only the first detected index is used; others are ignored (no controller-picker UI).
- **Disconnect/reconnect:** `editMode` turns off on disconnect (grid reverts to normal instrument view) and back on upon reconnect, resuming the last `currentInstrumentIdx`/`cursorIndex`.

## Verification

No gamepad hardware is available in the dev/preview environment used for this work, so real-device verification (Xbox/XInput controller over USB or Bluetooth, in Chrome or Edge) has to be done by the user. During implementation, a small on-screen debug overlay will show the raw detected gamepad state (connected index, mapping, live button/axis values) to make that manual test easier; it can be hidden or removed once confirmed working.
