# 4-Instrument Grid Mode (2x2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GUI dropdown that switches BeatViz's live-performance `CubeGrid` between the existing 4x4 layout of 16 instruments and a new 2x2 layout of just Kick/Snare/Closed HH/Open HH.

**Architecture:** `CubeGrid` gains a `padCount` constructor parameter (4 or 16) so every array/loop that's currently hardcoded to 16 sizes itself dynamically instead. `Visualizer` tracks the active `padCount`, computes `cellIndex`/`hue` from it (instead of the hardcoded `% 16`), and exposes `setGridMode(padCount)` which disposes the current grid mesh and constructs a fresh `CubeGrid` with the new size. `main.js` adds a "Grid Mode" dropdown at the top of the lil-gui panel that calls `setGridMode` and hides/shows the 12 unused instruments' GUI folders + MIDI Routing rows.

**Tech Stack:** Vanilla ES modules, Three.js r171 (WebGPU renderer, TSL shaders), lil-gui. No build step, no test runner — verification is manual (dev server + browser).

**Dev server:** `npx http-server c:/beatviz -p 8080 --cors -c-1`

---

## Task 1: `CubeGrid.js` — parameterize by `padCount`

**Files:**
- Modify: `CubeGrid.js` (full rewrite — every place currently hardcoded to `16` or `4` becomes `this.padCount`/`this.gridSize`)

**Context:** Today `CubeGrid`'s constructor takes `(scene, renderer)` and hardcodes 16 everywhere: the `pads` array, `padColors`, `brightnessData`, `padColorData`, `volLevels`, the `InstancedMesh` instance count, every `for (let i = 0; i < 16; i++)` loop, and the row/column math (`i % 4`, `Math.floor(i / 4)`). This task makes all of that derive from a new `padCount` constructor parameter (default 16), so the class can also be constructed with `padCount = 4` for a 2x2 layout. `cellSize` becomes `1.8` instead of `0.9` when `padCount` is 4, so the 2x2 grid's total footprint is comparable to the 4x4 grid's (per the approved design — this is a deliberate, specific choice, not a general formula). `gap` stays `0.25` in both cases.

- [ ] **Step 1: Replace the whole file**

```js
import * as THREE from 'three';
import { attribute, mix, color as tslColor, float } from 'three/tsl';

export class CubeGrid {
    constructor(scene, renderer, padCount = 16) {
        this.scene = scene;
        this.renderer = renderer;
        this.padCount = padCount;
        this.gridSize = Math.sqrt(padCount);
        this.cellSize = padCount === 16 ? 0.9 : 1.8;
        this.gap = 0.25;
        this.gridOffset = (this.gridSize * this.cellSize + (this.gridSize - 1) * this.gap) / 2;

        this.pads = [];
        for (let i = 0; i < this.padCount; i++) {
            this.pads.push({
                height: 0.2,
                velocity: 0,
                restHeight: 0.2,
                isActive: 0
            });
        }

        this.impulseDirection = 1.0;

        this.springK      = 30.0;
        this.damping      = 0.92;
        this.decaySpeed   = 2.0;
        this.impulseForce = 15.0;

        this.uBaseColor = new THREE.Color(0x111111);
        this.uOpacity = 0.9;

        this.padColors = Array.from({ length: this.padCount }, (_, i) =>
            new THREE.Color().setHSL(i / this.padCount, 1.0, 0.5)
        );

        this.editMode = false;
        this._editState = { instrumentIdx: 0, cursorIndex: 0, steps: null, playheadIndex: -1 };
        this._flashBrightness = 0;
        this._flashHue = 0;
        this._flashDecaySpeed = 6.0;

        this.init();
    }

    init() {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        geometry.translate(0, 0.5, 0);

        this.brightnessData = new Float32Array(this.padCount).fill(0);
        this.instanceBrightness = new THREE.InstancedBufferAttribute(this.brightnessData, 1);
        geometry.setAttribute('aBrightness', this.instanceBrightness);

        this.padColorData = new Float32Array(this.padCount * 3);
        for (let i = 0; i < this.padCount; i++) {
            this.padColorData[i * 3]     = this.padColors[i].r;
            this.padColorData[i * 3 + 1] = this.padColors[i].g;
            this.padColorData[i * 3 + 2] = this.padColors[i].b;
        }
        this.instancePadColor = new THREE.InstancedBufferAttribute(this.padColorData, 3);
        geometry.setAttribute('aPadColor', this.instancePadColor);

        this.volLevels = new Float32Array(this.padCount).fill(1.0);

        const aBrightness = attribute('aBrightness', 'float');
        const aPadColor   = attribute('aPadColor',   'vec3');
        const baseColorNode = tslColor(this.uBaseColor);
        const hdrColor = aPadColor.mul(float(4.0));
        const colorNode = mix(baseColorNode, hdrColor, aBrightness);

        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            opacity: this.uOpacity,
            wireframe: true,
        });
        material.colorNode = colorNode;

        this.mesh = new THREE.InstancedMesh(geometry, material, this.padCount);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < this.padCount; i++) {
            const ix = i % this.gridSize;
            const iz = Math.floor(i / this.gridSize);
            const cx = ix * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;
            const cz = iz * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;

            dummy.position.set(cx, 0, cz);
            dummy.scale.set(this.cellSize, 0.2, this.cellSize);
            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.mesh);
    }

    trigger(index, velocity, hue) {
        if (this.editMode) {
            this._flashHue = hue;
            this._flashBrightness = Math.max(this._flashBrightness, velocity);
            return;
        }
        if (index >= 0 && index < this.padCount) {
            this.pads[index].restHeight = 0.2 * this.impulseDirection;
            this.pads[index].velocity = velocity * this.impulseForce * this.impulseDirection;
            this.pads[index].isActive = 1.0;
            this.impulseDirection *= -1.0;

            this.padColors[index].setHSL(hue, 1.0, 0.5);
            this._applyPadColor(index);
        }
    }

    update(delta) {
        const dummy = new THREE.Object3D();
        let needsMatrixUpdate = false;
        let needsBrightnessUpdate = false;

        for (let i = 0; i < this.padCount; i++) {
            const pad = this.pads[i];

            pad.height += pad.velocity * delta;
            const diff = pad.height - pad.restHeight;
            pad.velocity -= diff * this.springK * delta;
            pad.velocity *= this.damping;

            if (Math.abs(diff) < 0.01 && Math.abs(pad.velocity) < 0.01) {
                pad.height = pad.restHeight;
                pad.velocity = 0;
            }

            if (pad.velocity !== 0 || pad.isActive > 0 || Math.abs(pad.height - pad.restHeight) > 0.001) {
                const ix = i % this.gridSize;
                const iz = Math.floor(i / this.gridSize);
                const cx = ix * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;
                const cz = iz * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;

                dummy.position.set(cx, 0, cz);
                dummy.scale.set(this.cellSize, pad.height, this.cellSize);
                dummy.updateMatrix();
                this.mesh.setMatrixAt(i, dummy.matrix);
                needsMatrixUpdate = true;
            }

            if (!this.editMode) {
                if (pad.isActive > 0) {
                    pad.isActive -= delta * this.decaySpeed;
                    if (pad.isActive < 0) pad.isActive = 0;
                    this.brightnessData[i] = pad.isActive;
                    needsBrightnessUpdate = true;
                } else if (this.brightnessData[i] !== 0) {
                    this.brightnessData[i] = 0;
                    needsBrightnessUpdate = true;
                }
            }
        }

        if (this.editMode && this._flashBrightness > 0) {
            this._flashBrightness -= delta * this._flashDecaySpeed;
            if (this._flashBrightness < 0) this._flashBrightness = 0;
            for (let i = 0; i < this.padCount; i++) {
                this.padColors[i].setHSL(this._flashHue, 1.0, 0.5);
                this._applyPadColor(i, true);
                this.brightnessData[i] = this._flashBrightness;
            }
            needsBrightnessUpdate = true;
            if (this._flashBrightness === 0) this._renderEditState();
        }

        if (needsMatrixUpdate) this.mesh.instanceMatrix.needsUpdate = true;
        if (needsBrightnessUpdate) this.instanceBrightness.needsUpdate = true;
    }

    setCC(cc, value) {
        if (cc === 24) {
            for (let i = 0; i < this.padCount; i++) {
                this.padColors[i].setHSL((i / this.padCount + value) % 1.0, 1.0, 0.5);
                this._applyPadColor(i);
            }
        }
        if (cc === 25) {
            this.uBaseColor.setHSL(0, 0, value);
        }
        if (cc === 26) {
            this.uOpacity = 0.1 + (value * 0.9);
            this.mesh.material.opacity = this.uOpacity;
        }
    }

    setCellVol(index, vol) {
        if (index >= 0 && index < this.padCount) {
            this.volLevels[index] = vol;
            this._applyPadColor(index);
        }
    }

    setEditMode(active) {
        this.editMode = active;
        this._flashBrightness = 0;
        if (active) {
            this._renderEditState();
        } else {
            this._restoreNormalColors();
        }
    }

    setEditState({ instrumentIdx, cursorIndex, steps, playheadIndex }) {
        this._editState = { instrumentIdx, cursorIndex, steps, playheadIndex };
        if (this.editMode && this._flashBrightness === 0) this._renderEditState();
    }

    _renderEditState() {
        const { cursorIndex, steps, playheadIndex } = this._editState;
        for (let i = 0; i < this.padCount; i++) {
            let hue = 0, sat = 1.0, light = 0.18, brightness = 0.15; // empty step: dim gray-ish
            const isActive   = steps ? steps[i].active : false;
            const isPlayhead = i === playheadIndex;
            const isCursor   = i === cursorIndex;

            if (isActive)   { hue = 0.08; brightness = 0.35; }
            if (isPlayhead) { hue = 0.15; brightness = 1.0; }
            if (isCursor) {
                sat   = Math.min(sat, 0.3);
                light = 0.9;
                brightness = Math.max(brightness, 0.85);
            }

            this.padColors[i].setHSL(hue, sat, light);
            this._applyPadColor(i, true);
            this.brightnessData[i] = brightness;
        }
        this.instanceBrightness.needsUpdate = true;
    }

    _restoreNormalColors() {
        for (let i = 0; i < this.padCount; i++) {
            this.padColors[i].setHSL(i / this.padCount, 1.0, 0.5);
            this._applyPadColor(i);
            this.brightnessData[i] = this.pads[i].isActive;
        }
        this.instanceBrightness.needsUpdate = true;
    }

    _applyPadColor(index, skipVol = false) {
        const vol = skipVol ? 1.0 : this.volLevels[index];
        const c = this.padColors[index];
        this.padColorData[index * 3]     = c.r * vol;
        this.padColorData[index * 3 + 1] = c.g * vol;
        this.padColorData[index * 3 + 2] = c.b * vol;
        this.instancePadColor.needsUpdate = true;
    }

    setPhysics({ springK, damping, decaySpeed, impulseForce }) {
        if (springK      !== undefined) this.springK      = springK;
        if (damping      !== undefined) this.damping      = damping;
        if (decaySpeed   !== undefined) this.decaySpeed   = decaySpeed;
        if (impulseForce !== undefined) this.impulseForce = impulseForce;
    }
}
```

- [ ] **Step 2: Manual verification**

Start the dev server, open `http://localhost:8080` in a browser, click "Start Audio / MIDI". Nothing should look different yet (still constructed with the default `padCount = 16` from `Visualizer.js`, unchanged in this task). Check the browser console for errors — there should be none.

Then, in DevTools console (after clicking Start Audio), verify the class itself works standalone at both sizes:

```js
const { CubeGrid } = await import('./CubeGrid.js');
const fakeScene = { add: () => {} };
const g16 = new CubeGrid(fakeScene, null);
console.log(g16.padCount, g16.gridSize, g16.pads.length, g16.padColorData.length); // Expected: 16 4 16 48

const g4 = new CubeGrid(fakeScene, null, 4);
console.log(g4.padCount, g4.gridSize, g4.pads.length, g4.padColorData.length, g4.cellSize); // Expected: 4 2 4 12 1.8
```

- [ ] **Step 3: Commit**

```bash
git add CubeGrid.js
git commit -m "$(cat <<'EOF'
feat: parameterize CubeGrid by padCount for 4- and 16-instrument modes

Every array and loop that was hardcoded to 16 (pads, padColors,
brightnessData, padColorData, volLevels, the InstancedMesh instance
count, and the row/column layout math) now derives from a padCount
constructor parameter (default 16). A 4-pad grid uses gridSize=2 and a
doubled cellSize (1.8 vs 0.9) so its footprint is comparable to the
16-pad grid's. No behavior changes yet — Visualizer.js still always
constructs CubeGrid with the default padCount until the next task.
EOF
)"
```

---

## Task 2: `Visualizer.js` — track `padCount`, add `setGridMode`

**Files:**
- Modify: `Visualizer.js:9-27` (constructor), `Visualizer.js:56` (`init`, the `CubeGrid` construction call), `Visualizer.js:104-117` (`triggerNote`), add a new `setGridMode` method near the other passthrough methods (after `setPhysics`)

**Context:** `Visualizer.triggerNote(note, velocity)` currently computes `cellIndex = note % 16` and `hue = (note % 12) / 12` — both hardcoded to the 16-instrument case. This task makes both derive from `this.padCount` (which `Visualizer` now tracks), and adds `setGridMode(padCount)`, which `main.js` will call from the new GUI dropdown (Task 3) to swap the active `CubeGrid` for one with a different `padCount`. Switching modes is a rare, deliberate user action (a GUI dropdown click), so `setGridMode` just disposes the old mesh and constructs a fresh `CubeGrid` — no in-place resize logic needed.

- [ ] **Step 1: Add a `padCount` field to the constructor**

Replace:

```js
        this.grid = null;
        this.gridGroup = null;
        this.postProcessing = null;
```

with:

```js
        this.grid = null;
        this.gridGroup = null;
        this.padCount = 16;
        this.postProcessing = null;
```

- [ ] **Step 2: Pass `padCount` when constructing the initial grid**

Replace:

```js
        this.grid = new CubeGrid(this.gridGroup, this.renderer);
```

with:

```js
        this.grid = new CubeGrid(this.gridGroup, this.renderer, this.padCount);
```

- [ ] **Step 3: Make `triggerNote` use `this.padCount` instead of hardcoded 16**

Replace:

```js
    triggerNote(note, velocity) {
        const cellIndex = note % 16;
        const hue = (note % 12) / 12;
        if (this.grid) {
            this.grid.trigger(cellIndex, velocity, hue);
        }
        if (note === 48) {
            const sign = velocity >= 1.0 ? -1 : 1;
            this.rotVelocity += sign * velocity * this.rotImpulse;
        }
        if (note === 51) {
            this.rotDamping = 0.80 + Math.random() * 0.19; // 0.80–0.99
        }
    }
```

with:

```js
    triggerNote(note, velocity) {
        const cellIndex = note % this.padCount;
        const hue = cellIndex / this.padCount;
        if (this.grid) {
            this.grid.trigger(cellIndex, velocity, hue);
        }
        if (note === 48) {
            const sign = velocity >= 1.0 ? -1 : 1;
            this.rotVelocity += sign * velocity * this.rotImpulse;
        }
        if (note === 51) {
            this.rotDamping = 0.80 + Math.random() * 0.19; // 0.80–0.99
        }
    }
```

(The `note === 48`/`note === 51` grid-rotation behavior is pre-existing and unrelated to this feature — leave it exactly as-is.)

- [ ] **Step 4: Add `setGridMode`**

After `setPhysics` (before `setGamepadManager`), add:

```js

    setGridMode(padCount) {
        if (padCount === this.padCount) return;
        this.padCount = padCount;
        if (this.grid) {
            this.gridGroup.remove(this.grid.mesh);
            this.grid.mesh.geometry.dispose();
            this.grid.mesh.material.dispose();
        }
        this.grid = new CubeGrid(this.gridGroup, this.renderer, padCount);
    }
```

- [ ] **Step 5: Manual verification**

Start the dev server, open the page, click "Start Audio / MIDI". Confirm the grid still renders as a 4x4 (16 cubes) and that pressing keyboard keys Q/W/E/R (kick/snare/closed HH/open HH) still trigger the correct, differently-colored cubes as before (no regressions). Then in DevTools console, temporarily expose and drive the new method directly:

```js
// Temporarily add `window.__viz = visualizer;` right after
// `visualizer = new Visualizer('canvas-container');` in main.js's init(),
// then reload and re-click Start Audio before running this — remove the
// temporary line again once you're done.
window.__viz.setGridMode(4);
console.log(window.__viz.padCount, window.__viz.grid.padCount, window.__viz.grid.gridSize);
// Expected: 4 4 2 — grid visibly shrinks to a 2x2 layout of 4 larger cubes.
window.__viz.triggerNote(48, 1.0); // kick -> cellIndex 0
window.__viz.triggerNote(49, 1.0); // snare -> cellIndex 1
// Expected: two different cubes bounce/flash with two different colors, no console errors.
window.__viz.setGridMode(16);
console.log(window.__viz.padCount, window.__viz.grid.padCount, window.__viz.grid.gridSize);
// Expected: 16 16 4 — grid returns to the original 4x4 layout.
```

- [ ] **Step 6: Commit**

```bash
git add Visualizer.js
git commit -m "$(cat <<'EOF'
feat: add Visualizer.setGridMode for switching CubeGrid pad count

triggerNote's cellIndex/hue now derive from a tracked this.padCount
instead of a hardcoded 16. setGridMode(padCount) disposes the current
CubeGrid's mesh/geometry/material and constructs a fresh one at the
new size — mode switches are rare (a GUI dropdown click), so this is
simpler than resizing an InstancedMesh in place.
EOF
)"
```

---

## Task 3: `main.js` — Grid Mode dropdown + GUI folder/routing visibility

**Files:**
- Modify: `main.js:111-121` (top of `setupGUI`, to add the dropdown control), `main.js:400-432` (the "MIDI Routing" folder, to capture controller references for the 12 hidden instruments), `main.js:434-442` (end of `setupGUI`, to wire up the actual mode-switch logic once all folders/controllers exist)

**Context:** This is the user-facing piece: a "Grid Mode" dropdown at the very top of the lil-gui panel (`'16 Instruments'` / `'4 Instruments'`, defaulting to 16). Switching to "4 Instruments" calls `visualizer.setGridMode(4)` and hides the GUI folders + MIDI Routing rows for the 12 instruments that aren't Kick/Snare/Closed HH/Open HH (Tom High, Clap, Clave, Crash, Tom Mid, Rimshot, Shaker, Ride, Tom Low, Cowbell, Tambourine, Conga). Switching back to "16 Instruments" reverses both.

The dropdown control is created at the *top* of `setupGUI()` (per the approved design), but its actual mode-switching logic needs references to folder/controller variables that don't exist yet at that point in the function (they're created later, as `setupGUI()` builds out each instrument's folder). This is solved with a `let applyGridMode` placeholder, reassigned to the real function once everything it needs exists — safe because the dropdown's `onChange` callback can only ever fire after the user interacts with it, which is always after `setupGUI()` has finished running once.

Per the approved design, the "Macros" folder is **not** touched by this task — it's left exactly as-is in both modes.

- [ ] **Step 1: Add the dropdown control and the `applyGridMode` placeholder at the top of `setupGUI`**

Replace:

```js
function setupGUI() {
    const gui = new GUI({ title: 'BeatViz Controls', width: 260 });
    gui.domElement.style.maxHeight = '90vh';
    gui.domElement.style.overflowY = 'auto';

    const visualParams = {
```

with:

```js
function setupGUI() {
    const gui = new GUI({ title: 'BeatViz Controls', width: 260 });
    gui.domElement.style.maxHeight = '90vh';
    gui.domElement.style.overflowY = 'auto';

    // Reassigned further down, once the folders/controllers it needs exist.
    // Safe because this only ever runs in response to a later user interaction.
    let applyGridMode = () => {};
    const gridModeParams = { mode: '16 Instruments' };
    gui.add(gridModeParams, 'mode', ['16 Instruments', '4 Instruments'])
        .name('Grid Mode')
        .onChange(mode => applyGridMode(mode));

    const visualParams = {
```

- [ ] **Step 2: Capture controller references for the 12 hidden instruments in the MIDI Routing folder**

Replace (this is the block for Tom High, Tom Mid, Tom Low, Rimshot, Clap, Cowbell, Clave, Shaker, Tambourine, Crash, Ride, Conga — Kick/Snare/Closed HH/Open HH's rows just above this block are unchanged):

```js
    folderMidi.add(midiChParams, 'tomHighCh',       1,16,1).name('TomHigh Ch').onChange(v     => { INSTRUMENTS.tomHigh.channel     = v-1; });
    folderMidi.add(midiChParams, 'tomHighNote',     0,127,1).name('TomHigh Note').onChange(v  => { INSTRUMENTS.tomHigh.defaultNote = v; });
    folderMidi.add(midiChParams, 'tomMidCh',        1,16,1).name('TomMid Ch').onChange(v      => { INSTRUMENTS.tomMid.channel      = v-1; });
    folderMidi.add(midiChParams, 'tomMidNote',      0,127,1).name('TomMid Note').onChange(v   => { INSTRUMENTS.tomMid.defaultNote  = v; });
    folderMidi.add(midiChParams, 'tomLowCh',        1,16,1).name('TomLow Ch').onChange(v      => { INSTRUMENTS.tomLow.channel      = v-1; });
    folderMidi.add(midiChParams, 'tomLowNote',      0,127,1).name('TomLow Note').onChange(v   => { INSTRUMENTS.tomLow.defaultNote  = v; });
    folderMidi.add(midiChParams, 'rimshotCh',       1,16,1).name('Rimshot Ch').onChange(v     => { INSTRUMENTS.rimshot.channel     = v-1; });
    folderMidi.add(midiChParams, 'rimshotNote',     0,127,1).name('Rimshot Note').onChange(v  => { INSTRUMENTS.rimshot.defaultNote = v; });
    folderMidi.add(midiChParams, 'clapCh',          1,16,1).name('Clap Ch').onChange(v        => { INSTRUMENTS.clap.channel        = v-1; });
    folderMidi.add(midiChParams, 'clapNote',        0,127,1).name('Clap Note').onChange(v     => { INSTRUMENTS.clap.defaultNote    = v; });
    folderMidi.add(midiChParams, 'cowbellCh',       1,16,1).name('Cowbell Ch').onChange(v     => { INSTRUMENTS.cowbell.channel     = v-1; });
    folderMidi.add(midiChParams, 'cowbellNote',     0,127,1).name('Cowbell Note').onChange(v  => { INSTRUMENTS.cowbell.defaultNote = v; });
    folderMidi.add(midiChParams, 'claveCh',         1,16,1).name('Clave Ch').onChange(v       => { INSTRUMENTS.clave.channel       = v-1; });
    folderMidi.add(midiChParams, 'claveNote',       0,127,1).name('Clave Note').onChange(v    => { INSTRUMENTS.clave.defaultNote   = v; });
    folderMidi.add(midiChParams, 'shakerCh',        1,16,1).name('Shaker Ch').onChange(v      => { INSTRUMENTS.shaker.channel      = v-1; });
    folderMidi.add(midiChParams, 'shakerNote',      0,127,1).name('Shaker Note').onChange(v   => { INSTRUMENTS.shaker.defaultNote  = v; });
    folderMidi.add(midiChParams, 'tambourineCh',    1,16,1).name('Tambourine Ch').onChange(v  => { INSTRUMENTS.tambourine.channel  = v-1; });
    folderMidi.add(midiChParams, 'tambourineNote',  0,127,1).name('Tambourine Note').onChange(v=>{ INSTRUMENTS.tambourine.defaultNote = v; });
    folderMidi.add(midiChParams, 'crashCh',         1,16,1).name('Crash Ch').onChange(v       => { INSTRUMENTS.crash.channel       = v-1; });
    folderMidi.add(midiChParams, 'crashNote',       0,127,1).name('Crash Note').onChange(v    => { INSTRUMENTS.crash.defaultNote   = v; });
    folderMidi.add(midiChParams, 'rideCh',          1,16,1).name('Ride Ch').onChange(v        => { INSTRUMENTS.ride.channel        = v-1; });
    folderMidi.add(midiChParams, 'rideNote',        0,127,1).name('Ride Note').onChange(v     => { INSTRUMENTS.ride.defaultNote    = v; });
    folderMidi.add(midiChParams, 'congaCh',         1,16,1).name('Conga Ch').onChange(v       => { INSTRUMENTS.conga.channel       = v-1; });
    folderMidi.add(midiChParams, 'congaNote',       0,127,1).name('Conga Note').onChange(v    => { INSTRUMENTS.conga.defaultNote   = v; });
```

with:

```js
    const tomHighChCtrl     = folderMidi.add(midiChParams, 'tomHighCh',       1,16,1).name('TomHigh Ch').onChange(v     => { INSTRUMENTS.tomHigh.channel     = v-1; });
    const tomHighNoteCtrl   = folderMidi.add(midiChParams, 'tomHighNote',     0,127,1).name('TomHigh Note').onChange(v  => { INSTRUMENTS.tomHigh.defaultNote = v; });
    const tomMidChCtrl      = folderMidi.add(midiChParams, 'tomMidCh',        1,16,1).name('TomMid Ch').onChange(v      => { INSTRUMENTS.tomMid.channel      = v-1; });
    const tomMidNoteCtrl    = folderMidi.add(midiChParams, 'tomMidNote',      0,127,1).name('TomMid Note').onChange(v   => { INSTRUMENTS.tomMid.defaultNote  = v; });
    const tomLowChCtrl      = folderMidi.add(midiChParams, 'tomLowCh',        1,16,1).name('TomLow Ch').onChange(v      => { INSTRUMENTS.tomLow.channel      = v-1; });
    const tomLowNoteCtrl    = folderMidi.add(midiChParams, 'tomLowNote',      0,127,1).name('TomLow Note').onChange(v   => { INSTRUMENTS.tomLow.defaultNote  = v; });
    const rimshotChCtrl     = folderMidi.add(midiChParams, 'rimshotCh',       1,16,1).name('Rimshot Ch').onChange(v     => { INSTRUMENTS.rimshot.channel     = v-1; });
    const rimshotNoteCtrl   = folderMidi.add(midiChParams, 'rimshotNote',     0,127,1).name('Rimshot Note').onChange(v  => { INSTRUMENTS.rimshot.defaultNote = v; });
    const clapChCtrl        = folderMidi.add(midiChParams, 'clapCh',          1,16,1).name('Clap Ch').onChange(v        => { INSTRUMENTS.clap.channel        = v-1; });
    const clapNoteCtrl      = folderMidi.add(midiChParams, 'clapNote',        0,127,1).name('Clap Note').onChange(v     => { INSTRUMENTS.clap.defaultNote    = v; });
    const cowbellChCtrl     = folderMidi.add(midiChParams, 'cowbellCh',       1,16,1).name('Cowbell Ch').onChange(v     => { INSTRUMENTS.cowbell.channel     = v-1; });
    const cowbellNoteCtrl   = folderMidi.add(midiChParams, 'cowbellNote',     0,127,1).name('Cowbell Note').onChange(v  => { INSTRUMENTS.cowbell.defaultNote = v; });
    const claveChCtrl       = folderMidi.add(midiChParams, 'claveCh',         1,16,1).name('Clave Ch').onChange(v       => { INSTRUMENTS.clave.channel       = v-1; });
    const claveNoteCtrl     = folderMidi.add(midiChParams, 'claveNote',       0,127,1).name('Clave Note').onChange(v    => { INSTRUMENTS.clave.defaultNote   = v; });
    const shakerChCtrl      = folderMidi.add(midiChParams, 'shakerCh',        1,16,1).name('Shaker Ch').onChange(v      => { INSTRUMENTS.shaker.channel      = v-1; });
    const shakerNoteCtrl    = folderMidi.add(midiChParams, 'shakerNote',      0,127,1).name('Shaker Note').onChange(v   => { INSTRUMENTS.shaker.defaultNote  = v; });
    const tambourineChCtrl  = folderMidi.add(midiChParams, 'tambourineCh',    1,16,1).name('Tambourine Ch').onChange(v  => { INSTRUMENTS.tambourine.channel  = v-1; });
    const tambourineNoteCtrl= folderMidi.add(midiChParams, 'tambourineNote',  0,127,1).name('Tambourine Note').onChange(v=>{ INSTRUMENTS.tambourine.defaultNote = v; });
    const crashChCtrl       = folderMidi.add(midiChParams, 'crashCh',         1,16,1).name('Crash Ch').onChange(v       => { INSTRUMENTS.crash.channel       = v-1; });
    const crashNoteCtrl     = folderMidi.add(midiChParams, 'crashNote',       0,127,1).name('Crash Note').onChange(v    => { INSTRUMENTS.crash.defaultNote   = v; });
    const rideChCtrl        = folderMidi.add(midiChParams, 'rideCh',          1,16,1).name('Ride Ch').onChange(v        => { INSTRUMENTS.ride.channel        = v-1; });
    const rideNoteCtrl      = folderMidi.add(midiChParams, 'rideNote',        0,127,1).name('Ride Note').onChange(v     => { INSTRUMENTS.ride.defaultNote    = v; });
    const congaChCtrl       = folderMidi.add(midiChParams, 'congaCh',         1,16,1).name('Conga Ch').onChange(v       => { INSTRUMENTS.conga.channel       = v-1; });
    const congaNoteCtrl     = folderMidi.add(midiChParams, 'congaNote',       0,127,1).name('Conga Note').onChange(v    => { INSTRUMENTS.conga.defaultNote   = v; });
```

- [ ] **Step 3: Wire up `applyGridMode` once everything it needs exists**

Replace:

```js
    const clearParams = { clearAll: () => {
        ccMapper.assignments = {};
        ccMapper._save();
        // reload to reset all learn button labels
        location.reload();
    }};
    gui.add(clearParams, 'clearAll').name('Clear All CC');

    for (const folder of gui.folders) folder.close();
}
```

with:

```js
    const clearParams = { clearAll: () => {
        ccMapper.assignments = {};
        ccMapper._save();
        // reload to reset all learn button labels
        location.reload();
    }};
    gui.add(clearParams, 'clearAll').name('Clear All CC');

    const hideableFolders = [
        folderTomHigh, folderClap, folderClave, folderCrash,
        folderTomMid, folderRimshot, folderShaker, folderRide,
        folderTomLow, folderCowbell, folderTambourine, folderConga,
    ];
    const hideableMidiControllers = [
        tomHighChCtrl, tomHighNoteCtrl, tomMidChCtrl, tomMidNoteCtrl,
        tomLowChCtrl, tomLowNoteCtrl, rimshotChCtrl, rimshotNoteCtrl,
        clapChCtrl, clapNoteCtrl, cowbellChCtrl, cowbellNoteCtrl,
        claveChCtrl, claveNoteCtrl, shakerChCtrl, shakerNoteCtrl,
        tambourineChCtrl, tambourineNoteCtrl, crashChCtrl, crashNoteCtrl,
        rideChCtrl, rideNoteCtrl, congaChCtrl, congaNoteCtrl,
    ];

    applyGridMode = (mode) => {
        const is4 = mode === '4 Instruments';
        visualizer.setGridMode(is4 ? 4 : 16);
        for (const folder of hideableFolders) is4 ? folder.hide() : folder.show();
        for (const ctrl of hideableMidiControllers) is4 ? ctrl.hide() : ctrl.show();
    };

    for (const folder of gui.folders) folder.close();
}
```

- [ ] **Step 4: Manual verification**

Start the dev server, open the page, click "Start Audio / MIDI". Confirm:
- A "Grid Mode" dropdown appears at the very top of the GUI panel, above "Visual", showing "16 Instruments" by default.
- All folders start closed (unchanged prior behavior) and the grid renders as the normal 4x4.
- Switch the dropdown to "4 Instruments": the grid should visibly shrink to a 2x2 layout of 4 larger cubes, and the folders for Tom High, Clap, Clave, Crash, Tom Mid, Rimshot, Shaker, Ride, Tom Low, Cowbell, Tambourine, and Conga should disappear from the GUI panel (Kick, Snare, Closed HH, Open HH, Visual, Physics, Macros, MIDI Routing, and the Clear All CC button should all remain visible).
- Open the "MIDI Routing" folder and confirm the 12 hidden instruments' Ch/Note rows are gone, while Kick/Snare/Closed HH/Open HH's rows remain.
- Press keyboard keys Q (kick), W (snare), E (closed HH), R (open HH) — all four should still trigger sound and a visible cube reaction on the 2x2 grid.
- Switch the dropdown back to "16 Instruments": the grid returns to 4x4, and all 12 folders + MIDI Routing rows reappear.
- Toggle back and forth a few times rapidly — check the browser console for errors (there should be none; this also exercises `setGridMode`'s mesh disposal path repeatedly).

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "$(cat <<'EOF'
feat: add Grid Mode dropdown to switch between 16 and 4 instruments

New "Grid Mode" control at the top of the lil-gui panel calls
Visualizer.setGridMode(4|16) and shows/hides the GUI folders + MIDI
Routing rows for the 12 instruments outside Kick/Snare/Closed HH/Open
HH. The Macros folder is intentionally left untouched in both modes.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** `padCount`-parameterized `CubeGrid` (Task 1), `Visualizer.setGridMode` + note-based `cellIndex`/`hue` (Task 2), GUI dropdown + folder/routing visibility (Task 3), doubled `cellSize` for the 2x2 layout (Task 1), Kick/Snare/Closed HH/Open HH unaffected in either mode (Task 3, their MIDI routing rows and folders are simply never touched), Macros folder left alone (Task 3, explicitly not in the hidden lists) — all covered. Choke behavior between Closed HH/Open HH is pre-existing in `DrumSynth.js` and untouched by this plan, per the design doc's Non-goals.
- **Placeholder scan:** no TBD/TODO; every step has complete, exact code.
- **Type/signature consistency:** `CubeGrid` constructor `(scene, renderer, padCount = 16)` matches its two call sites (`Visualizer.init()` and `Visualizer.setGridMode()`). `Visualizer.setGridMode(padCount)` matches its Task 3 call site (`visualizer.setGridMode(is4 ? 4 : 16)`). Folder/controller variable names referenced in Task 3 Step 3's `hideableFolders`/`hideableMidiControllers` arrays match exactly the variable names already declared earlier in `setupGUI()` (pre-existing folder consts) and the ones newly introduced in Task 3 Step 2 (the `*Ctrl` consts).
