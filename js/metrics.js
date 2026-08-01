// metrics.js — latence par étape (exigence : mesurée et loguée).

export class Metrics {
  constructor() {
    this.turn = 0;
    this.marks = {};   // nom -> ms (performance.now) au cours du tour courant
    this.turns = [];   // historique des tours
  }
  reset() {
    this.marks = {};
  }
  mark(name) {
    this.marks[name] = performance.now();
  }
  // delta entre deux marques, en ms
  lap(a, b) {
    const ta = this.marks[a], tb = this.marks[b];
    if (ta == null || tb == null) return null;
    return Math.max(0, Math.round(tb - ta));
  }
  endTurn() {
    this.turn += 1;
    const row = {
      turn: this.turn,
      vad_trigger: this.lap('turnStart', 'vadTrigger'),
      asr_partial: this.lap('turnStart', 'asrPartial'),
      asr_final: this.lap('turnStart', 'asrFinal'),
      llm_first_token: this.lap('asrFinal', 'llmFirstToken'),
      tts_first_chunk: this.lap('asrFinal', 'ttsFirstChunk'),
      tts_end: this.lap('asrFinal', 'ttsEnd'),
      barge_in: this.lap('ttsStart', 'bargeIn'),
    };
    this.turns.push(row);
    if (this.turns.length > 50) this.turns.shift();
    this.marks = {};
    return row;
  }
  table() {
    const h = ['turn', 'vad_trigger', 'asr_partial', 'asr_final', 'llm_first_token', 'tts_first_chunk', 'tts_end', 'barge_in'];
    return this.turns.map((t) => h.map((k) => `${k}=${t[k] ?? '-'}ms`).join('  ')).join('\n') || '—';
  }
}
