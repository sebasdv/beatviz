import { MidiManager } from './MidiManager.js';
import { Visualizer } from './Visualizer.js';
import { CCMapper } from './CCMapper.js';
import GUI from 'https://unpkg.com/lil-gui@0.19.1/dist/lil-gui.esm.min.js';

const startButton = document.getElementById('start-audio');
const overlay = document.getElementById('overlay');

let midiManager;
let visualizer;
let ccMapper;

async function init() {
    visualizer = new Visualizer('canvas-container');
    ccMapper = new CCMapper();

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

    midiManager.on('noteOn', (data) => {
        visualizer.triggerNote(data.note, data.velocity);
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
}

// Keyboard → MIDI note mapping (4x4 grid, notes 48-63 = C3 to D#4)
const KEY_TO_NOTE = {
    'q': 48, 'w': 49, 'e': 50, 'r': 51,
    'a': 52, 's': 53, 'd': 54, 'f': 55,
    'z': 56, 'x': 57, 'c': 58, 'v': 59,
    '1': 60, '2': 61, '3': 62, '4': 63,
};

function setupKeyboard() {
    const heldKeys = new Set();

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();
        if (key in KEY_TO_NOTE && !heldKeys.has(key)) {
            heldKeys.add(key);
            visualizer.triggerNote(KEY_TO_NOTE[key], 1.0);
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
