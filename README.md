# MIDI Particle Visualizer

A 3D music visualization tool that reacts to MIDI input or simulated notes.

## Features
- **3D Particle Grid**: Reacts to notes with dynamic physics.
- **Alternating Impulse**: Particles explode Up/Down on consecutive notes for variety.
- **Spring Physics**: Smooth oscillation and settling mechanics.
- **Microphone / MIDI Input**: Support for Web MIDI API (requires HTTPS or Localhost).
- **Control Change (CC) Support**:
    - CC 24: Color Hue
    - CC 25: Base Brightness
    - CC 26: Opacity

## Usage
1. Open the application.
2. Click "Start Audio / MIDI".
3. Connect a MIDI controller or use the on-screen "Debug / Simulation" panel.

## Development
To run locally:
```bash
npx http-server -p 8080
```
Open `http://localhost:8080` in your browser.
