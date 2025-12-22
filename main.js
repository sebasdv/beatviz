import { MidiManager } from './MidiManager.js';
import { Visualizer } from './Visualizer.js';
import GUI from 'https://unpkg.com/lil-gui@0.19.1/dist/lil-gui.esm.min.js';

const startButton = document.getElementById('start-audio');
const overlay = document.getElementById('overlay');

let midiManager;
let visualizer;

async function init() {
    console.log("Main: Initializing...");
    // Initialize Visualizer
    visualizer = new Visualizer('canvas-container');

    // Initialize MIDI
    midiManager = new MidiManager();
    const midiAccess = await midiManager.init();

    if (midiAccess) {
        startButton.textContent = "MIDI Connected";
        startButton.style.background = "rgba(0, 255, 0, 0.2)";
    } else {
        startButton.textContent = "MIDI Failed (Check Console)";
        startButton.style.background = "rgba(255, 0, 0, 0.2)";
    }

    // Setup Debug GUI
    const guiControllers = setupGUI();

    // Bind Events
    midiManager.on('noteOn', (data) => {
        console.log('Note On:', data);
        visualizer.triggerNote(data.note, data.velocity);
    });

    midiManager.on('cc', (data) => {
        console.log('CC:', data);
        visualizer.updateCC(data.cc, data.value);

        // Update GUI if it exists
        if (data.cc === 24) guiControllers.cc24.setValue(data.value);
        if (data.cc === 25) guiControllers.cc25.setValue(data.value);
        if (data.cc === 26) guiControllers.cc26.setValue(data.value);
    });
}

function setupGUI() {
    const gui = new GUI({ title: 'Debug / Simulation' });

    const params = {
        noteToTrigger: 48,
        velocity: 1.0,
        trigger: () => {
            visualizer.triggerNote(params.noteToTrigger, params.velocity);
        },
        cc24_Spread: 0.5,
        cc25_Color: 0.0,
        cc26_Decay: 0.5
    };

    const folderNotes = gui.addFolder('Simulate Notes');
    folderNotes.add(params, 'noteToTrigger', 48, 63, 1).name('Note (48-63)');
    folderNotes.add(params, 'velocity', 0.1, 1.0).name('Velocity');
    folderNotes.add(params, 'trigger').name('Trigger Note');

    const folderCC = gui.addFolder('Simulate CC');
    const cc24 = folderCC.add(params, 'cc24_Spread', 0.0, 1.0).name('CC 24 (Spread)').onChange(v => visualizer.updateCC(24, v));
    const cc25 = folderCC.add(params, 'cc25_Color', 0.0, 1.0).name('CC 25 (Color)').onChange(v => visualizer.updateCC(25, v));
    const cc26 = folderCC.add(params, 'cc26_Decay', 0.0, 1.0).name('CC 26 (Decay)').onChange(v => visualizer.updateCC(26, v));

    return { cc24, cc25, cc26 };
}

startButton.addEventListener('click', () => {
    // Audio context would go here if we had audio
    overlay.style.opacity = 0;
    overlay.style.pointerEvents = 'none';
    init();
    startButton.disabled = true;
});
