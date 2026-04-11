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

    // ─── Clap ────────────────────────────────────────────────────────────────
    snare(velocity = 1.0) {
        const ctx = this._ctx();
        const now = ctx.currentTime;

        // 909 clap = 3 short attack bursts + 1 longer body tail
        const attacks = [0, 0.008, 0.018];
        attacks.forEach((delay) => {
            const src = this._noiseSource(ctx, 0.04);
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 1100;
            bp.Q.value = 0.5;

            const g = ctx.createGain();
            g.gain.setValueAtTime(velocity * 1.2, now + delay);
            g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.025);

            src.connect(bp); bp.connect(g); g.connect(ctx.destination);
            src.start(now + delay);
            src.stop(now + delay + 0.03);
        });

        // body: longer tail with resonant bandpass + reverb-like all-pass chain
        const body = this._noiseSource(ctx, 0.3);

        const bp1 = ctx.createBiquadFilter();
        bp1.type = 'bandpass';
        bp1.frequency.value = 900;
        bp1.Q.value = 1.2;

        const bp2 = ctx.createBiquadFilter();
        bp2.type = 'highshelf';
        bp2.frequency.value = 3000;
        bp2.gain.value = 6;

        const ap1 = ctx.createBiquadFilter();
        ap1.type = 'allpass';
        ap1.frequency.value = 800;

        const ap2 = ctx.createBiquadFilter();
        ap2.type = 'allpass';
        ap2.frequency.value = 1200;

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(velocity * 1.5, now + 0.018);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        body.connect(bp1); bp1.connect(bp2); bp2.connect(ap1);
        ap1.connect(ap2); ap2.connect(bodyGain);
        bodyGain.connect(ctx.destination);

        body.start(now + 0.018);
        body.stop(now + 0.25);
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
