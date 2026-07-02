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
        cloned.tracks = cloned.tracks.slice(0, this._instrumentList.length);
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
            this._drumSynth.kick(vel, midiNote !== null ? midiNote - 12 : midiNote, startTime);
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
