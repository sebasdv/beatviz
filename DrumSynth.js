export class DrumSynth {
    constructor() {
        this.ctx = null;
        this.openHihatNode = null; // track for choke
    }

    _ctx() {
        if (!this.ctx) {
            this.ctx = new AudioContext();
        }
        return this.ctx;
    }

    // ─── Kick ────────────────────────────────────────────────────────────────
    kick(velocity = 1.0) {
        const ctx = this._ctx();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const distortion = ctx.createWaveShaper();

        // pitch envelope: 150Hz → 50Hz in 0.05s
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);

        // amplitude envelope
        gain.gain.setValueAtTime(velocity * 1.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        // soft distortion for punch
        distortion.curve = this._makeDistortionCurve(50);

        osc.connect(distortion);
        distortion.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.5);
    }

    // ─── Snare (808) ─────────────────────────────────────────────────────────
    snare(velocity = 1.0) {
        const ctx = this._ctx();
        const now = ctx.currentTime;

        // tonal body: triangle osc with pitch drop (808 snare is very tonal)
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.05);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.35);

        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(velocity * 1.0, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        // noise layer: tight highpass for the snappy top
        const noise = this._noiseSource(ctx, 0.35);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2000;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(velocity * 0.6, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc.connect(oscGain);
        oscGain.connect(ctx.destination);

        noise.connect(hp);
        hp.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.35);
        noise.start(now);
        noise.stop(now + 0.35);
    }

    _noiseSource(ctx, duration) {
        const bufferSize = Math.ceil(ctx.sampleRate * (duration + 0.05));
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        return src;
    }

    // ─── Open Hihat ──────────────────────────────────────────────────────────
    openHihat(velocity = 1.0) {
        const ctx = this._ctx();
        const now = ctx.currentTime;

        // choke previous open hihat
        this._chokeOpenHihat(now);

        const { gainNode, source } = this._makeHihat(ctx, now, velocity, 0.4);
        this.openHihatNode = { gainNode, source };
    }

    // ─── Closed Hihat ────────────────────────────────────────────────────────
    closedHihat(velocity = 1.0) {
        const ctx = this._ctx();
        const now = ctx.currentTime;

        // choke open hihat
        this._chokeOpenHihat(now);

        this._makeHihat(ctx, now, velocity, 0.08);
    }

    // ─── Shared hihat synthesis ──────────────────────────────────────────────
    _makeHihat(ctx, now, velocity, duration) {
        // 909 hihat = 6 square oscillators detuned + highpass + bandpass
        const frequencies = [205.3, 304.4, 369.9, 522.6, 635.5, 1002.4];

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(velocity * 0.4, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        const hipass = ctx.createBiquadFilter();
        hipass.type = 'highpass';
        hipass.frequency.value = 7000;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000;
        bandpass.Q.value = 0.5;

        const sources = frequencies.map(freq => {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = freq;
            osc.connect(hipass);
            osc.start(now);
            osc.stop(now + duration + 0.01);
            return osc;
        });

        hipass.connect(bandpass);
        bandpass.connect(masterGain);
        masterGain.connect(ctx.destination);

        return { gainNode: masterGain, source: sources[0] };
    }

    _chokeOpenHihat(now) {
        if (this.openHihatNode) {
            try {
                this.openHihatNode.gainNode.gain.cancelScheduledValues(now);
                this.openHihatNode.gainNode.gain.setValueAtTime(
                    this.openHihatNode.gainNode.gain.value, now
                );
                this.openHihatNode.gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.005);
            } catch (_) {}
            this.openHihatNode = null;
        }
    }

    _makeDistortionCurve(amount) {
        const samples = 256;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }
}
