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

// instrumento → { canal MIDI (0-indexed), nota por defecto, modo bajo monofonico }
const INSTRUMENTS = {
    kick:        { defaultNote: 48, channel: 0, mono: false },
    snare:       { defaultNote: 49, channel: 0 },
    closedHihat: { defaultNote: 50, channel: 0 },
    openHihat:   { defaultNote: 51, channel: 0 },
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
            visualizer.triggerNote(48, velocity);
            return;
        }
        if (channel === INSTRUMENTS.snare.channel && note === INSTRUMENTS.snare.defaultNote) {
            drumSynth.snare(velocity);
            visualizer.triggerNote(49, velocity);
            return;
        }
        if (channel === INSTRUMENTS.closedHihat.channel && note === INSTRUMENTS.closedHihat.defaultNote) {
            drumSynth.closedHihat(velocity);
            visualizer.triggerNote(50, velocity);
            return;
        }
        if (channel === INSTRUMENTS.openHihat.channel && note === INSTRUMENTS.openHihat.defaultNote) {
            drumSynth.openHihat(velocity);
            visualizer.triggerNote(51, velocity);
        }
    });

    midiManager.on('cc', (data) => {
        ccMapper.handleCC(data.cc, data.value);
    });
}

function addMappable(folder, params, key, min, max, label, handler) {
    const controller = folder.add(params, key, min, max).name(label).onChange(handler);

    ccMapper.register(key, v => {
        const mapped = min + v * (max - min);
        params[key] = mapped;
        controller.updateDisplay();
        handler(mapped);
    });

    const learnParams = { learn: () => {} };
    const learnBtn = folder.add(learnParams, 'learn').name(learnLabel(key));
    learnParams.learn = () => startLearn(key, learnBtn);

    return { controller, learnBtn };
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

    const params = {
        noteToTrigger: 48,
        velocity: 1.0,
        trigger: () => visualizer.triggerNote(params.noteToTrigger, params.velocity),
    };
    const folderNotes = gui.addFolder('Simulate Notes');
    folderNotes.add(params, 'noteToTrigger', 0, 127, 1).name('Note');
    folderNotes.add(params, 'velocity', 0.1, 1.0).name('Velocity');
    folderNotes.add(params, 'trigger').name('Trigger');

    const visualParams = {
        hueOffset:     0.0,
        baseBright:    0.0,
        opacity:       0.9,
        bloomStrength: 1.5,
    };

    const folderVisual = gui.addFolder('Visual');
    folderVisual.open();
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

    const kick808Params = { decay: 0.8, mono: false };
    const folder808 = gui.addFolder('808 Kick');
    folder808.add(kick808Params, 'decay', 0.2, 2.5).name('Decay (s)').onChange(v => { drumSynth.kickDecay = v; });
    folder808.add(kick808Params, 'mono').name('Mono Bass').onChange(v => { INSTRUMENTS.kick.mono = v; });

    const midiChParams = {
        kickCh: 1,    kickNote: 48,
        snareCh: 1,   snareNote: 49,
        closedCh: 1,  closedNote: 50,
        openCh: 1,    openNote: 51,
    };
    const folderMidi = gui.addFolder('MIDI Routing');
    folderMidi.add(midiChParams, 'kickCh',    1, 16, 1).name('Kick Ch').onChange(v   => { INSTRUMENTS.kick.channel        = v - 1; });
    folderMidi.add(midiChParams, 'kickNote',  0, 127, 1).name('Kick Note').onChange(v => { INSTRUMENTS.kick.defaultNote    = v; });
    folderMidi.add(midiChParams, 'snareCh',   1, 16, 1).name('Snare Ch').onChange(v  => { INSTRUMENTS.snare.channel       = v - 1; });
    folderMidi.add(midiChParams, 'snareNote', 0, 127, 1).name('Snare Note').onChange(v => { INSTRUMENTS.snare.defaultNote  = v; });
    folderMidi.add(midiChParams, 'closedCh',  1, 16, 1).name('Closed HH Ch').onChange(v => { INSTRUMENTS.closedHihat.channel   = v - 1; });
    folderMidi.add(midiChParams, 'closedNote',0, 127, 1).name('Closed HH Note').onChange(v => { INSTRUMENTS.closedHihat.defaultNote = v; });
    folderMidi.add(midiChParams, 'openCh',    1, 16, 1).name('Open HH Ch').onChange(v => { INSTRUMENTS.openHihat.channel   = v - 1; });
    folderMidi.add(midiChParams, 'openNote',  0, 127, 1).name('Open HH Note').onChange(v => { INSTRUMENTS.openHihat.defaultNote   = v; });
}

// Keyboard → MIDI note mapping (2x2 grid, notes 48-51 = C3 to D#3)
const KEY_TO_NOTE = {
    'q': 48, 'w': 49, 'e': 50, 'r': 51,
};

function setupKeyboard() {
    const heldKeys = new Set();

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (key in KEY_TO_NOTE && !heldKeys.has(key)) {
            heldKeys.add(key);
            const note = KEY_TO_NOTE[key];
            if (note === 48) {
                drumSynth.kick(1.0, null);
                visualizer.triggerNote(48, 1.0);
            } else if (note === 49) {
                drumSynth.snare(1.0);
                visualizer.triggerNote(49, 1.0);
            } else if (note === 50) {
                drumSynth.closedHihat(1.0);
                visualizer.triggerNote(50, 1.0);
            } else if (note === 51) {
                drumSynth.openHihat(1.0);
                visualizer.triggerNote(51, 1.0);
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
