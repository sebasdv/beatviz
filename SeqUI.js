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
