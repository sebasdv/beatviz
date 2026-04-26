export class DrumSynth {
    constructor() {
        this.ctx = null;
        this.openHihatNode = null;
        this.kickNode = null;

        // Kick
        this.kickVol    = 1.0;
        this.kickDecay  = 0.8;
        this.kickTone   = 50;   // targetHz when no MIDI note
        this.kickClick  = 0.6;  // click attack level

        // Snare
        this.snareVol   = 1.0;
        this.snareBody  = 200;  // body oscillator start Hz
        this.snareSnap  = 1500; // noise highpass cutoff Hz
        this.snareTone  = 0.8;  // noise level multiplier

        // Closed HH
        this.closedVol   = 1.0;
        this.closedDecay = 0.08;
        this.closedTone  = 7000;  // highpass cutoff Hz
        this.closedColor = 10000; // bandpass center Hz

        // Open HH
        this.openVol   = 1.0;
        this.openDecay = 0.4;
        this.openTone  = 7000;
        this.openColor = 10000;
    }

    _ctx() {
        if (!this.ctx) {
            this.ctx = new AudioContext();
        }
        return this.ctx;
    }

    // ─── Kick 808 ────────────────────────────────────────────────────────────
    kick(velocity = 1.0, midiNote = null, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const decay = this.kickDecay;
        const vol   = this.kickVol;

        if (this.kickNode) {
            try {
                this.kickNode.gain.cancelScheduledValues(now);
                this.kickNode.gain.setValueAtTime(this.kickNode.gain.value, now);
                this.kickNode.gain.exponentialRampToValueAtTime(0.001, now + 0.002);
            } catch (_) {}
            this.kickNode = null;
        }

        const targetHz = Math.max(
            midiNote !== null ? 440 * Math.pow(2, (midiNote - 69) / 12) : this.kickTone,
            20
        );
        const startHz = targetHz * 2.5;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(startHz, now);
        osc.frequency.exponentialRampToValueAtTime(targetHz, now + 0.04);
        osc.frequency.setValueAtTime(targetHz, now + 0.04);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(velocity * vol * 2.0, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + decay + 0.05);

        this.kickNode = gain;

        const click = ctx.createOscillator();
        click.type = 'sine';
        click.frequency.setValueAtTime(1200, now);
        click.frequency.exponentialRampToValueAtTime(80, now + 0.008);

        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(velocity * vol * this.kickClick, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.012);

        click.connect(clickGain);
        clickGain.connect(ctx.destination);
        click.start(now);
        click.stop(now + 0.015);
    }

    // ─── Snare (909) ─────────────────────────────────────────────────────────
    snare(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol  = this.snareVol;

        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(this.snareBody, now);
        osc.frequency.exponentialRampToValueAtTime(this.snareBody * 0.5, now + 0.1);
        oscGain.gain.setValueAtTime(velocity * vol * 0.7, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        const noise = this._noiseSource(ctx, 0.3);

        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = this.snareSnap;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(velocity * vol * this.snareTone, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(oscGain);
        oscGain.connect(ctx.destination);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.2);
        noise.start(now);
        noise.stop(now + 0.3);
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
    openHihat(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;

        this._chokeOpenHihat(now);

        const { gainNode, source } = this._makeHihat(
            ctx, now, velocity * this.openVol, this.openDecay, this.openTone, this.openColor
        );
        this.openHihatNode = { gainNode, source };
    }

    // ─── Closed Hihat ────────────────────────────────────────────────────────
    closedHihat(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;

        this._chokeOpenHihat(now);

        this._makeHihat(
            ctx, now, velocity * this.closedVol, this.closedDecay, this.closedTone, this.closedColor
        );
    }

    // ─── Shared hihat synthesis ──────────────────────────────────────────────
    _makeHihat(ctx, now, velocity, duration, hipassHz, bandpassHz) {
        const frequencies = [205.3, 304.4, 369.9, 522.6, 635.5, 1002.4];

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(velocity * 0.4, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        const hipass = ctx.createBiquadFilter();
        hipass.type = 'highpass';
        hipass.frequency.value = hipassHz;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = bandpassHz;
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
