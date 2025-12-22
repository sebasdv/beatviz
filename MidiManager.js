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
            console.warn('Web MIDI API not supported in this browser.');
            return false;
        }

        try {
            this.access = await navigator.requestMIDIAccess();

            // Listen to all inputs
            for (const input of this.access.inputs.values()) {
                input.onmidimessage = (msg) => this.onMessage(msg);
            }

            this.access.onstatechange = (e) => {
                if (e.port.type === 'input' && e.port.state === 'connected') {
                    e.port.onmidimessage = (msg) => this.onMessage(msg);
                }
            };

            console.log('MIDI Access Granted');
            return true;
        } catch (err) {
            console.error('MIDI Access Failed', err);
            return false;
        }
    }

    onMessage(msg) {
        const [status, data1, data2] = msg.data;
        const command = status & 0xF0;
        const channel = status & 0x0F;

        // Note On (144) - Channel 5
        if (command === 144 && channel === this.noteChannel && data2 > 0) {
            this.emit('noteOn', { note: data1, velocity: data2 / 127 });
        }
        // Note Off (128) - Channel 5
        else if ((command === 128 || (command === 144 && data2 === 0)) && channel === this.noteChannel) {
            this.emit('noteOff', { note: data1 });
        }
        // Control Change (176) - Channel 2
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
