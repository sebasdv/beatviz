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

        // 909 clap = 4 bursts of filtered noise in rapid succession
        const delays = [0, 0.01, 0.02, 0.04];
        delays.forEach((delay) => {
            const bufferSize = ctx.sampleRate * 0.05;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

            const noise = ctx.createBufferSource();
            noise.buffer = noiseBuffer;

            const bandpass = ctx.createBiquadFilter();
            bandpass.type = 'bandpass';
            bandpass.frequency.value = 1200;
            bandpass.Q.value = 0.8;

            const gain = ctx.createGain();
            const isLast = delay === delays[delays.length - 1];
            const duration = isLast ? 0.15 : 0.02;
            gain.gain.setValueAtTime(velocity, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);

            noise.connect(bandpass);
            bandpass.connect(gain);
            gain.connect(ctx.destination);

            noise.start(now + delay);
            noise.stop(now + delay + duration + 0.01);
        });
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
