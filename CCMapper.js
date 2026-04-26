const STORAGE_KEY = 'beatviz_cc_map';

export class CCMapper {
    constructor() {
        this.bindings = {};
        this.assignments = this._load();
        this.learningParam = null;
        this._learnCallback = null;
    }

    register(name, handler) {
        this.bindings[name] = handler;
    }

    registerMacro(name, handlers) {
        this.bindings[name] = (value) => {
            for (const h of handlers) h(value);
        };
    }

    learn(name, onAssigned) {
        this.learningParam = name;
        this._learnCallback = onAssigned;
    }

    cancelLearn() {
        this.learningParam = null;
        this._learnCallback = null;
    }

    handleCC(cc, value) {
        if (this.learningParam !== null) {
            const param = this.learningParam;
            this.assignments[param] = cc;
            this._save();
            const cb = this._learnCallback;
            this.learningParam = null;
            this._learnCallback = null;
            if (cb) cb(cc);
            if (this.bindings[param]) this.bindings[param](value);
            return;
        }

        for (const [name, assignedCC] of Object.entries(this.assignments)) {
            if (assignedCC === cc && this.bindings[name]) {
                this.bindings[name](value);
            }
        }
    }

    getAssignment(name) {
        return this.assignments[name];
    }

    clearAssignment(name) {
        delete this.assignments[name];
        this._save();
    }

    _save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.assignments));
    }

    _load() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch {
            return {};
        }
    }
}
