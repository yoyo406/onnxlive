// logger.js — logs structurés (console + panneau debug), niveaux.

export const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

class Logger {
  constructor() {
    this.level = LogLevel.INFO;
    this.listeners = new Set(); // (entry) => void
    this.entries = [];
    this.maxEntries = 500;
  }
  onLog(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(level, tag, msg, data) {
    if (level < this.level) return;
    const entry = { level, tag, msg, data, t: Date.now(), dt: performance.now() };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    const line = `[${new Date(entry.t).toISOString().slice(11, 23)}] [${tag}] ${msg}`;
    const fn = level >= LogLevel.ERROR ? console.error : level === LogLevel.WARN ? console.warn : console.debug;
    fn(line, data ?? '');
    for (const l of this.listeners) l(entry);
  }
  debug(tag, msg, data) { this._emit(LogLevel.DEBUG, tag, msg, data); }
  info(tag, msg, data)  { this._emit(LogLevel.INFO, tag, msg, data); }
  warn(tag, msg, data)  { this._emit(LogLevel.WARN, tag, msg, data); }
  error(tag, msg, data) { this._emit(LogLevel.ERROR, tag, msg, data); }
}

export const log = new Logger();
