/**
 * Supertonic-3 — lightning-fast, on-device, multilingual TTS, in the browser.
 * A third voice backend for the co-pilot (alongside the browser voice and Kokoro).
 *
 * It is a multi-stage flow-matching pipeline run with onnxruntime-web:
 *   text -> duration_predictor -> text_encoder -> vector_estimator (N denoise
 *   steps) -> vocoder -> waveform. The pure text/mask/latent helpers below are
 *   lifted verbatim from Supertone's own static Space (Apache/OpenRAIL, see
 *   https://huggingface.co/spaces/Supertone/supertonic-3) so the maths is theirs,
 *   tested; we only add the thin orchestration and a clean generate() surface.
 *
 * ponytail: onnxruntime-web and the model weights load from a CDN/HF ONLY when a
 * caller picks this backend — no npm dependency, no bundle cost otherwise.
 * Upgrade path: `npm i onnxruntime-web` and host the .onnx weights yourself to go
 * fully offline; then swap the two CDN/HF URLs below for local paths.
 */

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/ort.webgpu.min.mjs';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
// Weights live in the model repo (CORS-enabled resolve URLs), not the Space.
const HF_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';

const AVAILABLE_LANGS = ['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'];

let ort = null; // set on first init

// ===== pure helpers, verbatim from Supertone's Space =====================
function preprocessText(text, lang = null) {
  text = text.normalize('NFKD');
  text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
  const replacements = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ' };
  for (const [k, v] of Object.entries(replacements)) text = text.replaceAll(k, v);
  text = text.replace(/[♥☆♡©\\]/g, '');
  const exprReplacements = { '@': ' at ', 'e.g.,': 'for example,', 'i.e.,': 'that is,' };
  for (const [k, v] of Object.entries(exprReplacements)) text = text.replaceAll(k, v);
  text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!').replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'");
  while (text.includes('""')) text = text.replace(/""/g, '"');
  while (text.includes("''")) text = text.replace(/''/g, "'");
  while (text.includes('``')) text = text.replace(/``/g, '`');
  text = text.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.';
  if (lang !== null) {
    if (!AVAILABLE_LANGS.includes(lang)) throw new Error(`Invalid language: ${lang}`);
    text = `<${lang}>` + text + `</${lang}>`;
  } else {
    text = `<na>` + text + `</na>`;
  }
  return text;
}

function textToUnicodeValues(text) { return Array.from(text).map((c) => c.charCodeAt(0)); }

function lengthToMask(lengths, maxLen = null) {
  maxLen = maxLen || Math.max(...lengths);
  const mask = [];
  for (let i = 0; i < lengths.length; i++) {
    const row = [];
    for (let j = 0; j < maxLen; j++) row.push(j < lengths[i] ? 1.0 : 0.0);
    mask.push([row]);
  }
  return mask;
}
const getTextMask = (textIdsLengths) => lengthToMask(textIdsLengths);

function getLatentMask(wavLengths, cfgs) {
  const latentSize = cfgs.ae.base_chunk_size * cfgs.ttl.chunk_compress_factor;
  const latentLengths = wavLengths.map((len) => Math.floor((len + latentSize - 1) / latentSize));
  return lengthToMask(latentLengths);
}

function sampleNoisyLatent(duration, cfgs) {
  const sampleRate = cfgs.ae.sample_rate;
  const chunkSize = cfgs.ae.base_chunk_size * cfgs.ttl.chunk_compress_factor;
  const ldim = cfgs.ttl.latent_dim;
  const wavLenMax = Math.max(...duration.map((d) => d[0][0])) * sampleRate;
  const wavLengths = duration.map((d) => Math.floor(d[0][0] * sampleRate));
  const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
  const latentDim = ldim * cfgs.ttl.chunk_compress_factor;
  const noisyLatent = [];
  for (let b = 0; b < duration.length; b++) {
    const batch = [];
    for (let d = 0; d < latentDim; d++) {
      const row = [];
      for (let t = 0; t < latentLen; t++) {
        const u1 = Math.random();
        const u2 = Math.random();
        row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)); // Box-Muller
      }
      batch.push(row);
    }
    noisyLatent.push(batch);
  }
  const latentMask = getLatentMask(wavLengths, cfgs);
  for (let b = 0; b < noisyLatent.length; b++)
    for (let d = 0; d < noisyLatent[b].length; d++)
      for (let t = 0; t < noisyLatent[b][d].length; t++)
        noisyLatent[b][d][t] *= latentMask[b][0][t];
  return { noisyLatent, latentMask };
}

class UnicodeProcessor {
  constructor(indexer) { this.indexer = indexer; }
  call(textList, lang = null) {
    const processedTexts = textList.map((t) => preprocessText(t, lang));
    const textIdsLengths = processedTexts.map((t) => t.length);
    const maxLen = Math.max(...textIdsLengths);
    const textIds = [];
    for (let i = 0; i < processedTexts.length; i++) {
      const row = new Array(maxLen).fill(0);
      const unicodeVals = textToUnicodeValues(processedTexts[i]);
      for (let j = 0; j < unicodeVals.length; j++) {
        const v = this.indexer[unicodeVals[j]];
        row[j] = (v === undefined || v === null || v === -1) ? 0 : v;
      }
      textIds.push(row);
    }
    return { textIds, textMask: getTextMask(textIdsLengths) };
  }
}

const arrayToTensor = (array, dims) => new ort.Tensor('float32', Float32Array.from(array.flat(Infinity)), dims);
const intArrayToTensor = (array, dims) => new ort.Tensor('int64', BigInt64Array.from(array.flat(Infinity).map((x) => BigInt(x))), dims);

// ===== public factory =====================================================
/**
 * @returns {Promise<{ generate(text:string):Promise<{audio:Float32Array, sampleRate:number}>, sampleRate:number }>}
 */
export async function createSupertonicTTS(opts = {}) {
  const voice = opts.voice || 'M2';                 // F1..F5, M1..M5
  const lang = opts.lang || null;                   // null -> <na> (model is language-agnostic)
  const steps = Math.max(1, opts.steps || 4);       // flow-matching denoise steps; more = nicer, slower
  const durationFactor = opts.durationFactor || 1.0; // <1 faster speech, >1 slower
  const onStatus = opts.onStatus || (() => {});
  const onnxBase = opts.onnxBase || `${HF_BASE}/onnx`;
  const voicesBase = opts.voicesBase || `${HF_BASE}/voice_styles`;

  if (!ort) {
    onStatus('loading runtime…');
    ort = await import(/* @vite-ignore */ ORT_CDN);
    if (ort.default && !ort.Tensor) ort = ort.default; // tolerate a default-wrapped build
    ort.env.wasm.wasmPaths = ORT_WASM;
    ort.env.wasm.numThreads = 1;
  }
  const useGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  const sessOpts = { executionProviders: useGpu ? ['webgpu', 'wasm'] : ['wasm'] };

  onStatus('downloading model…');
  const [cfgs, indexer, voiceStyle, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
    fetch(`${onnxBase}/tts.json`).then((r) => r.json()),
    fetch(`${onnxBase}/unicode_indexer.json`).then((r) => r.json()),
    fetch(`${voicesBase}/${voice}.json`).then((r) => r.json()),
    ort.InferenceSession.create(`${onnxBase}/duration_predictor.onnx`, sessOpts),
    ort.InferenceSession.create(`${onnxBase}/text_encoder.onnx`, sessOpts),
    ort.InferenceSession.create(`${onnxBase}/vector_estimator.onnx`, sessOpts),
    ort.InferenceSession.create(`${onnxBase}/vocoder.onnx`, sessOpts),
  ]);

  const textProcessor = new UnicodeProcessor(indexer);
  const styleTtlTensor = new ort.Tensor(voiceStyle.style_ttl.type || 'float32', Float32Array.from(voiceStyle.style_ttl.data.flat(Infinity)), voiceStyle.style_ttl.dims);
  const styleDpTensor = new ort.Tensor(voiceStyle.style_dp.type || 'float32', Float32Array.from(voiceStyle.style_dp.data.flat(Infinity)), voiceStyle.style_dp.dims);
  const sampleRate = cfgs.ae.sample_rate;
  onStatus('ready');

  async function generate(text) {
    const bsz = 1;
    const { textIds, textMask } = textProcessor.call([text], lang);
    const textIdsShape = [bsz, textIds[0].length];
    const textMaskShape = [bsz, 1, textMask[0][0].length];
    const textMaskTensor = arrayToTensor(textMask, textMaskShape);

    // 1) duration
    const dpResult = await dpOrt.run({ text_ids: intArrayToTensor(textIds, textIdsShape), style_dp: styleDpTensor, text_mask: textMaskTensor });
    const durOnnx = Array.from(dpResult.duration.data).map((d) => d * durationFactor);
    const durReshaped = durOnnx.map((d) => [[d]]);

    // 2) text encode
    const textEncResult = await textEncOrt.run({ text_ids: intArrayToTensor(textIds, textIdsShape), style_ttl: styleTtlTensor, text_mask: textMaskTensor });
    const textEmbTensor = textEncResult.text_emb;

    // 3) flow-matching denoise
    const { noisyLatent, latentMask } = sampleNoisyLatent(durReshaped, cfgs);
    const latentShape = [bsz, noisyLatent[0].length, noisyLatent[0][0].length];
    const latentMaskTensor = arrayToTensor(latentMask, [bsz, 1, latentMask[0][0].length]);
    const totalStepTensor = arrayToTensor(new Array(bsz).fill(steps), [bsz]);
    for (let step = 0; step < steps; step++) {
      const vectorEstResult = await vectorEstOrt.run({
        noisy_latent: arrayToTensor(noisyLatent, latentShape),
        text_emb: textEmbTensor,
        style_ttl: styleTtlTensor,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: arrayToTensor(new Array(bsz).fill(step), [bsz]),
      });
      const denoised = vectorEstResult.denoised_latent.data;
      let idx = 0;
      for (let b = 0; b < noisyLatent.length; b++)
        for (let d = 0; d < noisyLatent[b].length; d++)
          for (let t = 0; t < noisyLatent[b][d].length; t++)
            noisyLatent[b][d][t] = denoised[idx++];
    }

    // 4) vocoder
    const vocoderResult = await vocoderOrt.run({ latent: arrayToTensor(noisyLatent, latentShape) });
    const wavLen = Math.floor(sampleRate * durOnnx[0]);
    const audio = vocoderResult.wav_tts.data.slice(0, wavLen); // copy, not a view
    return { audio, sampleRate };
  }

  return { generate, sampleRate };
}
