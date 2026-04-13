const PREFIX  = 'beatviz_seq_slot_';
const VERSION = 1;

export class SeqStorage {
    static save(slot, pattern) {
        if (slot < 0 || slot > 2) return;
        try {
            localStorage.setItem(PREFIX + slot, JSON.stringify({ version: VERSION, ...pattern }));
        } catch (_) {}
    }

    static load(slot) {
        if (slot < 0 || slot > 2) return null;
        try {
            const raw = localStorage.getItem(PREFIX + slot);
            if (!raw) return null;
            return SeqStorage._validate(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    static loadCurrent() {
        try {
            const raw = localStorage.getItem('beatviz_seq_current');
            if (!raw) return null;
            return SeqStorage._validate(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    static slotUsed(slot) {
        return localStorage.getItem(PREFIX + slot) !== null;
    }

    static clear(slot) {
        localStorage.removeItem(PREFIX + slot);
    }

    static _validate(data) {
        if (!data || data.version !== VERSION) return null;
        data.bpm   = Math.max(40,  Math.min(240, data.bpm   ?? 120));
        data.swing = Math.max(0,   Math.min(75,  data.swing ?? 0));
        if (!Array.isArray(data.tracks) || data.tracks.length !== 4) return null;
        for (const track of data.tracks) {
            track.length = Math.max(1, Math.min(64, track.length ?? 16));
            if (!Array.isArray(track.steps)) return null;
            for (const step of track.steps) {
                step.active      = !!step.active;
                step.velocity    = Math.max(1,  Math.min(127, step.velocity    ?? 100));
                step.probability = Math.max(0,  Math.min(100, step.probability ?? 100));
                step.midiNote    = Math.max(0,  Math.min(127, step.midiNote    ?? 48));
            }
        }
        return data;
    }
}
