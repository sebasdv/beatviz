# Gamepad-Driven Step Sequencer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an XInput-style gamepad (D-pad + A/B/X/Y) program step patterns directly on the existing 4x4 `CubeGrid`, across all 16 instruments, while MIDI/keyboard live-triggering keeps working unmodified.

**Architecture:** A new `GamepadManager.js` (event emitter, same shape as `MidiManager.js`) is polled once per frame from `Visualizer.js`'s existing render loop. `SeqEngine.js` grows from 4 to 16 tracks (one per instrument in `main.js`'s `INSTRUMENTS`). `CubeGrid.js` gains an `editMode` that repurposes its 16 cubes to show the steps of whichever instrument is selected, using the exact same `aBrightness`/`aPadColor` pipeline it already has (cubes are wireframe boxes, so a "bright/white" cube already reads as a highlighted ring — no shader changes needed). `main.js` is the glue: it owns cursor/instrument selection state and translates gamepad events into `SeqEngine`/`CubeGrid` calls.

**Important discovery:** `SeqEngine.js`, `SeqUI.js`, and `SeqStorage.js` already exist in the repo (a 4-track sequencer with mouse-editable steps) but are **not wired into `main.js` or `index.html` at all** — they're orphaned modules from earlier work. This plan re-wires them (header/transport only, no step rows — per the approved spec) in addition to adding gamepad support.

**Tech Stack:** Vanilla ES modules, Three.js r171 (WebGPU renderer, TSL shaders), Web Audio API, browser Gamepad API. No build step, no test runner — this codebase has neither `package.json` nor a test framework. Verification throughout this plan is manual: run the existing dev server and check behavior in Chrome/Edge, using browser DevTools console to mock gamepad input where real hardware isn't available to the implementer.

**Dev server:** `npx http-server c:/beatviz -p 8080 --cors -c-1` (from [MEMORY.md](../../../MEMORY.md), kept here for convenience).

---

## Task 1: `GamepadManager.js` — event emitter + edge-detected polling

**Files:**
- Create: `GamepadManager.js`

- [ ] **Step 1: Write the module**

```js
const BUTTON_MAP = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y' };
const DPAD_MAP   = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

export class GamepadManager {
    constructor() {
        this.listeners = { connected: [], disconnected: [], dpad: [], button: [] };
        this._index = null;
        this._prevButtons = [];
        this._warnedMapping = false;

        window.addEventListener('gamepadconnected', (e) => {
            if (this._index !== null) return; // only the first controller is used
            this._index = e.gamepad.index;
            this._prevButtons = e.gamepad.buttons.map(b => b.pressed);
            this.emit('connected', { index: this._index });
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            if (e.gamepad.index !== this._index) return;
            this._index = null;
            this._prevButtons = [];
            this._warnedMapping = false;
            this.emit('disconnected', {});
        });
    }

    // Call once per animation frame.
    poll() {
        if (this._index === null) return;
        const gp = navigator.getGamepads()[this._index];
        if (!gp) return;

        if (gp.mapping !== 'standard') {
            if (!this._warnedMapping) {
                console.warn(`GamepadManager: unsupported gamepad mapping "${gp.mapping}" — ignoring input.`);
                this._warnedMapping = true;
            }
            return;
        }

        this._pollButtonGroup(gp, BUTTON_MAP, 'button', (name) => ({ name }));
        this._pollButtonGroup(gp, DPAD_MAP, 'dpad', (direction) => ({ direction }));
    }

    _pollButtonGroup(gp, map, eventName, buildPayload) {
        for (const [indexStr, label] of Object.entries(map)) {
            const idx = Number(indexStr);
            const pressed = gp.buttons[idx]?.pressed ?? false;
            if (pressed && !this._prevButtons[idx]) {
                this.emit(eventName, buildPayload(label));
            }
            this._prevButtons[idx] = pressed;
        }
    }

    // Raw snapshot for the on-screen debug overlay — no edge detection.
    getDebugState() {
        if (this._index === null) return { connected: false };
        const gp = navigator.getGamepads()[this._index];
        if (!gp) return { connected: false };
        return {
            connected: true,
            index: this._index,
            mapping: gp.mapping,
            buttons: gp.buttons.map(b => b.pressed),
        };
    }

    on(event, callback) {
        if (this.listeners[event]) this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
    }
}
```

- [ ] **Step 2: Manual verification (no hardware needed)**

Start the dev server (`npx http-server c:/beatviz -p 8080 --cors -c-1`), open `http://localhost:8080` in Chrome, click "Start Audio / MIDI", then open DevTools console and run:

```js
const { GamepadManager } = await import('./GamepadManager.js');
const gm = new GamepadManager();
gm.on('dpad', (e) => console.log('dpad', e));
gm.on('button', (e) => console.log('button', e));
gm.on('connected', (e) => console.log('connected', e));
gm.on('disconnected', (e) => console.log('disconnected', e));

// Simulate a connected standard-mapping gamepad with button 1 (B) pressed
const fakeGamepad = {
    index: 0, mapping: 'standard',
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 1 })),
};
const origGetGamepads = navigator.getGamepads.bind(navigator);
navigator.getGamepads = () => [fakeGamepad];
gm._index = 0; // pretend gamepadconnected already fired
gm._prevButtons = fakeGamepad.buttons.map(() => false);
gm.poll();
// Expected: console prints `button {name: 'B'}`
gm.poll();
// Expected: nothing printed (button held, not a new press — no auto-repeat)
navigator.getGamepads = origGetGamepads; // restore
```

Expected: first `poll()` logs exactly one `button {name: 'B'}` event; the second `poll()` logs nothing.

- [ ] **Step 3: Commit**

```bash
git add GamepadManager.js
git commit -m "$(cat <<'EOF'
feat: add GamepadManager for standard-mapping gamepad input

Event-emitter wrapper around the Gamepad API, polled once per frame.
Detects the first connected controller, requires mapping === "standard"
(satisfied by XInput controllers in Chrome/Edge), and emits discrete
press events (button/dpad) via rising-edge detection — no auto-repeat
on hold.
EOF
)"
```

---

## Task 2: `SeqEngine.js` — expand from 4 to N tracks

**Files:**
- Modify: `SeqEngine.js` (full rewrite, same public API shape plus a new constructor parameter)

- [ ] **Step 1: Replace the whole file**

The constructor now takes an `instrumentList` (array of `{ name, defaultNote }`, one per track, in track-index order). Track count, `_trackStep`, `_barCount`, and the scheduling loops all become dynamic instead of hardcoded to 4. `_fireSoundAt` dispatches by instrument `name` (mirroring the dispatch `main.js` already uses for MIDI/keyboard) instead of a 4-case switch — track 0 (kick) keeps its special melodic-note handling. `loadPattern` backfills any missing tracks so patterns saved before this change (4 tracks) still load.

```js
// ─── Data factories ───────────────────────────────────────────────────────────

export const TRIG_CONDITIONS = [
    'always',
    '50p', '75p', '25p',
    '1:2', '2:2',
    '1:4', '2:4', '3:4', '4:4',
    'never',
];

export function evalCondition(condition, barCount) {
    if (condition === 'always' || condition == null) return true;
    if (condition === 'never')  return false;
    if (condition === '50p')    return barCount % 2 === 0;
    if (condition === '75p')    return barCount % 4 !== 3;
    if (condition === '25p')    return barCount % 4 === 0;
    const [n, m] = condition.split(':').map(Number);
    if (!isNaN(n) && !isNaN(m)) return (barCount % m) === (n - 1);
    return true;
}

function createStep(midiNote = 48) {
    return { active: false, velocity: 100, condition: 'always', midiNote };
}

function createTrack(defaultNote) {
    return {
        midiNote: defaultNote,
        steps: Array.from({ length: 16 }, () => createStep(defaultNote)),
    };
}

function createPattern(instrumentList) {
    return {
        bpm:    120,
        swing:  0,
        tracks: instrumentList.map(({ defaultNote }) => createTrack(defaultNote)),
    };
}

// ─── SeqEngine ────────────────────────────────────────────────────────────────

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SEC          = 0.1;

export class SeqEngine {
    constructor(drumSynth, visualizer, instrumentList) {
        this._drumSynth      = drumSynth;
        this._visualizer     = visualizer;
        this._instrumentList = instrumentList;

        this.pattern = createPattern(instrumentList);

        this._isPlaying      = false;
        this._schedulerTimer = null;
        this._globalStep     = 0;
        this._trackStep      = new Array(instrumentList.length).fill(0);
        this._barCount       = new Array(instrumentList.length).fill(0);
        this._nextStepTime   = 0;
        this._onStepFire     = null;

        // Auto-save debounce
        this._autoSaveTimer = null;
    }

    // ── Public transport ──────────────────────────────────────────────────────

    start() {
        if (this._isPlaying) return;
        const n = this.pattern.tracks.length;
        this._isPlaying    = true;
        this._globalStep   = 0;
        this._trackStep    = new Array(n).fill(0);
        this._barCount     = new Array(n).fill(0);
        this._nextStepTime = this._ctx.currentTime + 0.05;

        this._schedulerTimer = setInterval(
            () => this._scheduleAhead(),
            SCHEDULER_INTERVAL_MS
        );
    }

    stop() {
        if (!this._isPlaying) return;
        const n = this.pattern.tracks.length;
        this._isPlaying = false;
        clearInterval(this._schedulerTimer);
        this._schedulerTimer = null;
        this._globalStep = 0;
        this._trackStep  = new Array(n).fill(0);
        this._barCount   = new Array(n).fill(0);
    }

    get isPlaying() { return this._isPlaying; }

    // ── Pattern params ────────────────────────────────────────────────────────

    setBPM(bpm) {
        this.pattern.bpm = Math.max(40, Math.min(240, bpm));
    }

    setSwing(swing) {
        this.pattern.swing = Math.max(0, Math.min(75, swing));
    }

    // ── Step editing ──────────────────────────────────────────────────────────

    toggleStep(trackIdx, stepIdx) {
        const step = this._step(trackIdx, stepIdx);
        if (!step) return;
        step.active = !step.active;
        this._scheduleAutoSave();
    }

    setStepVelocity(trackIdx, stepIdx, value) {
        const step = this._step(trackIdx, stepIdx);
        if (!step) return;
        step.velocity = Math.max(1, Math.min(127, value));
        this._scheduleAutoSave();
    }

    setStepCondition(trackIdx, stepIdx, condition) {
        const step = this._step(trackIdx, stepIdx);
        if (!step) return;
        step.condition = TRIG_CONDITIONS.includes(condition) ? condition : 'always';
        this._scheduleAutoSave();
    }

    setStepNote(trackIdx, stepIdx, midiNote) {
        if (trackIdx !== 0) return; // only kick is melodic
        const step = this._step(trackIdx, stepIdx);
        if (!step) return;
        step.midiNote = Math.max(0, Math.min(127, midiNote));
        this._scheduleAutoSave();
    }

    // ── Playhead callback ─────────────────────────────────────────────────────

    onStepFire(callback) {
        this._onStepFire = callback;
    }

    // ── Deep copy for save/load ───────────────────────────────────────────────

    getPatternCopy() {
        return JSON.parse(JSON.stringify(this.pattern));
    }

    loadPattern(pattern) {
        this.stop();
        const cloned = JSON.parse(JSON.stringify(pattern));
        while (cloned.tracks.length < this._instrumentList.length) {
            const { defaultNote } = this._instrumentList[cloned.tracks.length];
            cloned.tracks.push(createTrack(defaultNote));
        }
        this.pattern = cloned;
        const n = this.pattern.tracks.length;
        this._trackStep = new Array(n).fill(0);
        this._barCount  = new Array(n).fill(0);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    get _ctx() {
        return this._drumSynth._ctx();
    }

    _step(trackIdx, stepIdx) {
        const track = this.pattern.tracks[trackIdx];
        if (!track || stepIdx < 0 || stepIdx >= 16) return null;
        return track.steps[stepIdx];
    }

    _scheduleAhead() {
        while (this._nextStepTime < this._ctx.currentTime + LOOKAHEAD_SEC) {
            this._scheduleStep(this._nextStepTime);
            this._advance();
        }
    }

    _scheduleStep(time) {
        const delayMs = Math.max(0, (time - this._ctx.currentTime) * 1000);
        const n = this.pattern.tracks.length;

        for (let t = 0; t < n; t++) {
            const track = this.pattern.tracks[t];
            const si    = this._trackStep[t];
            const step  = track.steps[si];

            // Playhead always advances, regardless of active/probability
            const tCopy = t, sCopy = si;
            setTimeout(() => {
                this._onStepFire?.(tCopy, sCopy);
            }, delayMs);

            if (!step.active) continue;
            if (!evalCondition(step.condition, this._barCount[t])) continue;

            this._fireSoundAt(t, step.velocity, step.midiNote, time);
        }
    }

    _advance() {
        const stepDuration = (60 / this.pattern.bpm) / 4; // 1/16 note
        const isOdd        = (this._globalStep & 1) === 1;
        // Swing: par avanza menos, impar avanza más — suma total siempre = 2 * stepDuration
        const swingOffset  = stepDuration * this.pattern.swing / 100;
        const thisStepDur  = isOdd
            ? stepDuration + swingOffset   // impar: llega tarde
            : stepDuration - swingOffset;  // par: llega antes (compensación)

        this._nextStepTime += thisStepDur;
        this._globalStep++;

        const n = this.pattern.tracks.length;
        for (let t = 0; t < n; t++) {
            const next = (this._trackStep[t] + 1) % 16;
            if (next === 0) this._barCount[t]++;
            this._trackStep[t] = next;
        }
    }

    _fireSoundAt(trackIdx, velocity, midiNote, startTime) {
        const vel = velocity / 127;
        const { name, defaultNote } = this._instrumentList[trackIdx];

        if (trackIdx === 0) {
            this._drumSynth.kick(vel, midiNote, startTime);
        } else {
            this._drumSynth[name](vel, startTime);
        }

        const delayMs = Math.max(0, (startTime - this._ctx.currentTime) * 1000);
        setTimeout(() => {
            this._visualizer.triggerNote(defaultNote, vel);
        }, delayMs);
    }

    _scheduleAutoSave() {
        clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            try {
                localStorage.setItem('beatviz_seq_current', JSON.stringify(this.pattern));
            } catch (_) {}
        }, 1000);
    }
}
```

- [ ] **Step 2: Manual verification**

This class has no DOM dependency, so it can be exercised directly in the browser console (after loading the page, since `DrumSynth._ctx()` needs a real `AudioContext`, which requires the "Start Audio" click first):

```js
const { SeqEngine } = await import('./SeqEngine.js');

const fakeInstruments = Array.from({ length: 16 }, (_, i) => ({ name: i === 0 ? 'kick' : 'snare', defaultNote: 48 + i }));
const fakeDrum = { _ctx: () => ({ currentTime: 0 }), kick: () => {}, snare: () => {} };
const fakeViz  = { triggerNote: () => {} };

const engine = new SeqEngine(fakeDrum, fakeViz, fakeInstruments);
console.log(engine.pattern.tracks.length); // Expected: 16
engine.toggleStep(5, 3);
console.log(engine.pattern.tracks[5].steps[3].active); // Expected: true

// Backward-compat: loading an old 4-track pattern should pad to 16
engine.loadPattern({ bpm: 120, swing: 0, tracks: fakeInstruments.slice(0, 4).map(({defaultNote}) => ({ midiNote: defaultNote, steps: Array.from({length:16}, () => ({active:false, velocity:100, condition:'always', midiNote: defaultNote})) })) });
console.log(engine.pattern.tracks.length); // Expected: 16
```

- [ ] **Step 3: Commit**

```bash
git add SeqEngine.js
git commit -m "$(cat <<'EOF'
feat: expand SeqEngine from 4 to N instrument tracks

Track count, per-track step/bar counters, and sound dispatch are now
driven by an injected instrumentList instead of being hardcoded to 4.
loadPattern backfills any tracks missing from an older saved pattern
so existing localStorage slots keep working.
EOF
)"
```

---

## Task 3: `SeqStorage.js` — accept any track count up to 16

**Files:**
- Modify: `SeqStorage.js:47`

- [ ] **Step 1: Widen the validation check**

In `_validate`, replace:

```js
        if (!Array.isArray(data.tracks) || data.tracks.length !== 4) return null;
```

with:

```js
        if (!Array.isArray(data.tracks) || data.tracks.length < 1 || data.tracks.length > 16) return null;
```

- [ ] **Step 2: Manual verification**

```js
const { SeqStorage } = await import('./SeqStorage.js');
SeqStorage.save(0, { bpm: 120, swing: 0, tracks: [{ midiNote: 48, steps: Array.from({length:16}, () => ({active:false, velocity:100, condition:'always', midiNote:48})) }] });
console.log(SeqStorage.load(0)); // Expected: non-null, 1 track (previously would have been rejected)
SeqStorage.clear(0);
```

- [ ] **Step 3: Commit**

```bash
git add SeqStorage.js
git commit -m "fix: accept 1-16 sequencer tracks in SeqStorage validation"
```

---

## Task 4: `SeqUI.js` — trim to transport-only panel

**Files:**
- Modify: `SeqUI.js` (full rewrite — removes step-row rendering and the step popover per the approved spec; keeps BPM/swing/play-stop/save-load)

- [ ] **Step 1: Replace the whole file**

```js
import { SeqStorage } from './SeqStorage.js';

export class SeqUI {
    constructor(engine, storage) {
        this._engine     = engine;
        this._storage    = storage;
        this._panel      = null;
        this._activeSlot = 0;
    }

    init() {
        this._panel = document.getElementById('sequencer-panel');
        this._buildPanel();
        this._loadCurrentIfExists();

        document.getElementById('seq-toggle-btn').addEventListener('click', () => {
            this._togglePanel();
        });
    }

    // ── Panel visibility ─────────────────────────────────────────────────────

    _togglePanel() {
        const btn = document.getElementById('seq-toggle-btn');
        const hidden = this._panel.classList.toggle('seq-hidden');
        btn.classList.toggle('active', !hidden);
    }

    // ── Build DOM ────────────────────────────────────────────────────────────

    _buildPanel() {
        this._panel.innerHTML = '';
        this._panel.appendChild(this._buildHeader());
    }

    _buildHeader() {
        const hdr = document.createElement('div');
        hdr.className = 'seq-header';
        hdr.innerHTML = `
            <div class="seq-transport">
                <button class="seq-btn seq-play" id="seq-play">▶</button>
                <button class="seq-btn seq-stop" id="seq-stop">■</button>
            </div>
            <div class="seq-param-group">
                <label>BPM</label>
                <input type="number" id="seq-bpm" min="40" max="240" value="${this._engine.pattern.bpm}">
            </div>
            <div class="seq-param-group">
                <label>SWING</label>
                <input type="range" id="seq-swing" min="0" max="75" value="${this._engine.pattern.swing}" step="5">
                <span id="seq-swing-val">${this._engine.pattern.swing}%</span>
            </div>
            <div class="seq-slots">
                <span>SLOT</span>
                <button class="seq-slot-btn active" data-slot="0">1</button>
                <button class="seq-slot-btn" data-slot="1">2</button>
                <button class="seq-slot-btn" data-slot="2">3</button>
                <button class="seq-btn" id="seq-save">SAVE</button>
                <button class="seq-btn" id="seq-load">LOAD</button>
            </div>
        `;

        hdr.querySelector('#seq-play').addEventListener('click', () => this._handlePlay());
        hdr.querySelector('#seq-stop').addEventListener('click', () => this._handleStop());

        hdr.querySelector('#seq-bpm').addEventListener('change', e => {
            this._engine.setBPM(parseInt(e.target.value));
        });

        const swingInput = hdr.querySelector('#seq-swing');
        const swingVal   = hdr.querySelector('#seq-swing-val');
        swingInput.addEventListener('input', e => {
            const v = parseInt(e.target.value);
            this._engine.setSwing(v);
            swingVal.textContent = v + '%';
        });

        hdr.querySelectorAll('.seq-slot-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                hdr.querySelectorAll('.seq-slot-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._activeSlot = parseInt(btn.dataset.slot);
                this._updateSlotIndicators();
            });
        });

        hdr.querySelector('#seq-save').addEventListener('click', () => {
            SeqStorage.save(this._activeSlot, this._engine.getPatternCopy());
            this._updateSlotIndicators();
        });

        hdr.querySelector('#seq-load').addEventListener('click', () => {
            const p = SeqStorage.load(this._activeSlot);
            if (!p) return;
            this._engine.loadPattern(p);
            hdr.querySelector('#seq-bpm').value   = p.bpm;
            hdr.querySelector('#seq-swing').value = p.swing;
            swingVal.textContent = p.swing + '%';
        });

        setTimeout(() => this._updateSlotIndicators(), 0);
        return hdr;
    }

    // ── Transport handlers ────────────────────────────────────────────────────

    _handlePlay() {
        const btn = document.getElementById('seq-play');
        if (this._engine.isPlaying) {
            this._engine.stop();
            btn.classList.remove('playing');
        } else {
            this._engine.start();
            btn.classList.add('playing');
        }
    }

    _handleStop() {
        this._engine.stop();
        document.getElementById('seq-play')?.classList.remove('playing');
    }

    // ── Slot indicators ───────────────────────────────────────────────────────

    _updateSlotIndicators() {
        document.querySelectorAll('.seq-slot-btn').forEach(btn => {
            const slot = parseInt(btn.dataset.slot);
            btn.style.fontWeight = SeqStorage.slotUsed(slot) ? '900' : '400';
            btn.title = SeqStorage.slotUsed(slot) ? `Slot ${slot + 1} (saved)` : `Slot ${slot + 1} (empty)`;
        });
    }

    // ── Auto-load current pattern on init ────────────────────────────────────

    _loadCurrentIfExists() {
        const p = SeqStorage.loadCurrent();
        if (p) {
            this._engine.loadPattern(p);
            const bpmInput = document.getElementById('seq-bpm');
            if (bpmInput) bpmInput.value = p.bpm;
            const swingInput = document.getElementById('seq-swing');
            if (swingInput) {
                swingInput.value = p.swing;
                const swingVal = document.getElementById('seq-swing-val');
                if (swingVal) swingVal.textContent = p.swing + '%';
            }
        }
    }
}
```

- [ ] **Step 2: Commit** (verification happens in Task 8, once this is wired into `main.js` — a standalone panel with no engine attached isn't independently testable in the browser)

```bash
git add SeqUI.js
git commit -m "refactor: trim SeqUI to transport-only panel (BPM/swing/play/slots)

Step rows and the per-step popover are removed — the CubeGrid + gamepad
is now the step-editing surface, per the approved design spec.
"
```

---

## Task 5: `CubeGrid.js` — edit mode, step visualization, global flash

**Files:**
- Modify: `CubeGrid.js`

- [ ] **Step 1: Add edit-mode state to the constructor**

In `CubeGrid.js`, in the constructor (after the existing `this.padColors = ...` block at line 33-35), add:

```js
        this.editMode = false;
        this._editState = { instrumentIdx: 0, cursorIndex: 0, steps: null, playheadIndex: -1 };
        this._flashBrightness = 0;
        this._flashHue = 0;
        this._flashDecaySpeed = 6.0;
```

- [ ] **Step 2: Guard `trigger()` so edit mode redirects to a global flash**

Replace the existing `trigger(index, velocity, hue)` method (lines 92-102):

```js
    trigger(index, velocity, hue) {
        if (this.editMode) {
            this._flashHue = hue;
            this._flashBrightness = Math.max(this._flashBrightness, velocity);
            return;
        }
        if (index >= 0 && index < 16) {
            this.pads[index].restHeight = 0.2 * this.impulseDirection;
            this.pads[index].velocity = velocity * this.impulseForce * this.impulseDirection;
            this.pads[index].isActive = 1.0;
            this.impulseDirection *= -1.0;

            this.padColors[index].setHSL(hue, 1.0, 0.5);
            this._applyPadColor(index);
        }
    }
```

- [ ] **Step 3: Skip the old per-pad brightness decay while in edit mode, and add the flash decay**

Replace the existing `update(delta)` method (lines 104-148):

```js
    update(delta) {
        const dummy = new THREE.Object3D();
        let needsMatrixUpdate = false;
        let needsBrightnessUpdate = false;

        for (let i = 0; i < 16; i++) {
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
                const ix = i % 4;
                const iz = Math.floor(i / 4);
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
            for (let i = 0; i < 16; i++) {
                this.padColors[i].setHSL(this._flashHue, 1.0, 0.5);
                this._applyPadColor(i);
                this.brightnessData[i] = this._flashBrightness;
            }
            needsBrightnessUpdate = true;
            if (this._flashBrightness === 0) this._renderEditState();
        }

        if (needsMatrixUpdate) this.mesh.instanceMatrix.needsUpdate = true;
        if (needsBrightnessUpdate) this.instanceBrightness.needsUpdate = true;
    }
```

- [ ] **Step 4: Add `setEditMode`, `setEditState`, `_renderEditState`, `_restoreNormalColors`**

Add these methods after `setCellVol` (after line 171, before `_applyPadColor`):

```js
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
        for (let i = 0; i < 16; i++) {
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
            this._applyPadColor(i);
            this.brightnessData[i] = brightness;
        }
        this.instanceBrightness.needsUpdate = true;
    }

    _restoreNormalColors() {
        for (let i = 0; i < 16; i++) {
            this.padColors[i].setHSL(i / 16, 1.0, 0.5);
            this._applyPadColor(i);
            this.brightnessData[i] = this.pads[i].isActive;
        }
        this.instanceBrightness.needsUpdate = true;
    }
```

- [ ] **Step 5: Manual verification**

Start the dev server, open the page, click "Start Audio / MIDI", then in DevTools console:

```js
// visualizer/grid are module-scoped in main.js — for this manual check, grab the grid
// via the scene graph instead (CubeGrid.mesh is the only InstancedMesh added directly).
// Simpler: temporarily add `window.__grid = visualizer.grid;` at the end of Visualizer's
// init() while testing, then remove it — or just eyeball the two states below with
// print statements added temporarily to CubeGrid for this check.
```

Since `visualizer`/`grid` aren't exposed on `window` by design, do a quick temporary `console.log`-free check instead: call `visualizer.grid.setEditMode(true)` won't be reachable from the console without exposing it. For this task, verify by temporarily adding `window.__cubeGrid = this.grid;` at the end of `Visualizer.init()` (delete the line again after testing):

```js
window.__cubeGrid.setEditMode(true);
window.__cubeGrid.setEditState({ instrumentIdx: 0, cursorIndex: 5, steps: Array.from({length:16}, (_,i)=>({active: i===3 || i===5})), playheadIndex: 3 });
// Expected: grid instantly shows mostly-dim gray cubes, cube 3 bright yellow (playhead+active),
// cube 5 near-white/bright (cursor), rest dim gray.
window.__cubeGrid.trigger(9, 1.0, 0.5);
// Expected: entire grid flashes cyan-ish (hue 0.5) briefly, then fades back to the state above.
window.__cubeGrid.setEditMode(false);
// Expected: grid returns to the normal rainbow per-instrument look.
```

- [ ] **Step 6: Commit**

```bash
git add CubeGrid.js
git commit -m "$(cat <<'EOF'
feat: add gamepad edit mode to CubeGrid

When editMode is on, the 16 cubes represent the 16 steps of one
instrument (empty=dim gray, active=orange, playhead=bright yellow,
cursor=near-white — reusing the existing wireframe brightness/color
pipeline, no shader changes). Live triggers (MIDI/keyboard/other
sequencer tracks) become a brief whole-grid flash instead of a fixed
per-instrument cube while in this mode.
EOF
)"
```

---

## Task 6: `Visualizer.js` — wire the gamepad poll and edit-mode passthrough

**Files:**
- Modify: `Visualizer.js:8-26` (constructor), `Visualizer.js:72-90` (`animate`), add new passthrough methods near `setCellVol`/`setPhysics` (lines 120-128)

- [ ] **Step 1: Add a `gamepadManager` field**

In the constructor (after line 17 `this.postProcessing = null;`), add:

```js
        this.gamepadManager = null;
```

- [ ] **Step 2: Poll it once per frame**

In `animate()`, after `this.controls.update();` (line 77), add:

```js
        if (this.gamepadManager) {
            this.gamepadManager.poll();
        }
```

- [ ] **Step 3: Add passthrough methods**

After `setPhysics` (after line 128, before the closing `}` of the class), add:

```js

    setGamepadManager(gamepadManager) {
        this.gamepadManager = gamepadManager;
    }

    setEditMode(active) {
        if (this.grid) this.grid.setEditMode(active);
    }

    setEditState(state) {
        if (this.grid) this.grid.setEditState(state);
    }
```

- [ ] **Step 4: Manual verification**

Start the dev server, open the page, click "Start Audio / MIDI", open DevTools console:

```js
// Confirm no console errors appear on load/animate (gamepadManager is null by default,
// the `if (this.gamepadManager)` guard means poll() is simply skipped).
// Then wire a real GamepadManager and confirm poll() runs every frame without throwing:
const { GamepadManager } = await import('./GamepadManager.js');
// visualizer is not on window — add a temporary `window.__viz = visualizer;` in main.js's
// init() for this check, remove it afterward.
window.__viz.setGamepadManager(new GamepadManager());
// Expected: no console errors over the next few seconds (poll() runs every frame silently
// since no gamepad is connected in this environment).
```

- [ ] **Step 5: Commit**

```bash
git add Visualizer.js
git commit -m "feat: poll GamepadManager from the render loop, add editMode passthrough"
```

---

## Task 7: `index.html` — wire the sequencer panel and add a gamepad debug overlay

**Files:**
- Modify: `index.html:22-31`

**Context:** `SeqUI`/`SeqEngine` styles already exist in `style.css` (`.seq-panel`, `#seq-toggle-btn`, etc. from an earlier, disconnected effort) but the panel markup was never added to `index.html`. This step adds it, plus a small debug overlay for manually verifying gamepad state (per the spec's Verification section — there's no gamepad hardware in the implementer's environment, so this overlay is how the user will confirm things work after pulling this change).

- [ ] **Step 1: Add the markup**

Replace the `<body>` block (lines 22-31):

```html
<body>
    <div id="canvas-container"></div>
    <button id="fullscreen-btn" title="Fullscreen">⛶</button>
    <button id="seq-toggle-btn">SEQ</button>
    <div id="sequencer-panel" class="seq-panel seq-hidden"></div>
    <div id="gamepad-debug">Gamepad: not connected</div>
    <div id="overlay">
        <h1>MIDI Visualizer</h1>
        <p>Notes 48-63 (Ch 1) | Q-I / A-K keys</p>
        <button id="start-audio">Start Audio / MIDI</button>
    </div>
    <script type="module" src="./main.js"></script>
</body>
```

- [ ] **Step 2: Add minimal styling for the debug overlay**

Append to the end of `style.css`:

```css
/* ── Gamepad debug overlay ────────────────────────────────────────────────── */
#gamepad-debug {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 20;
    padding: 0.4rem 0.6rem;
    font-size: 0.7rem;
    font-family: 'Courier New', monospace;
    background: rgba(0,0,0,0.5);
    color: #0f0;
    border: 1px solid rgba(255,255,255,0.2);
    white-space: pre;
    pointer-events: none;
}
```

- [ ] **Step 3: Manual verification**

Start the dev server, open the page. Expected: a small green-on-black monospace box appears in the top-right corner reading "Gamepad: not connected", and clicking the new "SEQ" button in the bottom-left toggles an (empty-looking, header-only) panel — it won't show BPM/swing controls yet since `SeqUI` isn't instantiated until Task 8.

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "feat: add sequencer panel markup and gamepad debug overlay to index.html"
```

---

## Task 8: `main.js` — wire everything together

**Files:**
- Modify: `main.js:1-13` (imports/globals), `main.js:40-78` (`init`), add new functions, `main.js:481-487` (start button handler)

- [ ] **Step 1: Add imports and module-level state**

Replace lines 1-13:

```js
import { MidiManager } from './MidiManager.js';
import { Visualizer } from './Visualizer.js';
import { CCMapper } from './CCMapper.js';
import { DrumSynth } from './DrumSynth.js';
import { GamepadManager } from './GamepadManager.js';
import { SeqEngine } from './SeqEngine.js';
import { SeqUI } from './SeqUI.js';
import GUI from 'https://unpkg.com/lil-gui@0.19.1/dist/lil-gui.esm.min.js';

const startButton = document.getElementById('start-audio');
const overlay = document.getElementById('overlay');

let midiManager;
let visualizer;
let ccMapper;
let drumSynth;
let gamepadManager;
let seqEngine;
let seqUI;

let currentInstrumentIdx = 0;
let cursorIndex = 0;
let playheadIndex = -1;
```

- [ ] **Step 2: Build the instrument list SeqEngine needs, right after the `INSTRUMENTS` declaration**

After line 38 (the closing `};` of `INSTRUMENTS`), add:

```js

// Track order for the sequencer — matches INSTRUMENTS declaration order,
// so track index N always corresponds to Object.values(INSTRUMENTS)[N].
const INSTRUMENT_LIST = Object.entries(INSTRUMENTS).map(([name, cfg]) => ({
    name, defaultNote: cfg.defaultNote,
}));
```

- [ ] **Step 3: Instantiate the new systems inside `init()`, and wire gamepad events**

In `init()`, after `drumSynth = new DrumSynth();` (line 43), add:

```js
    seqEngine = new SeqEngine(drumSynth, visualizer, INSTRUMENT_LIST);
    seqUI = new SeqUI(seqEngine);
    seqUI.init();

    gamepadManager = new GamepadManager();
    visualizer.setGamepadManager(gamepadManager);
    setupGamepad();
```

- [ ] **Step 4: Add the gamepad wiring functions and cursor/instrument helpers**

Add these new top-level functions anywhere after `init()` (e.g. right after the closing `}` of `init`, before `addMappable`):

```js
function moveCursor(direction) {
    let x = cursorIndex % 4;
    let z = Math.floor(cursorIndex / 4);
    if (direction === 'up')    z = (z + 3) % 4;
    if (direction === 'down')  z = (z + 1) % 4;
    if (direction === 'left')  x = (x + 3) % 4;
    if (direction === 'right') x = (x + 1) % 4;
    cursorIndex = z * 4 + x;
}

function pushEditStateToGrid() {
    const track = seqEngine.pattern.tracks[currentInstrumentIdx];
    visualizer.setEditState({
        instrumentIdx: currentInstrumentIdx,
        cursorIndex,
        steps: track.steps,
        playheadIndex,
    });
}

function setupGamepad() {
    gamepadManager.on('connected', () => {
        visualizer.setEditMode(true);
        pushEditStateToGrid();
    });

    gamepadManager.on('disconnected', () => {
        visualizer.setEditMode(false);
    });

    gamepadManager.on('dpad', ({ direction }) => {
        moveCursor(direction);
        pushEditStateToGrid();
    });

    gamepadManager.on('button', ({ name }) => {
        if (name === 'B') {
            seqEngine.toggleStep(currentInstrumentIdx, cursorIndex);
            pushEditStateToGrid();
        } else if (name === 'Y') {
            currentInstrumentIdx = (currentInstrumentIdx + 1) % INSTRUMENT_LIST.length;
            playheadIndex = -1;
            pushEditStateToGrid();
        } else if (name === 'X') {
            currentInstrumentIdx = (currentInstrumentIdx - 1 + INSTRUMENT_LIST.length) % INSTRUMENT_LIST.length;
            playheadIndex = -1;
            pushEditStateToGrid();
        } else if (name === 'A') {
            if (seqEngine.isPlaying) {
                seqEngine.stop();
                playheadIndex = -1;
            } else {
                seqEngine.start();
            }
            pushEditStateToGrid();
        }
    });

    seqEngine.onStepFire((trackIdx, stepIdx) => {
        if (trackIdx === currentInstrumentIdx) {
            playheadIndex = stepIdx;
            pushEditStateToGrid();
        }
    });
}

function updateGamepadDebugOverlay() {
    const el = document.getElementById('gamepad-debug');
    if (!el || !gamepadManager) return;
    const state = gamepadManager.getDebugState();
    if (!state.connected) {
        el.textContent = 'Gamepad: not connected';
        return;
    }
    const pressedNames = [];
    const NAMES = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 12: 'UP', 13: 'DOWN', 14: 'LEFT', 15: 'RIGHT' };
    for (const [idx, label] of Object.entries(NAMES)) {
        if (state.buttons[idx]) pressedNames.push(label);
    }
    el.textContent = `Gamepad: idx ${state.index} (${state.mapping})\nPressed: ${pressedNames.join(', ') || '-'}`;
}
```

- [ ] **Step 5: Poll the debug overlay periodically**

At the bottom of `main.js`, near the other top-level `addEventListener` calls (after the `fullscreenchange` listener, end of file), add:

```js
setInterval(updateGamepadDebugOverlay, 100);
```

- [ ] **Step 6: Manual verification (no hardware)**

Start the dev server, open the page, click "Start Audio / MIDI". Expected:
- The "SEQ" button (bottom-left) now opens a panel showing BPM/swing/play-stop/save-load controls (previously empty in Task 7's check).
- Clicking ▶ starts the sequencer (silent — no steps are active yet on any of the 16 tracks) and toggling any step via the browser console works:

```js
// seqEngine is not on window — temporarily add `window.__seq = seqEngine;` inside init()
// for this check, remove it afterward.
window.__seq.toggleStep(1, 0); // mark step 0 of track 1 (snare) active
window.__seq.start();
// Expected: you hear a snare hit once every 16 steps at 120 BPM, and the "SEQ" panel's
// play button shows the "playing" highlight.
window.__seq.stop();
```

To verify gamepad wiring end-to-end without hardware, mock a gamepad and drive it through `main.js`'s real event handlers:

```js
// window.__gp is not exposed; temporarily add `window.__gp = gamepadManager;` inside init().
const fakeGamepad = { index: 0, mapping: 'standard', buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
navigator.getGamepads = () => [fakeGamepad];
window.__gp._index = 0;
window.__gp._prevButtons = fakeGamepad.buttons.map(() => false);
window.__gp.emit('connected', {}); // manually fire, since we bypassed the real event
// Expected: the CubeGrid switches from its rainbow instrument look to the dim step-grid look.

fakeGamepad.buttons[15] = { pressed: true }; // D-pad right
window.__gp.poll();
// Expected: the bright/white cursor cube moves one to the right on the grid.

fakeGamepad.buttons[1] = { pressed: true }; // B
window.__gp.poll();
// Expected: that cube turns orange-ish (step marked active) in addition to the cursor highlight.

fakeGamepad.buttons[3] = { pressed: true }; // Y
window.__gp.poll();
// Expected: grid redraws for the next instrument (snare) — the step you just marked on kick
// is not shown (different track), cursor position is unchanged.
```

- [ ] **Step 7: Remove any temporary `window.__foo` debug lines added during manual verification** in this task and Tasks 5/6, if you added them — they were only for console testing and shouldn't ship.

- [ ] **Step 8: Commit**

```bash
git add main.js
git commit -m "$(cat <<'EOF'
feat: wire gamepad-driven sequencer editing into main.js

Connects GamepadManager, SeqEngine (16 tracks), and SeqUI. D-pad moves
a cursor over the CubeGrid (repurposed as a step editor while a gamepad
is connected), B toggles the step under the cursor, X/Y cycle through
the 16 instruments, A starts/stops playback. A polling debug overlay
shows raw gamepad state for manual verification without needing to
open DevTools.
EOF
)"
```

---

## Task 9: End-to-end verification with real hardware (user-performed)

**Files:** none — this is a verification-only task.

- [ ] **Step 1: Ask the user to connect a real Xbox/XInput controller** (USB or Bluetooth) and open the app in Chrome or Edge.

- [ ] **Step 2: Confirm the debug overlay** (top-right) shows `Gamepad: idx 0 (standard)` once the controller is connected, and that pressing buttons updates the `Pressed:` line in real time.

- [ ] **Step 3: Confirm the full loop:**
  - CubeGrid switches to the dim step-grid look on connect.
  - D-pad moves the bright cursor cube around the 4x4 grid.
  - B toggles the step under the cursor (orange tint persists after moving away).
  - X/Y cycle through all 16 instruments; cursor position is preserved across the switch.
  - A starts/stops playback; while playing, the currently-displayed instrument's playing step glows bright yellow in sync with the beat, and hits on *other* instruments cause a brief whole-grid color flash.
  - Disconnecting the controller reverts the grid to its normal rainbow-instrument look; reconnecting resumes edit mode at the same instrument/cursor position.

- [ ] **Step 4: Report back any mismatches** so they can be fixed before considering this feature done — this step has no automated fallback since no gamepad hardware is available in the dev/implementation environment.

---

## Self-Review Notes

- **Spec coverage:** button mapping (Task 8), 16-track engine (Task 2), CubeGrid repurposing + visual states (Task 5), live-trigger global flash (Task 5), cursor persistence across instrument switch (Task 8), Play/Stop on A (Task 8), automatic mode activation on connect (Task 8 `connected` handler), backward-compatible pattern loading (Task 2 + Task 3), SeqUI trimmed to transport-only (Task 4), debug overlay for hardware-less verification (Tasks 7-8) — all covered.
- **Out of scope, confirmed with user:** MIDI-driven step navigation, per-step velocity/condition editing via gamepad, multi-gamepad support, non-standard gamepad mappings, expanding SeqUI back out to 16 rows.
- **Type/signature consistency check:** `SeqEngine` constructor signature `(drumSynth, visualizer, instrumentList)` matches its Task 8 call site. `CubeGrid.setEditState({ instrumentIdx, cursorIndex, steps, playheadIndex })` matches the shape built by `pushEditStateToGrid()` in Task 8. `GamepadManager` event names (`connected`, `disconnected`, `dpad`, `button`) match what `setupGamepad()` subscribes to.
