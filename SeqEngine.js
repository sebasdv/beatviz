// ─── Data factories ───────────────────────────────────────────────────────────

function createStep(midiNote = 48) {
    return { active: false, velocity: 100, probability: 100, midiNote };
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

    setStepProbability(trackIdx, stepIdx, value) {
        const step = this._step(trackIdx, stepIdx);
        if (!step) return;
        step.probability = Math.max(0, Math.min(100, value));
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
        for (let t = 0; t < 4; t++) {
            const track = this.pattern.tracks[t];
            const si    = this._trackStep[t];
            const step  = track.steps[si];

            if (!step.active) continue;
            if (Math.random() * 100 > step.probability) continue;

            this._fireSoundAt(t, step.velocity, step.midiNote, time);

            // Notify UI for playhead — delayed to match audio
            const delayMs = Math.max(0, (time - this._ctx.currentTime) * 1000);
            const tCopy = t, sCopy = si;
            setTimeout(() => {
                this._onStepFire?.(tCopy, sCopy);
            }, delayMs);
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
            this._trackStep[t] = (this._trackStep[t] + 1) % 16;
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
