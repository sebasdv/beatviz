const DPAD_KEYS   = { w: 'up', s: 'down', a: 'left', d: 'right' };
const BUTTON_KEYS = { y: 'A', u: 'B', i: 'X', o: 'Y' };

export class KeyboardGamepad {
    constructor() {
        this.listeners = { connected: [], disconnected: [], dpad: [], button: [] };
        this._active = false;
        this._heldKeys = new Set();

        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (!(key in DPAD_KEYS) && !(key in BUTTON_KEYS)) return;
            if (this._heldKeys.has(key)) return;
            this._heldKeys.add(key);

            if (!this._active) {
                this._active = true;
                this.emit('connected', {});
            }

            if (key in DPAD_KEYS) {
                this.emit('dpad', { direction: DPAD_KEYS[key] });
            } else {
                this.emit('button', { name: BUTTON_KEYS[key] });
            }
        });

        window.addEventListener('keyup', (e) => {
            this._heldKeys.delete(e.key.toLowerCase());
        });
    }

    on(event, callback) {
        if (this.listeners[event]) this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) this.listeners[event].forEach(cb => cb(data));
    }
}
