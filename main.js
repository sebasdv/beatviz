import { MidiManager } from './MidiManager.js';
import { Visualizer } from './Visualizer.js';
import { CCMapper } from './CCMapper.js';
import { DrumSynth } from './DrumSynth.js';
import GUI from 'https://unpkg.com/lil-gui@0.19.1/dist/lil-gui.esm.min.js';

const startButton = document.getElementById('start-audio');
const overlay = document.getElementById('overlay');

let midiManager;
let visualizer;
let ccMapper;
let drumSynth;

const INSTRUMENTS = {
    kick:        { defaultNote: 48, channel: 0, mono: false },
    snare:       { defaultNote: 49, channel: 0 },
    closedHihat: { defaultNote: 50, channel: 0 },
    openHihat:   { defaultNote: 51, channel: 0 },
    tomHigh:     { defaultNote: 52, channel: 0 },
    tomMid:      { defaultNote: 53, channel: 0 },
    tomLow:      { defaultNote: 54, channel: 0 },
    rimshot:     { defaultNote: 55, channel: 0 },
    clap:        { defaultNote: 56, channel: 0 },
    cowbell:     { defaultNote: 57, channel: 0 },
    clave:       { defaultNote: 58, channel: 0 },
    shaker:      { defaultNote: 59, channel: 0 },
    tambourine:  { defaultNote: 60, channel: 0 },
    crash:       { defaultNote: 61, channel: 0 },
    ride:        { defaultNote: 62, channel: 0 },
    conga:       { defaultNote: 63, channel: 0 },
};

async function init() {
    visualizer = new Visualizer('canvas-container');
    ccMapper = new CCMapper();
    drumSynth = new DrumSynth();

    midiManager = new MidiManager();
    const midiAccess = await midiManager.init();

    if (midiAccess) {
        startButton.textContent = "MIDI Connected";
        startButton.style.background = "rgba(0, 255, 0, 0.2)";
    } else {
        startButton.textContent = "MIDI Failed";
        startButton.style.background = "rgba(255, 0, 0, 0.2)";
    }

    setupGUI();

    midiManager.on('noteOn', ({ note, velocity, channel }) => {
        const k = INSTRUMENTS.kick;
        if (channel === k.channel && (k.mono || note === k.defaultNote)) {
            drumSynth.kick(velocity, k.mono ? note : null);
            visualizer.triggerNote(k.defaultNote, velocity);
            return;
        }
        for (const [name, cfg] of Object.entries(INSTRUMENTS)) {
            if (name === 'kick') continue;
            if (channel === cfg.channel && note === cfg.defaultNote) {
                drumSynth[name](velocity);
                visualizer.triggerNote(cfg.defaultNote, velocity);
                return;
            }
        }
    });

    midiManager.on('cc', (data) => {
        ccMapper.handleCC(data.cc, data.value);
    });
}

function addMappable(folder, params, key, min, max, label, handler) {
    const controller = folder.add(params, key, min, max).name(label).onChange(handler);

    const normalizedHandler = (v) => {
        const mapped = min + v * (max - min);
        params[key] = mapped;
        controller.updateDisplay();
        handler(mapped);
    };

    ccMapper.register(key, normalizedHandler);

    const learnParams = { learn: () => {} };
    const learnBtn = folder.add(learnParams, 'learn').name(learnLabel(key));
    learnParams.learn = () => startLearn(key, learnBtn);

    return { controller, learnBtn, normalizedHandler };
}

function learnLabel(paramName) {
    const cc = ccMapper?.getAssignment(paramName);
    return cc !== undefined ? `CC ${cc} ✓` : 'Learn CC';
}

function startLearn(paramName, learnBtn) {
    learnBtn.name('Waiting...');
    ccMapper.learn(paramName, (cc) => {
        learnBtn.name(`CC ${cc} ✓`);
    });
}

function setupGUI() {
    const gui = new GUI({ title: 'BeatViz Controls', width: 260 });
    gui.domElement.style.maxHeight = '90vh';
    gui.domElement.style.overflowY = 'auto';

    const visualParams = {
        hueOffset:     0.0,
        baseBright:    0.0,
        opacity:       0.9,
        bloomStrength: 1.5,
    };

    const folderVisual = gui.addFolder('Visual');
    addMappable(folderVisual, visualParams, 'hueOffset',     0, 1, 'Hue Offset',  v => visualizer.updateCC(24, v));
    addMappable(folderVisual, visualParams, 'baseBright',    0, 1, 'Base Bright', v => visualizer.updateCC(25, v));
    addMappable(folderVisual, visualParams, 'opacity',       0, 1, 'Opacity',     v => visualizer.updateCC(26, v));
    addMappable(folderVisual, visualParams, 'bloomStrength', 0, 5, 'Bloom',       v => visualizer.setBloomStrength(v));

    const physicsParams = { springK: 30.0, damping: 0.92, decaySpeed: 2.0, impulseForce: 15.0 };

    const folderPhysics = gui.addFolder('Physics');
    addMappable(folderPhysics, physicsParams, 'springK',      5,   80,  'Spring K',      v => visualizer.setPhysics({ springK: v }));
    addMappable(folderPhysics, physicsParams, 'damping',      0.5, 1.0, 'Damping',       v => visualizer.setPhysics({ damping: v }));
    addMappable(folderPhysics, physicsParams, 'decaySpeed',   0.5, 8,   'Color Decay',   v => visualizer.setPhysics({ decaySpeed: v }));
    addMappable(folderPhysics, physicsParams, 'impulseForce', 1,   40,  'Impulse Force', v => visualizer.setPhysics({ impulseForce: v }));

    // ── Kick ──────────────────────────────────────────────────────────────────
    const kickParams = { kickVol: 1.0, kickDecay: 0.8, kickTone: 50, kickClick: 0.6 };
    const folderKick = gui.addFolder('Kick');
    const kickVolH = addMappable(folderKick, kickParams, 'kickVol',   0, 1,    'Vol',     v => { drumSynth.kickVol   = v; visualizer.setCellVol(0,  v); }).normalizedHandler;
    addMappable(folderKick, kickParams, 'kickDecay', 0.2, 2.5,'Decay',   v => { drumSynth.kickDecay = v; });
    addMappable(folderKick, kickParams, 'kickTone',  20, 200, 'Tone Hz', v => { drumSynth.kickTone  = v; });
    addMappable(folderKick, kickParams, 'kickClick', 0, 1,    'Click',   v => { drumSynth.kickClick = v; });

    // ── Snare ─────────────────────────────────────────────────────────────────
    const snareParams = { snareVol: 1.0, snareBody: 200, snareSnap: 1500, snareTone: 0.8 };
    const folderSnare = gui.addFolder('Snare');
    const snareVolH = addMappable(folderSnare, snareParams, 'snareVol',  0, 1,     'Vol',     v => { drumSynth.snareVol  = v; visualizer.setCellVol(1,  v); }).normalizedHandler;
    addMappable(folderSnare, snareParams, 'snareBody', 80, 400,  'Body Hz', v => { drumSynth.snareBody = v; });
    addMappable(folderSnare, snareParams, 'snareSnap', 500, 5000,'Snap Hz', v => { drumSynth.snareSnap = v; });
    addMappable(folderSnare, snareParams, 'snareTone', 0, 1.5,  'Noise',   v => { drumSynth.snareTone = v; });

    // ── Closed HH ─────────────────────────────────────────────────────────────
    const closedParams = { closedVol: 1.0, closedDecay: 0.08, closedTone: 7000, closedColor: 10000 };
    const folderClosed = gui.addFolder('Closed HH');
    const closedVolH = addMappable(folderClosed, closedParams, 'closedVol',   0, 1,      'Vol',      v => { drumSynth.closedVol   = v; visualizer.setCellVol(2,  v); }).normalizedHandler;
    addMappable(folderClosed, closedParams, 'closedDecay', 0.02, 0.3, 'Decay',    v => { drumSynth.closedDecay = v; });
    addMappable(folderClosed, closedParams, 'closedTone',  2000, 15000,'Tone Hz', v => { drumSynth.closedTone  = v; });
    addMappable(folderClosed, closedParams, 'closedColor', 5000, 20000,'Color Hz',v => { drumSynth.closedColor = v; });

    // ── Open HH ───────────────────────────────────────────────────────────────
    const openParams = { openVol: 1.0, openDecay: 0.4, openTone: 7000, openColor: 10000 };
    const folderOpen = gui.addFolder('Open HH');
    const openVolH = addMappable(folderOpen, openParams, 'openVol',   0, 1,      'Vol',      v => { drumSynth.openVol   = v; visualizer.setCellVol(3,  v); }).normalizedHandler;
    addMappable(folderOpen, openParams, 'openDecay', 0.1, 1.5,  'Decay',    v => { drumSynth.openDecay = v; });
    addMappable(folderOpen, openParams, 'openTone',  2000, 15000,'Tone Hz', v => { drumSynth.openTone  = v; });
    addMappable(folderOpen, openParams, 'openColor', 5000, 20000,'Color Hz',v => { drumSynth.openColor = v; });

    // ── Tom High ──────────────────────────────────────────────────────────────
    const tomHighParams = { tomHighVol:1.0, tomHighTone:300, tomHighSnap:0.3, tomHighDecay:0.18 };
    const folderTomHigh = gui.addFolder('Tom High');
    const tomHighVolH = addMappable(folderTomHigh, tomHighParams, 'tomHighVol',   0, 1,     'Vol',     v => { drumSynth.tomHighVol   = v; visualizer.setCellVol(4,  v); }).normalizedHandler;
    addMappable(folderTomHigh, tomHighParams, 'tomHighTone', 100, 600,  'Tone Hz', v => { drumSynth.tomHighTone  = v; });
    addMappable(folderTomHigh, tomHighParams, 'tomHighSnap',  0, 1,     'Snap',    v => { drumSynth.tomHighSnap  = v; });
    addMappable(folderTomHigh, tomHighParams, 'tomHighDecay', 0.05, 0.6,'Decay',   v => { drumSynth.tomHighDecay = v; });

    // ── Tom Mid ───────────────────────────────────────────────────────────────
    const tomMidParams = { tomMidVol:1.0, tomMidTone:180, tomMidSnap:0.3, tomMidDecay:0.25 };
    const folderTomMid = gui.addFolder('Tom Mid');
    const tomMidVolH = addMappable(folderTomMid, tomMidParams, 'tomMidVol',   0, 1,     'Vol',     v => { drumSynth.tomMidVol   = v; visualizer.setCellVol(5,  v); }).normalizedHandler;
    addMappable(folderTomMid, tomMidParams, 'tomMidTone',  60, 400,  'Tone Hz', v => { drumSynth.tomMidTone  = v; });
    addMappable(folderTomMid, tomMidParams, 'tomMidSnap',  0, 1,     'Snap',    v => { drumSynth.tomMidSnap  = v; });
    addMappable(folderTomMid, tomMidParams, 'tomMidDecay', 0.05, 0.8,'Decay',   v => { drumSynth.tomMidDecay = v; });

    // ── Tom Low ───────────────────────────────────────────────────────────────
    const tomLowParams = { tomLowVol:1.0, tomLowTone:90, tomLowSnap:0.25, tomLowDecay:0.35 };
    const folderTomLow = gui.addFolder('Tom Low');
    const tomLowVolH = addMappable(folderTomLow, tomLowParams, 'tomLowVol',   0, 1,     'Vol',     v => { drumSynth.tomLowVol   = v; visualizer.setCellVol(6,  v); }).normalizedHandler;
    addMappable(folderTomLow, tomLowParams, 'tomLowTone',  40, 250,  'Tone Hz', v => { drumSynth.tomLowTone  = v; });
    addMappable(folderTomLow, tomLowParams, 'tomLowSnap',  0, 1,     'Snap',    v => { drumSynth.tomLowSnap  = v; });
    addMappable(folderTomLow, tomLowParams, 'tomLowDecay', 0.1, 1.0, 'Decay',   v => { drumSynth.tomLowDecay = v; });

    // ── Rimshot ───────────────────────────────────────────────────────────────
    const rimshotParams = { rimshotVol:1.0, rimshotBody:400, rimshotSnap:1.2, rimshotTone:3000 };
    const folderRimshot = gui.addFolder('Rimshot');
    const rimshotVolH = addMappable(folderRimshot, rimshotParams, 'rimshotVol',  0, 1,     'Vol',     v => { drumSynth.rimshotVol  = v; visualizer.setCellVol(7,  v); }).normalizedHandler;
    addMappable(folderRimshot, rimshotParams, 'rimshotBody', 200, 800, 'Body Hz', v => { drumSynth.rimshotBody = v; });
    addMappable(folderRimshot, rimshotParams, 'rimshotSnap', 0, 2,     'Snap',    v => { drumSynth.rimshotSnap = v; });
    addMappable(folderRimshot, rimshotParams, 'rimshotTone', 1000,8000,'Tone Hz', v => { drumSynth.rimshotTone = v; });

    // ── Clap ──────────────────────────────────────────────────────────────────
    const clapParams = { clapVol:1.0, clapSpread:12, clapTone:1200, clapReverb:0.18 };
    const folderClap = gui.addFolder('Clap');
    const clapVolH = addMappable(folderClap, clapParams, 'clapVol',    0, 1,    'Vol',     v => { drumSynth.clapVol    = v; visualizer.setCellVol(8,  v); }).normalizedHandler;
    addMappable(folderClap, clapParams, 'clapSpread', 2, 40,   'Spread ms',v => { drumSynth.clapSpread = v; });
    addMappable(folderClap, clapParams, 'clapTone',   400,4000,'Tone Hz', v => { drumSynth.clapTone   = v; });
    addMappable(folderClap, clapParams, 'clapReverb', 0.05,0.5,'Reverb',  v => { drumSynth.clapReverb = v; });

    // ── Cowbell ───────────────────────────────────────────────────────────────
    const cowbellParams = { cowbellVol:1.0, cowbellTune:587, cowbellDecay:0.5, cowbellRing:8.0 };
    const folderCowbell = gui.addFolder('Cowbell');
    const cowbellVolH = addMappable(folderCowbell, cowbellParams, 'cowbellVol',   0, 1,     'Vol',     v => { drumSynth.cowbellVol   = v; visualizer.setCellVol(9,  v); }).normalizedHandler;
    addMappable(folderCowbell, cowbellParams, 'cowbellTune',  300,1200, 'Tune Hz', v => { drumSynth.cowbellTune  = v; });
    addMappable(folderCowbell, cowbellParams, 'cowbellDecay', 0.1, 2.0, 'Decay',   v => { drumSynth.cowbellDecay = v; });
    addMappable(folderCowbell, cowbellParams, 'cowbellRing',  1, 20,    'Ring',    v => { drumSynth.cowbellRing  = v; });

    // ── Clave ─────────────────────────────────────────────────────────────────
    const claveParams = { claveVol:1.0, claveFreq:1500, claveDecay:0.06, claveTone:0.2 };
    const folderClave = gui.addFolder('Clave');
    const claveVolH = addMappable(folderClave, claveParams, 'claveVol',   0, 1,     'Vol',     v => { drumSynth.claveVol   = v; visualizer.setCellVol(10, v); }).normalizedHandler;
    addMappable(folderClave, claveParams, 'claveFreq',  600,3000, 'Freq Hz', v => { drumSynth.claveFreq  = v; });
    addMappable(folderClave, claveParams, 'claveDecay', 0.02,0.2, 'Decay',   v => { drumSynth.claveDecay = v; });
    addMappable(folderClave, claveParams, 'claveTone',  0, 1,     'Click',   v => { drumSynth.claveTone  = v; });

    // ── Shaker ────────────────────────────────────────────────────────────────
    const shakerParams = { shakerVol:1.0, shakerCut:5000, shakerRes:4.0, shakerDecay:0.08 };
    const folderShaker = gui.addFolder('Shaker');
    const shakerVolH = addMappable(folderShaker, shakerParams, 'shakerVol',   0, 1,      'Vol',   v => { drumSynth.shakerVol   = v; visualizer.setCellVol(11, v); }).normalizedHandler;
    addMappable(folderShaker, shakerParams, 'shakerCut',   1000,12000,'Cut Hz',v => { drumSynth.shakerCut   = v; });
    addMappable(folderShaker, shakerParams, 'shakerRes',   0.5, 15,   'Res',   v => { drumSynth.shakerRes   = v; });
    addMappable(folderShaker, shakerParams, 'shakerDecay', 0.02,0.3,  'Decay', v => { drumSynth.shakerDecay = v; });

    // ── Tambourine ────────────────────────────────────────────────────────────
    const tambourineParams = { tambourineVol:1.0, tambourineTone:3200, tambourineJingle:0.8, tambourineDecay:0.22 };
    const folderTambourine = gui.addFolder('Tambourine');
    const tambourineVolH = addMappable(folderTambourine, tambourineParams, 'tambourineVol',    0, 1,     'Vol',    v => { drumSynth.tambourineVol    = v; visualizer.setCellVol(12, v); }).normalizedHandler;
    addMappable(folderTambourine, tambourineParams, 'tambourineTone',   1000,6000,'Tone Hz',v => { drumSynth.tambourineTone   = v; });
    addMappable(folderTambourine, tambourineParams, 'tambourineJingle', 0, 2,     'Jingle', v => { drumSynth.tambourineJingle = v; });
    addMappable(folderTambourine, tambourineParams, 'tambourineDecay',  0.05,0.5, 'Decay',  v => { drumSynth.tambourineDecay  = v; });

    // ── Crash ─────────────────────────────────────────────────────────────────
    const crashParams = { crashVol:1.0, crashDecay:1.8, crashTone:5000, crashSpread:40 };
    const folderCrash = gui.addFolder('Crash');
    const crashVolH = addMappable(folderCrash, crashParams, 'crashVol',    0, 1,      'Vol',    v => { drumSynth.crashVol    = v; visualizer.setCellVol(13, v); }).normalizedHandler;
    addMappable(folderCrash, crashParams, 'crashDecay',  0.5, 4.0,  'Decay',  v => { drumSynth.crashDecay  = v; });
    addMappable(folderCrash, crashParams, 'crashTone',   2000,12000,'Tone Hz',v => { drumSynth.crashTone   = v; });
    addMappable(folderCrash, crashParams, 'crashSpread', 0, 100,    'Spread', v => { drumSynth.crashSpread = v; });

    // ── Ride ──────────────────────────────────────────────────────────────────
    const rideParams = { rideVol:1.0, rideDecay:0.9, rideBell:850, rideShimmer:0.6 };
    const folderRide = gui.addFolder('Ride');
    const rideVolH = addMappable(folderRide, rideParams, 'rideVol',     0, 1,     'Vol',     v => { drumSynth.rideVol     = v; visualizer.setCellVol(14, v); }).normalizedHandler;
    addMappable(folderRide, rideParams, 'rideDecay',   0.2, 3.0, 'Decay',   v => { drumSynth.rideDecay   = v; });
    addMappable(folderRide, rideParams, 'rideBell',    300,2000, 'Bell Hz', v => { drumSynth.rideBell    = v; });
    addMappable(folderRide, rideParams, 'rideShimmer', 0, 1,     'Shimmer', v => { drumSynth.rideShimmer = v; });

    // ── Conga ─────────────────────────────────────────────────────────────────
    const congaParams = { congaVol:1.0, congaTone:220, congaBody:12.0, congaDecay:0.28 };
    const folderConga = gui.addFolder('Conga');
    const congaVolH = addMappable(folderConga, congaParams, 'congaVol',   0, 1,     'Vol',     v => { drumSynth.congaVol   = v; visualizer.setCellVol(15, v); }).normalizedHandler;
    addMappable(folderConga, congaParams, 'congaTone',  80, 500,  'Tone Hz', v => { drumSynth.congaTone  = v; });
    addMappable(folderConga, congaParams, 'congaBody',  1, 30,    'Body Q',  v => { drumSynth.congaBody  = v; });
    addMappable(folderConga, congaParams, 'congaDecay', 0.1, 1.0, 'Decay',   v => { drumSynth.congaDecay = v; });

    // ── Macros ────────────────────────────────────────────────────────────────
    // Col 1: Kick / Tom High / Clap / Tambourine
    // Col 2: Snare / Tom Mid / Cowbell / Crash
    // Col 3: Closed HH / Tom Low / Clave / Ride
    // Col 4: Open HH / Rimshot / Shaker / Conga
    const folderMacros = gui.addFolder('Macros');

    function addMacro(key, label, handlers) {
        const macroParams = { [key]: 1.0 };
        const ctrl = folderMacros.add(macroParams, key, 0, 1).name(label);
        ctrl.onChange(v => { for (const h of handlers) h(v); });
        const allHandlers = [...handlers, v => { macroParams[key] = v; ctrl.updateDisplay(); }];
        ccMapper.registerMacro(key, allHandlers);
        const learnParams = { learn: () => {} };
        const learnBtn = folderMacros.add(learnParams, 'learn').name(learnLabel(key));
        learnParams.learn = () => startLearn(key, learnBtn);
    }

    addMacro('macro_vol1', 'Vol Col 1', [kickVolH, tomHighVolH, clapVolH, tambourineVolH]);
    addMacro('macro_vol2', 'Vol Col 2', [snareVolH, tomMidVolH, cowbellVolH, crashVolH]);
    addMacro('macro_vol3', 'Vol Col 3', [closedVolH, tomLowVolH, claveVolH, rideVolH]);
    addMacro('macro_vol4', 'Vol Col 4', [openVolH, rimshotVolH, shakerVolH, congaVolH]);

    const midiChParams = {
        kickCh: 1,         kickNote: 48,
        snareCh: 1,        snareNote: 49,
        closedCh: 1,       closedNote: 50,
        openCh: 1,         openNote: 51,
        tomHighCh: 1,      tomHighNote: 52,
        tomMidCh: 1,       tomMidNote: 53,
        tomLowCh: 1,       tomLowNote: 54,
        rimshotCh: 1,      rimshotNote: 55,
        clapCh: 1,         clapNote: 56,
        cowbellCh: 1,      cowbellNote: 57,
        claveCh: 1,        claveNote: 58,
        shakerCh: 1,       shakerNote: 59,
        tambourineCh: 1,   tambourineNote: 60,
        crashCh: 1,        crashNote: 61,
        rideCh: 1,         rideNote: 62,
        congaCh: 1,        congaNote: 63,
    };
    const folderMidi = gui.addFolder('MIDI Routing');
    folderMidi.add(midiChParams, 'kickCh',         1,16,1).name('Kick Ch').onChange(v        => { INSTRUMENTS.kick.channel        = v-1; });
    folderMidi.add(midiChParams, 'kickNote',        0,127,1).name('Kick Note').onChange(v     => { INSTRUMENTS.kick.defaultNote    = v; });
    folderMidi.add(midiChParams, 'snareCh',         1,16,1).name('Snare Ch').onChange(v       => { INSTRUMENTS.snare.channel       = v-1; });
    folderMidi.add(midiChParams, 'snareNote',       0,127,1).name('Snare Note').onChange(v    => { INSTRUMENTS.snare.defaultNote   = v; });
    folderMidi.add(midiChParams, 'closedCh',        1,16,1).name('Closed HH Ch').onChange(v   => { INSTRUMENTS.closedHihat.channel = v-1; });
    folderMidi.add(midiChParams, 'closedNote',      0,127,1).name('Closed HH Note').onChange(v=> { INSTRUMENTS.closedHihat.defaultNote = v; });
    folderMidi.add(midiChParams, 'openCh',          1,16,1).name('Open HH Ch').onChange(v     => { INSTRUMENTS.openHihat.channel   = v-1; });
    folderMidi.add(midiChParams, 'openNote',        0,127,1).name('Open HH Note').onChange(v  => { INSTRUMENTS.openHihat.defaultNote = v; });
    folderMidi.add(midiChParams, 'tomHighCh',       1,16,1).name('TomHigh Ch').onChange(v     => { INSTRUMENTS.tomHigh.channel     = v-1; });
    folderMidi.add(midiChParams, 'tomHighNote',     0,127,1).name('TomHigh Note').onChange(v  => { INSTRUMENTS.tomHigh.defaultNote = v; });
    folderMidi.add(midiChParams, 'tomMidCh',        1,16,1).name('TomMid Ch').onChange(v      => { INSTRUMENTS.tomMid.channel      = v-1; });
    folderMidi.add(midiChParams, 'tomMidNote',      0,127,1).name('TomMid Note').onChange(v   => { INSTRUMENTS.tomMid.defaultNote  = v; });
    folderMidi.add(midiChParams, 'tomLowCh',        1,16,1).name('TomLow Ch').onChange(v      => { INSTRUMENTS.tomLow.channel      = v-1; });
    folderMidi.add(midiChParams, 'tomLowNote',      0,127,1).name('TomLow Note').onChange(v   => { INSTRUMENTS.tomLow.defaultNote  = v; });
    folderMidi.add(midiChParams, 'rimshotCh',       1,16,1).name('Rimshot Ch').onChange(v     => { INSTRUMENTS.rimshot.channel     = v-1; });
    folderMidi.add(midiChParams, 'rimshotNote',     0,127,1).name('Rimshot Note').onChange(v  => { INSTRUMENTS.rimshot.defaultNote = v; });
    folderMidi.add(midiChParams, 'clapCh',          1,16,1).name('Clap Ch').onChange(v        => { INSTRUMENTS.clap.channel        = v-1; });
    folderMidi.add(midiChParams, 'clapNote',        0,127,1).name('Clap Note').onChange(v     => { INSTRUMENTS.clap.defaultNote    = v; });
    folderMidi.add(midiChParams, 'cowbellCh',       1,16,1).name('Cowbell Ch').onChange(v     => { INSTRUMENTS.cowbell.channel     = v-1; });
    folderMidi.add(midiChParams, 'cowbellNote',     0,127,1).name('Cowbell Note').onChange(v  => { INSTRUMENTS.cowbell.defaultNote = v; });
    folderMidi.add(midiChParams, 'claveCh',         1,16,1).name('Clave Ch').onChange(v       => { INSTRUMENTS.clave.channel       = v-1; });
    folderMidi.add(midiChParams, 'claveNote',       0,127,1).name('Clave Note').onChange(v    => { INSTRUMENTS.clave.defaultNote   = v; });
    folderMidi.add(midiChParams, 'shakerCh',        1,16,1).name('Shaker Ch').onChange(v      => { INSTRUMENTS.shaker.channel      = v-1; });
    folderMidi.add(midiChParams, 'shakerNote',      0,127,1).name('Shaker Note').onChange(v   => { INSTRUMENTS.shaker.defaultNote  = v; });
    folderMidi.add(midiChParams, 'tambourineCh',    1,16,1).name('Tambourine Ch').onChange(v  => { INSTRUMENTS.tambourine.channel  = v-1; });
    folderMidi.add(midiChParams, 'tambourineNote',  0,127,1).name('Tambourine Note').onChange(v=>{ INSTRUMENTS.tambourine.defaultNote = v; });
    folderMidi.add(midiChParams, 'crashCh',         1,16,1).name('Crash Ch').onChange(v       => { INSTRUMENTS.crash.channel       = v-1; });
    folderMidi.add(midiChParams, 'crashNote',       0,127,1).name('Crash Note').onChange(v    => { INSTRUMENTS.crash.defaultNote   = v; });
    folderMidi.add(midiChParams, 'rideCh',          1,16,1).name('Ride Ch').onChange(v        => { INSTRUMENTS.ride.channel        = v-1; });
    folderMidi.add(midiChParams, 'rideNote',        0,127,1).name('Ride Note').onChange(v     => { INSTRUMENTS.ride.defaultNote    = v; });
    folderMidi.add(midiChParams, 'congaCh',         1,16,1).name('Conga Ch').onChange(v       => { INSTRUMENTS.conga.channel       = v-1; });
    folderMidi.add(midiChParams, 'congaNote',       0,127,1).name('Conga Note').onChange(v    => { INSTRUMENTS.conga.defaultNote   = v; });

    const clearParams = { clearAll: () => {
        ccMapper.assignments = {};
        ccMapper._save();
        // reload to reset all learn button labels
        location.reload();
    }};
    gui.add(clearParams, 'clearAll').name('Clear All CC');

    for (const folder of gui.folders) folder.close();
}

// Keyboard → MIDI note mapping (4x4 grid, notes 48-63)
const KEY_TO_NOTE = {
    'q': 48, 'w': 49, 'e': 50, 'r': 51, 't': 52, 'y': 53, 'u': 54, 'i': 55,
    'a': 56, 's': 57, 'd': 58, 'f': 59, 'g': 60, 'h': 61, 'j': 62, 'k': 63,
};

function setupKeyboard() {
    const heldKeys = new Set();

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (!(key in KEY_TO_NOTE) || heldKeys.has(key)) return;
        heldKeys.add(key);
        const note = KEY_TO_NOTE[key];
        const k = INSTRUMENTS.kick;
        if (note === k.defaultNote) {
            drumSynth.kick(1.0, null);
            visualizer.triggerNote(note, 1.0);
            return;
        }
        for (const [name, cfg] of Object.entries(INSTRUMENTS)) {
            if (name === 'kick') continue;
            if (cfg.defaultNote === note) {
                drumSynth[name](1.0);
                visualizer.triggerNote(note, 1.0);
                return;
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        heldKeys.delete(e.key.toLowerCase());
    });
}

startButton.addEventListener('click', () => {
    overlay.style.opacity = 0;
    overlay.style.pointerEvents = 'none';
    init();
    startButton.disabled = true;
    setupKeyboard();
});

const fullscreenBtn = document.getElementById('fullscreen-btn');
fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
        fullscreenBtn.textContent = '✕';
    } else {
        document.exitFullscreen();
        fullscreenBtn.textContent = '⛶';
    }
});
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        fullscreenBtn.textContent = '⛶';
    }
});
