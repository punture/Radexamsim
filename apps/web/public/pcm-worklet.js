// AudioWorklet: downsample microphone audio to 16 kHz mono PCM16 little-endian and post
// ~100 ms chunks to the main thread, which forwards them to the server ASR adapter.
class Pcm16Downsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = (options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / this.target;
    this.buffer = [];
    this.pos = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
      }
    }
    if (this.buffer.length >= this.target / 10) {
      const out = new Int16Array(this.buffer);
      this.buffer = [];
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm16-downsampler", Pcm16Downsampler);
