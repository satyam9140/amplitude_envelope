export const ALGORITHM_OPTIONS = [
  {
    value: 'movingMax',
    label: 'Frame-Based Peak Detection (Moving Max)',
    detail: 'Finds the maximum absolute amplitude inside each frame. Good for catching sharp peaks and sudden attacks.',
  },
  {
    value: 'hilbert',
    label: 'Hilbert Transform (Analytic Signal Method)',
    detail: 'Builds an analytic-signal style envelope from the waveform and then summarizes it per frame.',
  },
  {
    value: 'rectifiedLowpass',
    label: 'Full-Wave Rectification and Low-Pass Filtering',
    detail: 'Converts the waveform to absolute values, applies low-pass filtering, then reads the envelope frame-by-frame.',
  },
  {
    value: 'rmsEnergy',
    label: 'Root Mean Square (RMS) Energy Tracking',
    detail: 'Measures average frame power using RMS. This is the safest default for loudness and speech-energy tracking.',
  },
];

export const SMOOTHER_OPTIONS = [
  { value: 'lowpass', label: 'Low-Pass Filtering', detail: 'Keeps slow envelope movement and suppresses high-frequency jitter. Best clean default.' },
  { value: 'movingAverage', label: 'Moving Average (Integration)', detail: 'Averages nearby frames to make the envelope easier to read, but it can flatten sharp peaks.' },
  { value: 'hilbertAnalytic', label: 'Hilbert Transform (Analytic Signal)', detail: 'Uses an analytic-envelope style smoother to preserve signal shape while reducing roughness.' },
  { value: 'hhtEmd', label: 'Hilbert-Huang Transform (HHT) / EMD', detail: 'Approximates adaptive smoothing for non-stationary signals where loudness changes over time.' },
  { value: 'gaussian', label: 'Gaussian Windowing', detail: 'Applies weighted local smoothing, giving more importance to nearby frames than far frames.' },
];

export function getAlgorithmName(value) {
  return ALGORITHM_OPTIONS.find((item) => item.value === value)?.label || ALGORITHM_OPTIONS[0].label;
}

export function getSmootherName(value) {
  return SMOOTHER_OPTIONS.find((item) => item.value === value)?.label || SMOOTHER_OPTIONS[0].label;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function formatNumber(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return '-';
  const n = Number(value);
  if (Math.abs(n) >= 10000 || (Math.abs(n) < 0.0001 && n !== 0)) return n.toExponential(2);
  return n.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function downmixAudioBuffer(audioBuffer, normalize = true) {
  const samples = new Float32Array(audioBuffer.length);
  let peak = 0;

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < audioBuffer.length; i += 1) {
      samples[i] += data[i] / audioBuffer.numberOfChannels;
    }
  }

  for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  if (normalize && peak > 1e-12) {
    for (let i = 0; i < samples.length; i += 1) samples[i] /= peak;
    peak = 1;
  }

  return { samples, peak };
}

function hammingWindow(size) {
  if (size <= 1) return Float32Array.from([1]);
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

function absoluteSignal(values) {
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) output[i] = Math.abs(values[i] || 0);
  return output;
}

function lowPassIir(values, dt = 0.01, cutoffHz = 8) {
  const cutoff = Math.max(0.001, Number(cutoffHz) || 8);
  const sampleStep = Math.max(1e-9, Number(dt) || 0.01);
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = sampleStep / (rc + sampleStep);
  const output = new Float32Array(values.length);
  let state = values[0] || 0;
  for (let i = 0; i < values.length; i += 1) {
    state += alpha * ((values[i] || 0) - state);
    output[i] = Math.max(0, state);
  }
  return output;
}

function analyticEnvelopeFIR(values, halfTaps = 63) {
  const n = values.length;
  const output = new Float32Array(n);
  const taps = Math.max(9, Math.min(121, Number(halfTaps) || 63));

  // FIR Hilbert transformer: h[k] = 2 / (pi*k) for odd k, 0 for even k.
  // This keeps the app dependency-free and fast enough for browser use.
  for (let i = 0; i < n; i += 1) {
    let quadrature = 0;
    for (let k = -taps; k <= taps; k += 1) {
      if (k === 0 || k % 2 === 0) continue;
      const j = i - k;
      if (j < 0 || j >= n) continue;
      quadrature += (2 / (Math.PI * k)) * (values[j] || 0);
    }
    const real = values[i] || 0;
    output[i] = Math.sqrt(real * real + quadrature * quadrature);
  }
  return output;
}

export function movingAverageSmooth(values, windowLength = 35) {
  const halfWindow = Math.max(1, Math.floor(Number(windowLength) / 2));
  const output = new Float32Array(values.length);
  let sum = 0;
  let left = 0;

  for (let right = 0; right < values.length; right += 1) {
    sum += values[right] || 0;
    while (right - left > halfWindow * 2) {
      sum -= values[left] || 0;
      left += 1;
    }
    output[right] = sum / Math.max(1, right - left + 1);
  }

  return output;
}

function gaussianSmooth(values, strength = 35) {
  const radius = Math.max(1, Math.min(80, Math.round(Number(strength) / 2)));
  const sigma = Math.max(1, radius / 2.35);
  const kernel = [];
  let weightSum = 0;

  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(weight);
    weightSum += weight;
  }

  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let used = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      const weight = kernel[k + radius];
      sum += (values[j] || 0) * weight;
      used += weight;
    }
    output[i] = sum / Math.max(1e-12, used || weightSum);
  }
  return output;
}

function findExtrema(values, mode = 'max') {
  const points = [{ index: 0, value: values[0] || 0 }];
  for (let i = 1; i < values.length - 1; i += 1) {
    const prev = values[i - 1] || 0;
    const curr = values[i] || 0;
    const next = values[i + 1] || 0;
    if (mode === 'max' && curr >= prev && curr >= next) points.push({ index: i, value: curr });
    if (mode === 'min' && curr <= prev && curr <= next) points.push({ index: i, value: curr });
  }
  if (values.length > 1) points.push({ index: values.length - 1, value: values[values.length - 1] || 0 });
  return points;
}

function interpolatePoints(points, length) {
  const output = new Float32Array(length);
  if (!points.length) return output;
  if (points.length === 1) {
    output.fill(points[0].value || 0);
    return output;
  }

  let cursor = 0;
  for (let p = 0; p < points.length - 1; p += 1) {
    const a = points[p];
    const b = points[p + 1];
    while (cursor <= b.index && cursor < length) {
      const t = (cursor - a.index) / Math.max(1, b.index - a.index);
      output[cursor] = (a.value || 0) + t * ((b.value || 0) - (a.value || 0));
      cursor += 1;
    }
  }
  while (cursor < length) {
    output[cursor] = points[points.length - 1].value || 0;
    cursor += 1;
  }
  return output;
}

function hhtEmdSmooth(values, strength = 35) {
  if (!values.length) return new Float32Array();
  const upper = interpolatePoints(findExtrema(values, 'max'), values.length);
  const lower = interpolatePoints(findExtrema(values, 'min'), values.length);
  const meanEnvelope = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    meanEnvelope[i] = Math.max(0, (upper[i] + lower[i]) / 2);
  }

  const broadTrend = gaussianSmooth(meanEnvelope, Math.max(8, Number(strength) || 35));
  const integratedTrend = movingAverageSmooth(values, Math.max(5, Math.round((Number(strength) || 35) * 1.25)));
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    output[i] = Math.max(0, 0.65 * broadTrend[i] + 0.35 * integratedTrend[i]);
  }
  return output;
}

function smoothnessToCutoff(smoothness = 35, dt = 0.01) {
  const nyquist = 0.5 / Math.max(1e-9, dt);
  const normalized = Math.max(1, Math.min(100, Number(smoothness) || 35));
  const cutoff = nyquist * (0.5 - normalized * 0.0046);
  return Math.max(0.15, Math.min(nyquist * 0.48, cutoff));
}

export function extractEnvelope(samples, sampleRate, frameMs = 25, hopMs = 10, algorithm = 'rmsEnergy') {
  const frameSize = Math.max(8, Math.round((sampleRate * frameMs) / 1000));
  const hopSize = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const window = hammingWindow(frameSize);
  let windowPower = 0;
  let windowSum = 0;
  for (let i = 0; i < window.length; i += 1) {
    windowPower += window[i] * window[i];
    windowSum += window[i];
  }

  const rectifiedLowPassed = algorithm === 'rectifiedLowpass'
    ? lowPassIir(absoluteSignal(samples), 1 / sampleRate, Math.max(5, 1000 / Math.max(25, frameMs * 4)))
    : null;
  const analyticEnvelope = algorithm === 'hilbert' ? analyticEnvelopeFIR(samples, 45) : null;

  const times = [];
  const envelope = [];

  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + frameSize);
    let energy = 0;
    let peak = 0;
    let weightedSum = 0;
    let usedPower = 0;
    let usedSum = 0;

    for (let i = start; i < end; i += 1) {
      const win = window[i - start];
      const sample = samples[i] || 0;
      const weighted = sample * win;
      energy += weighted * weighted;
      peak = Math.max(peak, Math.abs(sample));
      usedPower += win * win;
      usedSum += win;

      if (algorithm === 'rectifiedLowpass') {
        weightedSum += (rectifiedLowPassed[i] || 0) * win;
      } else if (algorithm === 'hilbert') {
        weightedSum += (analyticEnvelope[i] || 0) * win;
      }
    }

    let value;
    if (algorithm === 'movingMax') {
      value = peak;
    } else if (algorithm === 'rectifiedLowpass' || algorithm === 'hilbert') {
      value = weightedSum / Math.max(1e-12, usedSum || windowSum);
    } else {
      value = Math.sqrt(energy / Math.max(1e-12, usedPower || windowPower));
    }

    times.push((start + (end - start) / 2) / sampleRate);
    envelope.push(Math.max(0, value));
  }

  return {
    algorithm,
    algorithmName: getAlgorithmName(algorithm),
    times,
    envelope: Float32Array.from(envelope),
    frameSize,
    hopSize,
  };
}

export function shortTimeRmsEnvelope(samples, sampleRate, frameMs = 25, hopMs = 10) {
  return extractEnvelope(samples, sampleRate, frameMs, hopMs, 'rmsEnergy');
}

export function smoothEnvelope(values, smoother = 'lowpass', options = {}) {
  const smoothness = Math.max(1, Number(options.smoothness) || 35);
  const dt = Math.max(1e-9, Number(options.dt) || 0.01);

  if (smoother === 'movingAverage') return movingAverageSmooth(values, smoothness);
  if (smoother === 'hilbertAnalytic') return gaussianSmooth(analyticEnvelopeFIR(values, 31), Math.max(5, smoothness * 0.45));
  if (smoother === 'hhtEmd') return hhtEmdSmooth(values, smoothness);
  if (smoother === 'gaussian') return gaussianSmooth(values, smoothness);
  return lowPassIir(values, dt, smoothnessToCutoff(smoothness, dt));
}

export function decimateWaveform(samples, sampleRate, maxPoints = 4200) {
  const block = Math.max(1, Math.ceil(samples.length / maxPoints));
  const points = [];

  for (let start = 0; start < samples.length; start += block) {
    let min = Infinity;
    let max = -Infinity;
    const end = Math.min(samples.length, start + block);
    for (let i = start; i < end; i += 1) {
      min = Math.min(min, samples[i]);
      max = Math.max(max, samples[i]);
    }
    points.push({ t: start / sampleRate, min, max });
  }

  return points;
}

export function computeStats(samples, sampleRate, envelope, smoothedEnvelope, startFrame = 0, endFrame = envelope.length - 1) {
  let peak = 0;
  let sampleEnergy = 0;
  for (let i = 0; i < samples.length; i += 1) {
    peak = Math.max(peak, Math.abs(samples[i]));
    sampleEnergy += samples[i] * samples[i];
  }

  const start = Math.max(0, Math.min(envelope.length - 1, Number(startFrame) || 0));
  const end = Math.max(start, Math.min(envelope.length - 1, Number(endFrame) || envelope.length - 1));
  let envPeak = 0;
  let envSum = 0;
  let residualEnergy = 0;
  let quietFrames = 0;
  const count = Math.max(1, end - start + 1);

  for (let i = start; i <= end; i += 1) {
    envPeak = Math.max(envPeak, smoothedEnvelope[i] || 0);
    envSum += smoothedEnvelope[i] || 0;
    const residual = (envelope[i] || 0) - (smoothedEnvelope[i] || 0);
    residualEnergy += residual * residual;
  }

  for (let i = start; i <= end; i += 1) {
    if ((smoothedEnvelope[i] || 0) < envPeak * 0.08) quietFrames += 1;
  }

  const audioRms = Math.sqrt(sampleEnergy / Math.max(1, samples.length));
  const envMean = envSum / count;
  const residualRms = Math.sqrt(residualEnergy / count);

  return {
    duration: samples.length / sampleRate,
    sampleRate,
    peak,
    audioRms,
    envPeak,
    envMean,
    residualRms,
    crestFactor: audioRms > 1e-12 ? peak / audioRms : 0,
    quietPercent: count ? (quietFrames / count) * 100 : 0,
    dynamicRange: envPeak > 1e-12 ? 20 * Math.log10(envPeak / Math.max(1e-6, envMean)) : 0,
  };
}

export function createDemoBuffer() {
  const sampleRate = 44100;
  const duration = 7;
  const length = sampleRate * duration;
  const context = new OfflineAudioContext(1, length, sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const decay = 0.72 * Math.exp(-Math.max(0, t - 0.35) / 1.25);
    const gate = t > 3.2 && t < 5.9 ? 0.35 : 0;
    const pulse = Math.sin(2 * Math.PI * 2.4 * t) > 0.86 ? 0.35 : 0;
    const carrier = Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t);
    channel[i] = Math.max(-1, Math.min(1, (0.12 + decay + gate + pulse) * carrier * 0.45));
  }

  return buffer;
}
