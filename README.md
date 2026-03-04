# BeatViz

A 3D MIDI visualizer built with Three.js WebGPU. A 4x4 grid of cubes reacts to MIDI notes with spring physics, per-pad bloom, and real-time CC control.

## Features

- **Cube Grid**: 4x4 instanced mesh grid driven by spring physics with alternating up/down impulse direction.
- **Bloom Post-Processing**: Per-pad HDR bloom via Three.js TSL, with adjustable strength.
- **MIDI Input**: Receives Note On/Off and Control Change messages via the Web MIDI API.
- **Keyboard Input**: Play notes from the computer keyboard (Q/W/E/R, A/S/D/F, Z/X/C/V, 1/2/3/4 mapped to MIDI notes 48-63).
- **CC Learn**: Any GUI slider can be bound to an arbitrary MIDI CC number. Click "Learn CC", move a knob, and the assignment is saved to localStorage.
- **GUI Controls** (via lil-gui):
    - **Visual**: Hue Offset, Base Brightness, Opacity, Bloom Strength
    - **Physics**: Spring K, Damping, Color Decay, Impulse Force
    - **Simulate Notes**: Trigger notes manually with configurable note number and velocity.

## Usage

1. Open the application in a browser that supports WebGPU.
2. Click "Start Audio / MIDI".
3. Connect a MIDI controller, use the keyboard, or use the GUI to trigger and shape visuals.

## Development

Run a local server:

```bash
npx http-server -p 8080
```

Open `http://localhost:8080` in your browser.
