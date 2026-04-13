import { SeqStorage } from './SeqStorage.js';

const TRACK_LABELS = ['KICK', 'SNARE', 'C.HH', 'O.HH'];

export class SeqUI {
    constructor(engine, storage) {
        this._engine      = engine;
        this._storage     = storage;
        this._panel       = null;
        this._activeSlot  = 0;
        this._playingStep = [null, null, null, null];
        this._popover     = null;
    }

    init() {
        this._panel = document.getElementById('sequencer-panel');
        this._buildPanel();
        this._registerEngineCallback();
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
        for (let t = 0; t < 4; t++) {
            this._panel.appendChild(this._buildTrackRow(t));
        }
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
                // Update slot indicators
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
            // Sync UI controls
            hdr.querySelector('#seq-bpm').value   = p.bpm;
            hdr.querySelector('#seq-swing').value  = p.swing;
            swingVal.textContent = p.swing + '%';
            this._redrawAllTracks();
        });

        setTimeout(() => this._updateSlotIndicators(), 0);
        return hdr;
    }

    _buildTrackRow(t) {
        const row = document.createElement('div');
        row.className = 'seq-track';
        row.dataset.track = t;

        const label = document.createElement('div');
        label.className = 'seq-track-label';
        label.textContent = TRACK_LABELS[t];

        const stepsDiv = document.createElement('div');
        stepsDiv.className = 'seq-steps';
        stepsDiv.id        = `seq-steps-${t}`;

        row.append(label, stepsDiv);
        this._renderSteps(t, stepsDiv);
        return row;
    }

    _renderSteps(trackIdx, container) {
        container.innerHTML = '';
        const track = this._engine.pattern.tracks[trackIdx];

        for (let s = 0; s < 16; s++) {
            const step = track.steps[s];
            const btn  = document.createElement('button');
            btn.className    = 'seq-step';
            btn.dataset.step = s;

            if (step.active)             btn.classList.add('active');
            if (step.probability < 100)  btn.classList.add('has-prob');

            // Left click: toggle
            btn.addEventListener('click', () => {
                this._engine.toggleStep(trackIdx, s);
                btn.classList.toggle('active', track.steps[s].active);
            });

            // Right click: edit popover
            btn.addEventListener('contextmenu', e => {
                e.preventDefault();
                this._showPopover(trackIdx, s, btn);
            });

            container.appendChild(btn);
        }
    }

    _redrawSteps(trackIdx) {
        const container = document.getElementById(`seq-steps-${trackIdx}`);
        if (container) this._renderSteps(trackIdx, container);
    }

    _redrawAllTracks() {
        for (let t = 0; t < 4; t++) {
            this._redrawSteps(t);
        }
    }

    // ── Transport handlers ────────────────────────────────────────────────────

    _handlePlay() {
        const btn = document.getElementById('seq-play');
        if (this._engine.isPlaying) {
            this._engine.stop();
            btn.classList.remove('playing');
            this._clearPlayhead();
        } else {
            this._engine.start();
            btn.classList.add('playing');
        }
    }

    _handleStop() {
        this._engine.stop();
        document.getElementById('seq-play')?.classList.remove('playing');
        this._clearPlayhead();
    }

    _clearPlayhead() {
        document.querySelectorAll('.seq-step.playing').forEach(el => el.classList.remove('playing'));
        this._playingStep = [null, null, null, null];
    }

    // ── Playhead callback ─────────────────────────────────────────────────────

    _registerEngineCallback() {
        this._engine.onStepFire((trackIdx, stepIdx) => {
            const container = document.getElementById(`seq-steps-${trackIdx}`);
            if (!container) return;
            const btns = container.querySelectorAll('.seq-step');

            const prev = this._playingStep[trackIdx];
            if (prev !== null) btns[prev]?.classList.remove('playing');
            btns[stepIdx]?.classList.add('playing');
            this._playingStep[trackIdx] = stepIdx;
        });
    }

    // ── Slot indicators ───────────────────────────────────────────────────────

    _updateSlotIndicators() {
        document.querySelectorAll('.seq-slot-btn').forEach(btn => {
            const slot = parseInt(btn.dataset.slot);
            btn.style.fontWeight = SeqStorage.slotUsed(slot) ? '900' : '400';
            btn.title = SeqStorage.slotUsed(slot) ? `Slot ${slot + 1} (saved)` : `Slot ${slot + 1} (empty)`;
        });
    }

    // ── Step edit popover ─────────────────────────────────────────────────────

    _showPopover(trackIdx, stepIdx, anchor) {
        this._closePopover();
        const track = this._engine.pattern.tracks[trackIdx];
        const step  = track.steps[stepIdx];

        const pop = document.createElement('div');
        pop.className = 'seq-popover';

        const isKick = trackIdx === 0;
        pop.innerHTML = `
            <div class="seq-pop-title">T${trackIdx + 1} · STEP ${stepIdx + 1}</div>
            <label>VEL <input type="range" min="1" max="127" value="${step.velocity}" class="pop-vel"></label>
            <label>PROB <input type="range" min="0" max="100" value="${step.probability}" step="5" class="pop-prob"> <span class="pop-prob-val">${step.probability}%</span></label>
            ${isKick ? `<label>NOTE <input type="number" min="0" max="127" value="${step.midiNote}" class="pop-note"></label>` : ''}
        `;

        pop.querySelector('.pop-vel').addEventListener('input', e => {
            this._engine.setStepVelocity(trackIdx, stepIdx, parseInt(e.target.value));
        });
        const probInput = pop.querySelector('.pop-prob');
        const probVal   = pop.querySelector('.pop-prob-val');
        probInput.addEventListener('input', e => {
            const v = parseInt(e.target.value);
            this._engine.setStepProbability(trackIdx, stepIdx, v);
            probVal.textContent = v + '%';
            anchor.classList.toggle('has-prob', v < 100);
        });
        if (isKick) {
            pop.querySelector('.pop-note').addEventListener('change', e => {
                this._engine.setStepNote(trackIdx, stepIdx, parseInt(e.target.value));
            });
        }

        // Position
        const rect = anchor.getBoundingClientRect();
        pop.style.left = `${rect.left}px`;
        pop.style.top  = `${rect.top - 10}px`;
        pop.style.transform = 'translateY(-100%)';

        document.body.appendChild(pop);
        this._popover = pop;

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', this._boundClosePopover = () => this._closePopover(), { once: true });
        }, 0);
    }

    _closePopover() {
        this._popover?.remove();
        this._popover = null;
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
