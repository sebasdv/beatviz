export class MidiManager {
    constructor() {
        this.access = null;
        this.listeners = {
            noteOn: [],
            noteOff: [],
            cc: []
        };
        this.noteChannel = 0; // Channel 1 (0-indexed)
        this.ccChannel = 0;   // Channel 1 (0-indexed)
    }

    async init() {
        if (!navigator.requestMIDIAccess) {
            return false;
        }

        try {
            this.access = await navigator.requestMIDIAccess();

            for (const input of this.access.inputs.values()) {
                input.onmidimessage = (msg) => this.onMessage(msg);
            }

            this.access.onstatechange = (e) => {
                if (e.port.type === 'input' && e.port.state === 'connected') {
                    e.port.onmidimessage = (msg) => this.onMessage(msg);
                }
            };

            return true;
        } catch {
            return false;
        }
    }

    onMessage(msg) {
        const [status, data1, data2] = msg.data;
        const command = status & 0xF0;
        const channel = status & 0x0F;

        if (command === 144 && channel === this.noteChannel && data2 > 0) {
            this.emit('noteOn', { note: data1, velocity: data2 / 127 });
        }
        else if ((command === 128 || (command === 144 && data2 === 0)) && channel === this.noteChannel) {
            this.emit('noteOff', { note: data1 });
        }
        else if (command === 176 && channel === this.ccChannel) {
            this.emit('cc', { cc: data1, value: data2 / 127 });
        }
    }

    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }
}
