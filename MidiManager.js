export class MidiManager {
    constructor() {
        this.access = null;
        this.listeners = {
            noteOn: [],
            noteOff: [],
            cc: [],
            clock: [],
        };
        this.ccChannel = 0;   // Channel 1 (0-indexed)

        // MIDI Clock state (24 pulses per quarter note)
        this._clockTimes = [];
        this._bpm = null;
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

        // MIDI Clock (0xF8 = 248) — system realtime, no channel
        if (status === 0xF8) {
            this._onClockPulse(msg.timeStamp);
            return;
        }

        const command = status & 0xF0;
        const channel = status & 0x0F;

        if (command === 144 && data2 > 0) {
            this.emit('noteOn', { note: data1, velocity: data2 / 127, channel });
        }
        else if (command === 128 || (command === 144 && data2 === 0)) {
            this.emit('noteOff', { note: data1, channel });
        }
        else if (command === 176 && channel === this.ccChannel) {
            this.emit('cc', { cc: data1, value: data2 / 127 });
        }
    }

    _onClockPulse(timeStamp) {
        this._clockTimes.push(timeStamp);
        // Keep only the last 24 pulses (= 1 beat) for averaging
        if (this._clockTimes.length > 24) this._clockTimes.shift();
        if (this._clockTimes.length < 2) return;

        // Average interval between consecutive pulses, then scale to BPM
        let sum = 0;
        for (let i = 1; i < this._clockTimes.length; i++) {
            sum += this._clockTimes[i] - this._clockTimes[i - 1];
        }
        const avgPulseMs = sum / (this._clockTimes.length - 1);
        const bpm = 60000 / (avgPulseMs * 24);

        if (Math.abs(bpm - this._bpm) > 0.1 || this._bpm === null) {
            this._bpm = bpm;
            this.emit('clock', { bpm });
        }
    }

    get bpm() { return this._bpm; }

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
