const BUTTON_MAP = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y' };
const DPAD_MAP   = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

export class GamepadManager {
    constructor() {
        this.listeners = { connected: [], disconnected: [], dpad: [], button: [] };
        this._index = null;
        this._prevButtons = [];
        this._warnedMapping = false;

        window.addEventListener('gamepadconnected', (e) => {
            if (this._index !== null) return; // only the first controller is used
            this._index = e.gamepad.index;
            this._prevButtons = e.gamepad.buttons.map(b => b.pressed);
            this.emit('connected', { index: this._index });
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            if (e.gamepad.index !== this._index) return;
            this._index = null;
            this._prevButtons = [];
            this._warnedMapping = false;
            this.emit('disconnected', {});
        });
    }

    // Call once per animation frame.
    poll() {
        if (this._index === null) return;
        const gp = navigator.getGamepads()[this._index];
        if (!gp) return;

        if (gp.mapping !== 'standard') {
            if (!this._warnedMapping) {
                console.warn(`GamepadManager: unsupported gamepad mapping "${gp.mapping}" — ignoring input.`);
                this._warnedMapping = true;
            }
            return;
        }

        this._pollButtonGroup(gp, BUTTON_MAP, 'button', (name) => ({ name }));
        this._pollButtonGroup(gp, DPAD_MAP, 'dpad', (direction) => ({ direction }));
    }

    _pollButtonGroup(gp, map, eventName, buildPayload) {
        for (const [indexStr, label] of Object.entries(map)) {
            const idx = Number(indexStr);
            const pressed = gp.buttons[idx]?.pressed ?? false;
            if (pressed && !this._prevButtons[idx]) {
                this.emit(eventName, buildPayload(label));
            }
            this._prevButtons[idx] = pressed;
        }
    }

    // Raw snapshot for the on-screen debug overlay — no edge detection.
    getDebugState() {
        if (this._index === null) return { connected: false };
        const gp = navigator.getGamepads()[this._index];
        if (!gp) return { connected: false };
        return {
            connected: true,
            index: this._index,
            mapping: gp.mapping,
            buttons: gp.buttons.map(b => b.pressed),
        };
    }

    on(event, callback) {
        if (this.listeners[event]) this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
    }
}
