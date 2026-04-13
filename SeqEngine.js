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

function createTrack(midiNote) {
    return {
        midiNote,
        steps: Array.from({ length: 16 }, () => createStep(midiNote)),
    };
}

function createPattern() {
    return {
        bpm:    120,
        swing:  0,
        tracks: [
            createTrack(48),  // T0: Kick 808 (melodic)
            createTrack(49),  // T1: Snare
            createTrack(50),  // T2: Closed HH
            createTrack(51),  // T3: Open HH
        ],
    };
}

// ─── SeqEngine ────────────────────────────────────────────────────────────────

const SCHEDULER_INTERVAL_MS = 25;
const LOOKAHEAD_SEC          = 0.1;

export class SeqEngine {
    constructor(drumSynth, visualizer) {
        this._drumSynth  = drumSynth;
        this._visualizer = visualizer;

        this.pattern = createPattern();

        this._isPlaying      = false;
        this._schedulerTimer = null;
        this._globalStep     = 0;
        this._trackStep      = [0, 0, 0, 0];
        this._barCount       = [0, 0, 0, 0];
        this._nextStepTime   = 0;
        this._onStepFire     = null;

        // Auto-save debounce
        this._autoSaveTimer = null;
    }

    // ── Public transport ──────────────────────────────────────────────────────

    start() {
        if (this._isPlaying) return;
        this._isPlaying    = true;
        this._globalStep   = 0;
        this._trackStep    = [0, 0, 0, 0];
        this._barCount     = [0, 0, 0, 0];
        this._nextStepTime = this._ctx.currentTime + 0.05;

        this._schedulerTimer = setInterval(
            () => this._scheduleAhead(),
            SCHEDULER_INTERVAL_MS
        );
    }

    stop() {
        if (!this._isPlaying) return;
        this._isPlaying = false;
        clearInterval(this._schedulerTimer);
        this._schedulerTimer = null;
        this._globalStep = 0;
        this._trackStep  = [0, 0, 0, 0];
        this._barCount   = [0, 0, 0, 0];
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
        this.pattern = JSON.parse(JSON.stringify(pattern));
    }

    // ── Private ───────────────────────────────────────────────────────────────

    get _ctx() {
        return this._drumSynth._ctx();
    }

    _step(trackIdx, stepIdx) {
        const track = this.pattern.tracks[trackIdx];
        if (!track || stepIdx < 0 || stepIdx >= 64) return null;
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

        for (let t = 0; t < 4; t++) {
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

        for (let t = 0; t < 4; t++) {
            const next = (this._trackStep[t] + 1) % 16;
            if (next === 0) this._barCount[t]++;
            this._trackStep[t] = next;
        }
    }

    _fireSoundAt(trackIdx, velocity, midiNote, startTime) {
        const vel = velocity / 127;

        switch (trackIdx) {
            case 0: this._drumSynth.kick(vel, midiNote, startTime);       break;
            case 1: this._drumSynth.snare(vel, startTime);                break;
            case 2: this._drumSynth.closedHihat(vel, startTime);          break;
            case 3: this._drumSynth.openHihat(vel, startTime);            break;
        }

        const delayMs    = Math.max(0, (startTime - this._ctx.currentTime) * 1000);
        const visualNote = 48 + trackIdx;
        setTimeout(() => {
            this._visualizer.triggerNote(visualNote, vel);
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
