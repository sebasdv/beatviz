export class DrumSynth {
    constructor() {
        this.ctx = null;
        this.openHihatNode = null;
        this.kickNode = null;

        // FX nodes (initialized in _initFX after AudioContext is created)
        this.delayNode      = null;
        this.delayFeedback  = null;
        this.delayWet       = null;
        this.reverbNode     = null;
        this.reverbWet      = null;
        this.driveNode      = null;
        this.driveHP        = null;
        this.driveWet       = null;
        this.fxOut          = null;
        // Independent send gain arrays per effect (16 instruments each)
        this.delaySends     = [];
        this.reverbSends    = [];
        this.driveSends     = [];

        // FX parameters
        this.driveAmount      = 0.0;
        this.driveTone        = 5000;
        this.delayTime        = 0.375;
        this.delayFeedbackAmt = 0.3;
        this.delayWetAmt      = 0.5;
        this.reverbSize       = 2.0;
        this.reverbDecay      = 3.0;
        this.reverbWetAmt     = 0.5;
        // Send levels per column per effect (A=col1, B=col2, C=col3, D=col4)
        this.delaySendLevels  = [0, 0, 0, 0];
        this.reverbSendLevels = [0, 0, 0, 0];
        this.driveSendLevels  = [0, 0, 0, 0];

        // Kick
        this.kickVol    = 1.0;
        this.kickDecay  = 0.8;
        this.kickTone   = 50;
        this.kickClick  = 0.6;

        // Snare
        this.snareVol   = 1.0;
        this.snareBody  = 200;
        this.snareSnap  = 1500;
        this.snareTone  = 0.8;

        // Closed HH
        this.closedVol   = 1.0;
        this.closedDecay = 0.08;
        this.closedTone  = 7000;
        this.closedColor = 10000;

        // Open HH
        this.openVol   = 1.0;
        this.openDecay = 0.4;
        this.openTone  = 7000;
        this.openColor = 10000;

        // Toms
        this.tomHighVol=1.0; this.tomHighTone=300; this.tomHighSnap=0.3; this.tomHighDecay=0.18;
        this.tomMidVol=1.0;  this.tomMidTone=180;  this.tomMidSnap=0.3;  this.tomMidDecay=0.25;
        this.tomLowVol=1.0;  this.tomLowTone=90;   this.tomLowSnap=0.25; this.tomLowDecay=0.35;

        // Rimshot
        this.rimshotVol=1.0; this.rimshotBody=400; this.rimshotSnap=1.2; this.rimshotTone=3000;

        // Clap
        this.clapVol=1.0; this.clapSpread=12; this.clapTone=1200; this.clapReverb=0.18;

        // Cowbell
        this.cowbellVol=1.0; this.cowbellTune=587; this.cowbellDecay=0.5; this.cowbellRing=8.0;

        // Clave
        this.claveVol=1.0; this.claveFreq=1500; this.claveDecay=0.06; this.claveTone=0.2;

        // Shaker
        this.shakerVol=1.0; this.shakerCut=5000; this.shakerRes=4.0; this.shakerDecay=0.08;

        // Tambourine
        this.tambourineVol=1.0; this.tambourineTone=3200; this.tambourineJingle=0.8; this.tambourineDecay=0.22;

        // Crash
        this.crashVol=1.0; this.crashDecay=1.8; this.crashTone=5000; this.crashSpread=40;

        // Ride
        this.rideVol=1.0; this.rideDecay=0.9; this.rideBell=850; this.rideShimmer=0.6;

        // Conga
        this.congaVol=1.0; this.congaTone=220; this.congaBody=12.0; this.congaDecay=0.28;
    }

    _ctx() {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this._initFX();
        }
        return this.ctx;
    }

    _initFX() {
        const ctx = this.ctx;
        const makeSends = (target) => {
            const gains = Array.from({ length: 16 }, () => {
                const g = ctx.createGain();
                g.gain.value = 0;
                g.connect(target);
                return g;
            });
            return gains;
        };

        this.fxOut = ctx.createGain();
        this.fxOut.gain.value = 1.0;
        this.fxOut.connect(ctx.destination);

        // ── Delay ────────────────────────────────────────────────────────────
        const delayBus = ctx.createGain();
        this.delayNode = ctx.createDelay(2.0);
        this.delayNode.delayTime.value = this.delayTime;
        this.delayFeedback = ctx.createGain();
        this.delayFeedback.gain.value = this.delayFeedbackAmt;
        this.delayWet = ctx.createGain();
        this.delayWet.gain.value = this.delayWetAmt;
        delayBus.connect(this.delayNode);
        this.delayNode.connect(this.delayFeedback);
        this.delayFeedback.connect(this.delayNode);
        this.delayNode.connect(this.delayWet);
        this.delayWet.connect(this.fxOut);
        this.delaySends = makeSends(delayBus);

        // ── Reverb ───────────────────────────────────────────────────────────
        const reverbBus = ctx.createGain();
        this.reverbNode = ctx.createConvolver();
        this.reverbWet = ctx.createGain();
        this.reverbWet.gain.value = this.reverbWetAmt;
        reverbBus.connect(this.reverbNode);
        this.reverbNode.connect(this.reverbWet);
        this.reverbWet.connect(this.fxOut);
        this._generateIR(this.reverbSize, this.reverbDecay);
        this.reverbSends = makeSends(reverbBus);

        // ── Drive ────────────────────────────────────────────────────────────
        const driveBus = ctx.createGain();
        this.driveNode = ctx.createWaveShaper();
        this.driveNode.curve = this._makeDistortionCurve(0);
        this.driveNode.oversample = '4x';
        this.driveHP = ctx.createBiquadFilter();
        this.driveHP.type = 'highpass';
        this.driveHP.frequency.value = this.driveTone;
        this.driveWet = ctx.createGain();
        this.driveWet.gain.value = 0.0;
        driveBus.connect(this.driveNode);
        this.driveNode.connect(this.driveHP);
        this.driveHP.connect(this.driveWet);
        this.driveWet.connect(this.fxOut);
        this.driveSends = makeSends(driveBus);
    }

    _generateIR(size, decay) {
        const ctx = this.ctx;
        const sr = ctx.sampleRate;
        const length = Math.ceil(sr * size);
        const ir = ctx.createBuffer(2, length, sr);
        for (let ch = 0; ch < 2; ch++) {
            const data = ir.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        this.reverbNode.buffer = ir;
    }

    _connectToSend(node, idx) {
        if (this.delaySends[idx])  node.connect(this.delaySends[idx]);
        if (this.reverbSends[idx]) node.connect(this.reverbSends[idx]);
        if (this.driveSends[idx])  node.connect(this.driveSends[idx]);
    }

    setDriveAmount(v)    { this.driveAmount = v; if (this.driveNode) { this.driveNode.curve = this._makeDistortionCurve(v * 400); this.driveWet.gain.value = v; } }
    setDriveTone(hz)     { this.driveTone = hz; if (this.driveHP) this.driveHP.frequency.value = hz; }
    setDelayTime(s)      { this.delayTime = s; if (this.delayNode) this.delayNode.delayTime.value = s; }
    setDelayFeedback(v)  { this.delayFeedbackAmt = v; if (this.delayFeedback) this.delayFeedback.gain.value = v; }
    setDelayWet(v)       { this.delayWetAmt = v; if (this.delayWet) this.delayWet.gain.value = v; }
    setDelaySend(col, v) { this.delaySendLevels[col] = v; const base = col * 4; if (this.delaySends.length) for (let i = base; i < base + 4; i++) this.delaySends[i].gain.value = v; }
    setReverbSend(col, v){ this.reverbSendLevels[col] = v; const base = col * 4; if (this.reverbSends.length) for (let i = base; i < base + 4; i++) this.reverbSends[i].gain.value = v; }
    setDriveSend(col, v) { this.driveSendLevels[col] = v; const base = col * 4; if (this.driveSends.length) for (let i = base; i < base + 4; i++) this.driveSends[i].gain.value = v; }
    setReverbSize(s)     { this.reverbSize = s; if (this.reverbNode) this._generateIR(s, this.reverbDecay); }
    setReverbDecay(d)    { this.reverbDecay = d; if (this.reverbNode) this._generateIR(this.reverbSize, d); }
    setReverbWet(v)      { this.reverbWetAmt = v; if (this.reverbWet) this.reverbWet.gain.value = v; }

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
        this._connectToSend(gain, 0);
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
        this._connectToSend(clickGain, 0);
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
        this._connectToSend(oscGain, 1);

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        this._connectToSend(noiseGain, 1);

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
            ctx, now, velocity * this.openVol, this.openDecay, this.openTone, this.openColor, 3
        );
        this.openHihatNode = { gainNode, source };
    }

    // ─── Closed Hihat ────────────────────────────────────────────────────────
    closedHihat(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;

        this._chokeOpenHihat(now);

        this._makeHihat(
            ctx, now, velocity * this.closedVol, this.closedDecay, this.closedTone, this.closedColor, 2
        );
    }

    // ─── Shared hihat synthesis ──────────────────────────────────────────────
    _makeHihat(ctx, now, velocity, duration, hipassHz, bandpassHz, sendIdx = -1) {
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
        if (sendIdx >= 0) this._connectToSend(masterGain, sendIdx);

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

    // ─── Toms ────────────────────────────────────────────────────────────────
    tomHigh(velocity = 1.0, startTime = null) {
        this._makeTom(this.tomHighVol, this.tomHighTone, this.tomHighSnap, this.tomHighDecay, velocity, startTime, 4);
    }

    tomMid(velocity = 1.0, startTime = null) {
        this._makeTom(this.tomMidVol, this.tomMidTone, this.tomMidSnap, this.tomMidDecay, velocity, startTime, 8);
    }

    tomLow(velocity = 1.0, startTime = null) {
        this._makeTom(this.tomLowVol, this.tomLowTone, this.tomLowSnap, this.tomLowDecay, velocity, startTime, 12);
    }

    _makeTom(vol, tone, snap, decay, velocity, startTime, sendIdx = -1) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(tone * 2.5, now);
        osc.frequency.exponentialRampToValueAtTime(tone, now + 0.03);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(velocity * vol * 1.5, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

        osc.connect(gain);
        gain.connect(ctx.destination);
        if (sendIdx >= 0) this._connectToSend(gain, sendIdx);
        osc.start(now);
        osc.stop(now + decay + 0.05);

        const noise = this._noiseSource(ctx, decay);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = tone * 3;
        bp.Q.value = 1.5;

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(velocity * vol * snap, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + decay * 0.5);

        noise.connect(bp);
        bp.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        if (sendIdx >= 0) this._connectToSend(noiseGain, sendIdx);
        noise.start(now);
        noise.stop(now + decay * 0.5 + 0.01);
    }

    // ─── Rimshot ─────────────────────────────────────────────────────────────
    rimshot(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.rimshotVol;

        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = this.rimshotBody;
        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(velocity * vol * 0.8, now);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
        osc1.connect(g1); g1.connect(ctx.destination); this._connectToSend(g1, 9);
        osc1.start(now); osc1.stop(now + 0.03);

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = this.rimshotBody * 1.5;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(velocity * vol * 0.6, now);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
        osc2.connect(g2); g2.connect(ctx.destination); this._connectToSend(g2, 9);
        osc2.start(now); osc2.stop(now + 0.025);

        const noise = this._noiseSource(ctx, 0.02);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = this.rimshotTone;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(velocity * vol * this.rimshotSnap, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
        noise.connect(hp); hp.connect(ng); ng.connect(ctx.destination); this._connectToSend(ng, 9);
        noise.start(now); noise.stop(now + 0.02);
    }

    // ─── Clap ─────────────────────────────────────────────────────────────────
    clap(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.clapVol;
        const spread = this.clapSpread * 0.001;

        for (let i = 0; i < 3; i++) {
            const t = now + i * spread;
            const noise = this._noiseSource(ctx, 0.015);
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = this.clapTone;
            const g = ctx.createGain();
            g.gain.setValueAtTime(velocity * vol * 0.7, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
            noise.connect(hp); hp.connect(g); g.connect(ctx.destination); this._connectToSend(g, 5);
            noise.start(t); noise.stop(t + 0.025);
        }

        const tail = this._noiseSource(ctx, this.clapReverb);
        const tailHp = ctx.createBiquadFilter();
        tailHp.type = 'highpass';
        tailHp.frequency.value = this.clapTone * 0.7;
        const tailG = ctx.createGain();
        const tailStart = now + spread * 3;
        tailG.gain.setValueAtTime(velocity * vol * 0.4, tailStart);
        tailG.gain.exponentialRampToValueAtTime(0.001, tailStart + this.clapReverb);
        tail.connect(tailHp); tailHp.connect(tailG); tailG.connect(ctx.destination); this._connectToSend(tailG, 5);
        tail.start(tailStart); tail.stop(tailStart + this.clapReverb + 0.01);
    }

    // ─── Cowbell ──────────────────────────────────────────────────────────────
    cowbell(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.cowbellVol;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = this.cowbellTune * 0.8;
        bp.Q.value = this.cowbellRing;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(velocity * vol * 0.5, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + this.cowbellDecay);

        [this.cowbellTune, this.cowbellTune * 1.47].forEach(freq => {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = freq;
            osc.connect(bp);
            osc.start(now);
            osc.stop(now + this.cowbellDecay + 0.05);
        });

        bp.connect(masterGain);
        masterGain.connect(ctx.destination);
        this._connectToSend(masterGain, 13);
    }

    // ─── Clave ────────────────────────────────────────────────────────────────
    clave(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.claveVol;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = this.claveFreq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(velocity * vol * 1.0, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + this.claveDecay);
        osc.connect(g); g.connect(ctx.destination); this._connectToSend(g, 6);
        osc.start(now); osc.stop(now + this.claveDecay + 0.01);

        const noise = this._noiseSource(ctx, 0.008);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(velocity * vol * this.claveTone, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + 0.008);
        noise.connect(ng); ng.connect(ctx.destination); this._connectToSend(ng, 6);
        noise.start(now); noise.stop(now + 0.01);
    }

    // ─── Shaker ───────────────────────────────────────────────────────────────
    shaker(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.shakerVol;

        const noise = this._noiseSource(ctx, this.shakerDecay);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = this.shakerCut;
        bp.Q.value = this.shakerRes;

        const g = ctx.createGain();
        g.gain.setValueAtTime(velocity * vol * 0.6, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + this.shakerDecay);

        noise.connect(bp); bp.connect(g); g.connect(ctx.destination); this._connectToSend(g, 10);
        noise.start(now); noise.stop(now + this.shakerDecay + 0.01);
    }

    // ─── Tambourine ───────────────────────────────────────────────────────────
    tambourine(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.tambourineVol;

        const noise = this._noiseSource(ctx, this.tambourineDecay);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(velocity * vol * 0.5, now);
        ng.gain.exponentialRampToValueAtTime(0.001, now + this.tambourineDecay);
        noise.connect(hp); hp.connect(ng); ng.connect(ctx.destination); this._connectToSend(ng, 14);
        noise.start(now); noise.stop(now + this.tambourineDecay + 0.01);

        [-50, 0, 50].forEach(detune => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = this.tambourineTone + detune;
            const og = ctx.createGain();
            og.gain.setValueAtTime(velocity * vol * this.tambourineJingle * 0.15, now);
            og.gain.exponentialRampToValueAtTime(0.001, now + this.tambourineDecay * 0.6);
            osc.connect(og); og.connect(ctx.destination); this._connectToSend(og, 14);
            osc.start(now); osc.stop(now + this.tambourineDecay * 0.6 + 0.01);
        });
    }

    // ─── Crash ────────────────────────────────────────────────────────────────
    crash(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.crashVol;

        const freqs = [205.3, 304.4, 369.9, 522.6, 635.5, 1002.4,
                       144.7, 421.3, 731.2, 893.5, 1156.8, 1487.2];

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(velocity * vol * 0.35, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + this.crashDecay);

        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = this.crashTone;

        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = freq + (i % 3) * this.crashSpread;
            osc.connect(hp);
            osc.start(now);
            osc.stop(now + this.crashDecay + 0.05);
        });

        hp.connect(masterGain);
        masterGain.connect(ctx.destination);
        this._connectToSend(masterGain, 7);
    }

    // ─── Ride ─────────────────────────────────────────────────────────────────
    ride(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.rideVol;

        const bell = ctx.createOscillator();
        bell.type = 'sine';
        bell.frequency.value = this.rideBell;
        const bellGain = ctx.createGain();
        bellGain.gain.setValueAtTime(velocity * vol * 0.6, now);
        bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        bell.connect(bellGain); bellGain.connect(ctx.destination); this._connectToSend(bellGain, 11);
        bell.start(now); bell.stop(now + 0.15);

        this._makeHihat(ctx, now, velocity * vol * this.rideShimmer, this.rideDecay, 8000, 12000, 11);
    }

    // ─── Conga ────────────────────────────────────────────────────────────────
    conga(velocity = 1.0, startTime = null) {
        const ctx = this._ctx();
        const now = startTime ?? ctx.currentTime;
        const vol = this.congaVol;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(this.congaTone * 1.8, now);
        osc.frequency.exponentialRampToValueAtTime(this.congaTone, now + 0.04);

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = this.congaTone;
        bp.Q.value = this.congaBody;

        const g = ctx.createGain();
        g.gain.setValueAtTime(velocity * vol * 1.2, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + this.congaDecay);

        osc.connect(bp); bp.connect(g); g.connect(ctx.destination); this._connectToSend(g, 15);
        osc.start(now); osc.stop(now + this.congaDecay + 0.05);
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
