import { useEffect, useMemo, useState } from 'react';
import CanvasPlot from './components/CanvasPlot.jsx';
import ExperimentFlow from './components/ExperimentFlow.jsx';
import {
  ALGORITHM_OPTIONS,
  SMOOTHER_OPTIONS,
  clamp,
  computeStats,
  createDemoBuffer,
  decimateWaveform,
  downmixAudioBuffer,
  extractEnvelope,
  formatNumber,
  getAlgorithmName,
  getSmootherName,
  smoothEnvelope,
} from './utils/envelope.js';

const DEFAULT_COLORS = {
  waveform: '#2563eb',
  rawEnvelope: '#f97316',
  finalEnvelope: '#e11d48',
  residual: '#16a34a',
  cursor: '#0f172a',
};

const COMPARE_COLORS = [
  '#2563eb', '#f97316', '#16a34a', '#e11d48',
  '#7c3aed', '#0891b2', '#ca8a04', '#db2777',
  '#14b8a6', '#f43f5e', '#64748b', '#84cc16',
  '#0ea5e9', '#a855f7', '#d97706', '#22c55e',
];

const DEFAULT_VISIBILITY = {
  waveformPlot: true,
  detailPlot: true,
  comparisonPlot: true,
  flowPlot: true,
  waveform: true,
  rawEnvelope: true,
  finalEnvelope: true,
  residual: true,
};

const INITIAL_PLAYER = {
  hasRun: false,
  isRunning: false,
  currentFrame: 0,
  startFrame: 0,
  endFrame: 0,
  activeStep: 0,
};

const INSTRUCTION_SECTIONS = [
  {
    title: 'Purpose of this experiment',
    points: [
      'This lab shows how an audio waveform is converted into an amplitude envelope.',
      'The envelope is the smooth outline of loudness over time. It helps you see where the signal becomes weak, strong, stable, or noisy.',
      'You can run the experiment frame-by-frame, compare algorithms, compare smoothing models, zoom graphs, and inspect exact values on hover.',
    ],
  },
  {
    title: 'Step-by-step process',
    points: [
      'Upload an audio file, or click Use demo signal when you only want to test the experiment quickly.',
      'Choose one envelope algorithm: frame peak, Hilbert analytic signal, full-wave rectification, or RMS energy tracking.',
      'Choose one smoothing model: low-pass filter, moving average, Hilbert transform, HHT/EMD, or Gaussian windowing.',
      'Set frame ms and hop ms. Frame size controls how much audio is analysed at once; hop size controls how far the analysis moves each step.',
      'Select start frame and end frame when you want to run only a particular part of the audio.',
      'Click Run experiment. The graph reveals frame-by-frame, not all at once, so you can understand the process.',
      'Use Pause, Resume, Reset, - step, and + step to inspect the signal slowly.',
      'Hover on any graph to read the exact time, frame, and envelope values. Use Zoom in / Zoom out buttons, or drag across a graph to select the exact portion you want to zoom into.',
    ],
  },
  {
    title: 'How to read the graphs',
    points: [
      'Waveform + extracted envelopes shows the original waveform with the raw algorithm envelope and final smoothed envelope.',
      'Envelope detail + residual shows how much the smoother changed the raw envelope. High residual means more difference between raw and smoothed values.',
      'Comparison graph appears only when you enable algorithm comparison or smoothing comparison.',
      'Experiment flow explains the pipeline: decode audio, calculate envelope, smooth it, and reveal the result frame-by-frame.',
    ],
  },
  {
    title: 'Best way to perform the experiment',
    points: [
      'First run the demo signal with RMS Energy Tracking + Low-Pass Filtering to confirm everything works.',
      'Then change only one thing at a time. Do not change algorithm, smoother, frame size, and range together, or you will not know what caused the graph change.',
      'For noisy audio, increase smoothing strength slowly. Too much smoothing can hide real peaks.',
      'Use compare mode only after understanding one selected algorithm. Blind comparison without interpretation is useless.',
    ],
  },
];

const AI_TUTOR_STEPS = [
  {
    target: 'instructions',
    title: 'Open instructions',
    body: 'Use the info button whenever you need the full experiment procedure. Read it once before running the lab.',
    voice: 'Start here. The info button opens the complete experiment procedure. Read it once before running the lab.',
  },
  {
    target: 'audio-source',
    title: 'Load audio',
    body: 'Upload a real audio file, or use the demo signal for a fast test. No audio means no experiment can run.',
  },
  {
    target: 'algorithm-select',
    title: 'Choose envelope algorithm',
    body: 'Select the method that extracts the raw envelope from short frames of the waveform.',
  },
  {
    target: 'smoother-select',
    title: 'Choose smoothing model',
    body: 'Select one smoother only. The smoother converts the raw envelope into a cleaner final trend.',
  },
  {
    target: 'compare-mode',
    title: 'Optional comparison',
    body: 'Enable all algorithms or all smoothing models only when you want comparison. Keep it off for a clean single run.',
  },
  {
    target: 'window-settings',
    title: 'Set frame and hop size',
    body: 'Frame ms controls the analysis window. Hop ms controls how fast the window moves forward.',
  },
  {
    target: 'smoothness-control',
    title: 'Tune smoothing strength',
    body: 'Increase smoothing to reduce jitter. Do not overdo it, because too much smoothing hides real signal changes.',
  },
  {
    target: 'frame-range',
    title: 'Select run range',
    body: 'Choose start and end frames when you want to test only a specific portion of the signal.',
  },
  {
    target: 'speed-control',
    title: 'Set experiment speed',
    body: 'Use speed and frames per tick to make the frame-by-frame animation slower or faster.',
  },
  {
    target: 'run-experiment',
    title: 'Run the experiment',
    body: 'Click Run experiment. The plots will reveal step-by-step instead of instantly dumping the final output.',
  },
  {
    target: 'player-controls',
    title: 'Control frame playback',
    body: 'Pause, resume, reset, or move one step at a time to inspect the current frame properly.',
  },
  {
    target: 'plots-area',
    title: 'Read and zoom graphs',
    body: 'Use the graphs to compare waveform, raw envelope, smoothed envelope, residual, and comparison curves. Hover for values, use the zoom buttons, or drag-select one graph portion to zoom into it.',
  },
  {
    target: 'flow-panel',
    title: 'Interpret the result',
    body: 'Use the experiment flow and result summary to explain what happened, which algorithm was used, and how the smoother affected the final envelope.',
  },
];

function safeFrameRange(frameCount, options) {
  const maxFrame = Math.max(0, frameCount - 1);
  const start = Math.max(0, Math.min(maxFrame, Number(options.startFrame) || 0));
  const rawEnd = options.endFrame === '' || options.endFrame === null || options.endFrame === undefined
    ? maxFrame
    : Number(options.endFrame);
  const end = Math.max(start, Math.min(maxFrame, Number.isFinite(rawEnd) ? rawEnd : maxFrame));
  return { start, end, maxFrame };
}

function activeStepForFrame(currentFrame, startFrame, endFrame) {
  const progress = endFrame === startFrame ? 1 : (currentFrame - startFrame) / Math.max(1, endFrame - startFrame);
  if (progress < 0.12) return 0;
  if (progress < 0.45) return 1;
  if (progress < 0.78) return 2;
  return 3;
}

function findOption(options, value) {
  return options.find((item) => item.value === value) || options[0];
}

function computeEnvelopeRun(samples, sampleRate, options, algorithm, smoother, fixedRange = null) {
  const base = extractEnvelope(samples, sampleRate, options.frameMs, options.hopMs, algorithm);
  const dt = base.hopSize / sampleRate;
  const finalEnvelope = smoothEnvelope(base.envelope, smoother, {
    dt,
    smoothness: options.smoothness,
    processNoise: options.processNoise,
    measurementNoise: options.measurementNoise,
  });
  const residual = Float32Array.from(base.envelope, (value, index) => Math.abs(value - finalEnvelope[index]));
  const range = fixedRange || safeFrameRange(base.times.length, options);
  const algorithmName = getAlgorithmName(algorithm);
  const smootherName = getSmootherName(smoother);

  return {
    algorithm,
    algorithmName,
    smoother,
    smootherName,
    times: base.times,
    rawEnvelope: base.envelope,
    finalEnvelope,
    residual,
    stats: computeStats(samples, sampleRate, base.envelope, finalEnvelope, range.start, range.end),
    frameSize: base.frameSize,
    hopSize: base.hopSize,
    frameRange: range,
    compareLabel: `${algorithmName} + ${smootherName}`,
  };
}

function makeComparisonRuns(samples, sampleRate, options, frameRange) {
  const compareAlgorithms = Boolean(options.compareAlgorithms);
  const compareSmoothers = Boolean(options.compareSmoothers) && !compareAlgorithms;
  if (!compareAlgorithms && !compareSmoothers) return [];

  const algorithms = compareAlgorithms ? ALGORITHM_OPTIONS : [findOption(ALGORITHM_OPTIONS, options.algorithm)];
  const smoothers = compareSmoothers ? SMOOTHER_OPTIONS : [findOption(SMOOTHER_OPTIONS, options.smoother)];

  const runs = [];
  for (const algorithm of algorithms) {
    for (const smoother of smoothers) {
      const run = computeEnvelopeRun(samples, sampleRate, options, algorithm.value, smoother.value, frameRange);
      run.compareLabel = compareAlgorithms && compareSmoothers
        ? `${algorithm.label} / ${smoother.label}`
        : compareAlgorithms
          ? algorithm.label
          : smoother.label;
      runs.push(run);
    }
  }
  return runs;
}

function makeExperimentResult(audioBuffer, options) {
  const { samples } = downmixAudioBuffer(audioBuffer, options.normalize);
  const primary = computeEnvelopeRun(samples, audioBuffer.sampleRate, options, options.algorithm, options.smoother);
  const comparisonRuns = makeComparisonRuns(samples, audioBuffer.sampleRate, options, primary.frameRange);
  const comparisonSeries = comparisonRuns.map((run, index) => ({
    name: run.compareLabel,
    values: run.finalEnvelope,
    color: COMPARE_COLORS[index % COMPARE_COLORS.length],
    width: comparisonRuns.length > 8 ? 1.7 : 2.3,
  }));

  let comparisonModeLabel = '';
  if (options.compareAlgorithms) comparisonModeLabel = 'All algorithms';
  else if (options.compareSmoothers) comparisonModeLabel = 'All smoothing models';

  return {
    ...primary,
    waveformPoints: decimateWaveform(samples, audioBuffer.sampleRate),
    configLabel: `${primary.algorithmName} + ${primary.smootherName}`,
    comparisonRuns,
    comparisonSeries,
    comparisonModeLabel,
  };
}


function PillToggle({ active, label, color, onToggle, className = '' }) {
  return (
    <button
      type="button"
      className={`pill-toggle ${active ? 'active' : 'inactive'} ${className}`.trim()}
      aria-pressed={active}
      onClick={() => onToggle(!active)}
    >
      <span className="pill-color-line" style={{ background: color }} />
      <span className="pill-state-icon" aria-hidden="true">{active ? '✓' : '○'}</span>
      <span className="pill-label">{label}</span>
    </button>
  );
}

function HiddenPlotCard({ title, badge, controls, message }) {
  return (
    <article className="plot-card simple-card hidden-plot-card">
      <div className="section-title-row plot-title-row">
        <h2>{title}</h2>
        {badge ? <span>{badge}</span> : null}
      </div>
      {controls ? <div className="plot-local-controls">{controls}</div> : null}
      <p className="hidden-plot-message">{message}</p>
    </article>
  );
}

function InstructionModal({ open, onClose, onStartGuide }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="instruction-modal simple-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instruction-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title-row">
          <div>
            <span className="eyebrow">Experiment instructions</span>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Close instructions">×</button>
        </div>

        <div className="instruction-content">
          {INSTRUCTION_SECTIONS.map((section, sectionIndex) => (
            <article className="instruction-block" key={section.title}>
              <div className="instruction-step-number">{sectionIndex + 1}</div>
              <div>
                <h3>{section.title}</h3>
                <ul>
                  {section.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <div className="modal-action-row">
          <button className="secondary-btn modal-secondary" type="button" onClick={onClose}>Close</button>
          <button className="run-btn modal-primary" type="button" onClick={() => { onClose(); onStartGuide(); }}>Start AI tutor guide</button>
        </div>
      </section>
    </div>
  );
}

function AiTutorOverlay({ open, step, stepIndex, totalSteps, rect, voiceEnabled, onPrevious, onNext, onClose, onReplay, onToggleVoice }) {
  if (!open || !step) return null;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const cardWidth = Math.min(430, viewportWidth - 32);
  const gap = 18;
  let placement = 'bottom';
  let cardStyle = { width: cardWidth, right: 16, bottom: 16 };

  if (rect) {
    const targetRight = rect.left + rect.width;
    const targetBottom = rect.top + rect.height;
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;
    const cardHeightEstimate = 255;

    if (targetRight + cardWidth + gap < viewportWidth) {
      placement = 'right';
      cardStyle = {
        width: cardWidth,
        left: targetRight + gap,
        top: Math.max(12, Math.min(viewportHeight - cardHeightEstimate - 12, targetCenterY - cardHeightEstimate / 2)),
      };
    } else if (rect.left - cardWidth - gap > 0) {
      placement = 'left';
      cardStyle = {
        width: cardWidth,
        left: rect.left - cardWidth - gap,
        top: Math.max(12, Math.min(viewportHeight - cardHeightEstimate - 12, targetCenterY - cardHeightEstimate / 2)),
      };
    } else if (rect.top - cardHeightEstimate - gap > 0) {
      placement = 'top';
      cardStyle = {
        width: cardWidth,
        left: Math.max(12, Math.min(viewportWidth - cardWidth - 12, targetCenterX - cardWidth / 2)),
        top: rect.top - cardHeightEstimate - gap,
      };
    } else {
      placement = 'bottom';
      cardStyle = {
        width: cardWidth,
        left: Math.max(12, Math.min(viewportWidth - cardWidth - 12, targetCenterX - cardWidth / 2)),
        top: Math.min(viewportHeight - cardHeightEstimate - 12, targetBottom + gap),
      };
    }
  }

  const boxLeft = rect ? Math.max(8, rect.left - 6) : 0;
  const boxTop = rect ? Math.max(8, rect.top - 6) : 0;
  const boxWidth = rect ? Math.max(80, Math.min(viewportWidth - boxLeft - 8, rect.width + 12)) : 0;
  const boxHeight = rect ? Math.max(44, Math.min(viewportHeight - boxTop - 8, rect.height + 12)) : 0;

  return (
    <>
      {rect ? (
        <div
          className="guide-highlight-box"
          style={{
            top: boxTop,
            left: boxLeft,
            width: boxWidth,
            height: boxHeight,
          }}
          aria-hidden="true"
        />
      ) : null}
      <section
        className={`ai-tutor-card simple-card guide-placement-${placement}`}
        style={cardStyle}
        role="dialog"
        aria-live="polite"
        aria-label="AI tutor guide"
      >
        <div className="guide-pointer-word" aria-hidden="true">➜</div>
        <div className="guide-progress-row">
          <span>AI tutor guide</span>
          <strong>{stepIndex + 1} / {totalSteps}</strong>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {!rect ? <p className="guide-missing-target">This step appears after you run the experiment. Continue the guide, or run the experiment when it points to the Run button.</p> : null}
        <div className="guide-actions">
          <button className="secondary-btn mini-btn" type="button" onClick={onPrevious} disabled={isFirst}>Previous</button>
          <button className="secondary-btn mini-btn" type="button" onClick={onReplay}>Speak again</button>
          <button className="secondary-btn mini-btn" type="button" onClick={onToggleVoice}>{voiceEnabled ? 'Voice on' : 'Voice off'}</button>
          <button className="secondary-btn mini-btn" type="button" onClick={onClose}>Close</button>
          <button className="run-btn mini-btn guide-next-btn" type="button" onClick={onNext}>{isLast ? 'Finish' : 'Next'}</button>
        </div>
      </section>
    </>
  );
}

function CompactResultSummary({ metrics, comparisonRows, comparisonActive, audioName }) {
  return (
    <section className="compact-result-summary" aria-label="Result summary">
      <div className="section-title-row">
        <h2>Result summary</h2>
        <span>{audioName || 'Audio file'}</span>
      </div>
      <div className="summary-grid compact-summary-grid">
        {metrics.map(([label, value]) => (
          <div className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      {comparisonActive && comparisonRows.length ? (
        <div className="comparison-table-wrap">
          <div className="section-title-row comparison-title-row">
            <h3>Comparison metrics</h3>
            <span>{comparisonRows.length} runs</span>
          </div>
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Peak</th>
                <th>Mean</th>
                <th>Residual RMS</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.peak}</td>
                  <td>{row.mean}</td>
                  <td>{row.residualRms}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint comparison-hint">Residual RMS only tells how far the smoothed curve is from the raw envelope. A smaller value is closer to raw data; it is not automatically the best choice if the curve becomes too noisy.</p>
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const [audio, setAudio] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [options, setOptions] = useState({
    algorithm: 'rmsEnergy',
    smoother: 'lowpass',
    compareSmoothers: false,
    compareAlgorithms: false,
    frameMs: 25,
    hopMs: 10,
    smoothness: 38,
    processNoise: 0.006,
    measurementNoise: 0.02,
    normalize: true,
    startFrame: '0',
    endFrame: '',
    speedMs: 35,
    frameStep: 1,
    visibility: DEFAULT_VISIBILITY,
    colors: DEFAULT_COLORS,
    comparisonVisibility: {},
  });
  const [player, setPlayer] = useState(INITIAL_PLAYER);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [guideRect, setGuideRect] = useState(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const activeGuideStep = AI_TUTOR_STEPS[guideIndex];

  useEffect(() => {
    if (!guideOpen || !activeGuideStep?.target) {
      setGuideRect(null);
      return undefined;
    }

    let timerId = 0;
    function updateGuideRect() {
      const target = document.querySelector(`[data-guide-target="${activeGuideStep.target}"]`);
      if (!target) {
        setGuideRect(null);
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        const rect = target.getBoundingClientRect();
        setGuideRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }, 160);
    }

    updateGuideRect();
    window.addEventListener('resize', updateGuideRect);
    window.addEventListener('scroll', updateGuideRect, true);
    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener('resize', updateGuideRect);
      window.removeEventListener('scroll', updateGuideRect, true);
    };
  }, [guideOpen, activeGuideStep?.target, result]);

  useEffect(() => {
    if (!audio?.buffer || !player.hasRun) return;
    if (Number(options.hopMs) > Number(options.frameMs)) {
      setError('Hop ms should be less than or equal to frame ms.');
      return;
    }

    const nextResult = makeExperimentResult(audio.buffer, options);
    const { start, end } = nextResult.frameRange;
    setResult(nextResult);
    setError('');
    setPlayer((old) => {
      const nextFrame = Math.max(start, Math.min(end, old.currentFrame));
      return {
        ...old,
        startFrame: start,
        endFrame: end,
        currentFrame: nextFrame,
        activeStep: activeStepForFrame(nextFrame, start, end),
        isRunning: old.isRunning && nextFrame < end,
      };
    });
  }, [
    audio?.buffer,
    player.hasRun,
    options.algorithm,
    options.smoother,
    options.compareSmoothers,
    options.compareAlgorithms,
    options.frameMs,
    options.hopMs,
    options.smoothness,
    options.processNoise,
    options.measurementNoise,
    options.normalize,
    options.startFrame,
    options.endFrame,
  ]);

  useEffect(() => {
    if (!player.isRunning || !result) return undefined;
    const id = window.setInterval(() => {
      setPlayer((old) => {
        if (!old.isRunning) return old;
        const step = Math.max(1, Number(options.frameStep) || 1);
        const nextFrame = Math.min(old.currentFrame + step, old.endFrame);
        const finished = nextFrame >= old.endFrame;
        return {
          ...old,
          currentFrame: nextFrame,
          isRunning: !finished,
          activeStep: activeStepForFrame(nextFrame, old.startFrame, old.endFrame),
        };
      });
    }, Math.max(10, Number(options.speedMs) || 35));

    return () => window.clearInterval(id);
  }, [player.isRunning, result, options.speedMs, options.frameStep]);

  const currentValues = useMemo(() => {
    if (!result) return null;
    const frame = Math.max(0, Math.min(result.times.length - 1, player.currentFrame));
    return {
      frame,
      time: result.times[frame] || 0,
      raw: result.rawEnvelope[frame] || 0,
      final: result.finalEnvelope[frame] || 0,
      residual: result.residual[frame] || 0,
    };
  }, [result, player.currentFrame]);

  const metrics = useMemo(() => {
    if (!result) return [];
    return [
      ['Algorithm', result.algorithmName],
      ['Smoother', result.smootherName],
      ['Frame range', `${player.startFrame} - ${player.endFrame}`],
      ['Current frame / time', currentValues ? `${currentValues.frame.toLocaleString()} / ${formatNumber(currentValues.time, 3)} s` : '-'],
      ['Raw value', currentValues ? formatNumber(currentValues.raw, 6) : '-'],
      ['Final envelope', currentValues ? formatNumber(currentValues.final, 6) : '-'],
      ['Residual', currentValues ? formatNumber(currentValues.residual, 6) : '-'],
      ['Peak / mean', `${formatNumber(result.stats.envPeak, 5)} / ${formatNumber(result.stats.envMean, 5)}`],
    ];
  }, [result, player.startFrame, player.endFrame, currentValues]);

  const comparisonRows = useMemo(() => {
    if (!result?.comparisonRuns?.length) return [];
    return result.comparisonRuns.map((run) => ({
      label: run.compareLabel,
      peak: formatNumber(run.stats.envPeak, 5),
      mean: formatNumber(run.stats.envMean, 5),
      residualRms: formatNumber(run.stats.residualRms, 6),
    }));
  }, [result]);

  function updateOption(key, value) {
    setOptions((old) => ({ ...old, [key]: value }));
  }

  function updateVisibility(key, checked) {
    setOptions((old) => ({
      ...old,
      visibility: { ...old.visibility, [key]: checked },
    }));
  }

  function setPlotPanels(checked) {
    setOptions((old) => ({
      ...old,
      visibility: {
        ...old.visibility,
        waveformPlot: checked,
        detailPlot: checked,
        comparisonPlot: checked,
      },
    }));
  }

  function setPlotLayers(checked) {
    setOptions((old) => ({
      ...old,
      visibility: {
        ...old.visibility,
        waveform: checked,
        rawEnvelope: checked,
        finalEnvelope: checked,
        residual: checked,
      },
    }));
  }

  function updateComparisonVisibility(name, checked) {
    setOptions((old) => ({
      ...old,
      comparisonVisibility: { ...old.comparisonVisibility, [name]: checked },
    }));
  }

  function setAllComparisonLines(checked) {
    if (!result?.comparisonSeries?.length) return;
    const next = {};
    for (const item of result.comparisonSeries) next[item.name] = checked;
    setOptions((old) => ({ ...old, comparisonVisibility: { ...old.comparisonVisibility, ...next } }));
  }

  function resetResultState() {
    setResult(null);
    setPlayer(INITIAL_PLAYER);
  }

  function runExperiment() {
    if (!audio?.buffer) {
      setError('Upload an audio file or use the demo signal first.');
      return;
    }
    if (Number(options.hopMs) > Number(options.frameMs)) {
      setError('Hop ms should be less than or equal to frame ms.');
      return;
    }

    const nextResult = makeExperimentResult(audio.buffer, options);
    const { start, end } = nextResult.frameRange;
    setError('');
    setResult(nextResult);
    setPlayer({
      hasRun: true,
      isRunning: end > start,
      currentFrame: start,
      startFrame: start,
      endFrame: end,
      activeStep: activeStepForFrame(start, start, end),
    });
  }

  async function loadAudioFile(file) {
    if (!file) return;
    setError('');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
      await context.close();
      const url = URL.createObjectURL(file);
      setAudio((old) => {
        if (old?.url) URL.revokeObjectURL(old.url);
        return { name: file.name, buffer, url };
      });
      resetResultState();
    } catch (err) {
      setError(err.message || 'Could not decode this audio file in the browser.');
    }
  }

  function useDemoSignal() {
    const buffer = createDemoBuffer();
    setAudio((old) => {
      if (old?.url) URL.revokeObjectURL(old.url);
      return { name: 'Synthetic amplitude demo', buffer, url: '' };
    });
    resetResultState();
  }

  function speakGuideStep(step = activeGuideStep, force = false) {
    if ((!voiceEnabled && !force) || !step || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${step.title}. ${step.voice || step.body}`);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function startGuide() {
    const firstIndex = 0;
    setGuideIndex(firstIndex);
    setGuideOpen(true);
    window.setTimeout(() => speakGuideStep(AI_TUTOR_STEPS[firstIndex]), 80);
  }

  function closeGuide() {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setGuideOpen(false);
    setGuideRect(null);
  }

  function moveGuide(direction) {
    const nextIndex = Math.max(0, Math.min(AI_TUTOR_STEPS.length - 1, guideIndex + direction));
    setGuideIndex(nextIndex);
    window.setTimeout(() => speakGuideStep(AI_TUTOR_STEPS[nextIndex]), 80);
  }

  function nextGuideStep() {
    if (guideIndex >= AI_TUTOR_STEPS.length - 1) {
      closeGuide();
      return;
    }
    moveGuide(1);
  }

  function toggleGuideVoice() {
    setVoiceEnabled((old) => {
      const next = !old;
      if (!next && typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
      if (next) window.setTimeout(() => speakGuideStep(activeGuideStep, true), 40);
      return next;
    });
  }

  function pauseExperiment() {
    setPlayer((old) => ({ ...old, isRunning: false }));
  }

  function resumeExperiment() {
    if (!result) return;
    setPlayer((old) => ({ ...old, isRunning: old.currentFrame < old.endFrame }));
  }

  function resetExperimentFrame() {
    setPlayer((old) => ({
      ...old,
      isRunning: false,
      currentFrame: old.startFrame,
      activeStep: activeStepForFrame(old.startFrame, old.startFrame, old.endFrame),
    }));
  }

  function goToFrame(value) {
    if (!result) return;
    setPlayer((old) => {
      const frame = Math.max(old.startFrame, Math.min(old.endFrame, Number(value) || old.startFrame));
      return {
        ...old,
        isRunning: false,
        currentFrame: frame,
        activeStep: activeStepForFrame(frame, old.startFrame, old.endFrame),
      };
    });
  }

  function stepFrame(direction) {
    setPlayer((old) => {
      const step = Math.max(1, Number(options.frameStep) || 1);
      const nextFrame = Math.max(old.startFrame, Math.min(old.endFrame, old.currentFrame + direction * step));
      return {
        ...old,
        isRunning: false,
        currentFrame: nextFrame,
        activeStep: activeStepForFrame(nextFrame, old.startFrame, old.endFrame),
      };
    });
  }

  const visibleMainSeries = result ? [
    ...(options.visibility.rawEnvelope ? [{ name: 'Algorithm envelope', values: result.rawEnvelope, color: options.colors.rawEnvelope, width: 1.6 }] : []),
    ...(options.visibility.finalEnvelope ? [{ name: 'Final envelope', values: result.finalEnvelope, color: options.colors.finalEnvelope, width: 2.6 }] : []),
  ] : [];

  const visibleDetailSeries = result ? [
    ...(options.visibility.rawEnvelope ? [{ name: 'Algorithm envelope', values: result.rawEnvelope, color: options.colors.rawEnvelope, width: 1.8 }] : []),
    ...(options.visibility.finalEnvelope ? [{ name: 'Final envelope', values: result.finalEnvelope, color: options.colors.finalEnvelope, width: 2.8 }] : []),
    ...(options.visibility.residual ? [{ name: 'Absolute residual', values: result.residual, color: options.colors.residual, width: 1.5 }] : []),
  ] : [];

  const visibleComparisonSeries = result?.comparisonSeries?.length
    ? result.comparisonSeries.filter((item) => options.comparisonVisibility[item.name] !== false)
    : [];

  const selectedAlgorithm = ALGORITHM_OPTIONS.find((item) => item.value === options.algorithm);
  const selectedSmoother = SMOOTHER_OPTIONS.find((item) => item.value === options.smoother);
  const rangeLabel = result ? `Frames ${player.startFrame} to ${player.endFrame}` : 'Run to calculate frames';
  const maxFrameLabel = result ? `Max: ${result.frameRange.maxFrame}` : 'Max: run first';
  const comparisonActive = Boolean(result?.comparisonSeries?.length);
  const comparisonLinesDisabled = comparisonActive && options.visibility.comparisonPlot && visibleComparisonSeries.length === 0;
  const hasVisibleComparisonPlot = comparisonActive && options.visibility.comparisonPlot && visibleComparisonSeries.length > 0;
  const plotsDisabled = result && !options.visibility.waveformPlot && !options.visibility.detailPlot && !hasVisibleComparisonPlot;

  const waveformPlotControls = result ? (
    <div className="plot-toggle-strip" aria-label="Waveform graph controls">
      <PillToggle active={options.visibility.waveformPlot} label="Waveform + envelope graph" color={options.colors.waveform} onToggle={(checked) => updateVisibility('waveformPlot', checked)} />
      <PillToggle active={options.visibility.waveform} label="Waveform" color={options.colors.waveform} onToggle={(checked) => updateVisibility('waveform', checked)} />
      <PillToggle active={options.visibility.rawEnvelope} label="Algorithm envelope" color={options.colors.rawEnvelope} onToggle={(checked) => updateVisibility('rawEnvelope', checked)} />
      <PillToggle active={options.visibility.finalEnvelope} label="Final envelope" color={options.colors.finalEnvelope} onToggle={(checked) => updateVisibility('finalEnvelope', checked)} />
    </div>
  ) : null;

  const detailPlotControls = result ? (
    <div className="plot-toggle-strip" aria-label="Envelope detail graph controls">
      <PillToggle active={options.visibility.detailPlot} label="Envelope detail graph" color={options.colors.finalEnvelope} onToggle={(checked) => updateVisibility('detailPlot', checked)} />
      <PillToggle active={options.visibility.rawEnvelope} label="Algorithm envelope" color={options.colors.rawEnvelope} onToggle={(checked) => updateVisibility('rawEnvelope', checked)} />
      <PillToggle active={options.visibility.finalEnvelope} label="Final envelope" color={options.colors.finalEnvelope} onToggle={(checked) => updateVisibility('finalEnvelope', checked)} />
      <PillToggle active={options.visibility.residual} label="Residual" color={options.colors.residual} onToggle={(checked) => updateVisibility('residual', checked)} />
    </div>
  ) : null;

  const comparisonPlotControls = result && comparisonActive ? (
    <div className="plot-toggle-strip comparison-toggle-strip" aria-label="Comparison graph controls">
      <PillToggle active={options.visibility.comparisonPlot} label="Comparison graph" color="#7c3aed" onToggle={(checked) => updateVisibility('comparisonPlot', checked)} />
      {result.comparisonSeries.map((item) => (
        <PillToggle
          key={item.name}
          active={options.comparisonVisibility[item.name] !== false}
          label={item.name}
          color={item.color}
          className="comparison-pill-toggle"
          onToggle={(checked) => updateComparisonVisibility(item.name, checked)}
        />
      ))}
    </div>
  ) : null;

  const resultPanelControls = result ? (
    <div className="plot-toggle-strip" aria-label="Conclusion result panel controls">
      <PillToggle active={options.visibility.flowPlot} label="Conclusion / result panel" color={options.colors.residual} onToggle={(checked) => updateVisibility('flowPlot', checked)} />
    </div>
  ) : null;

  const summaryBlock = result ? (
    <CompactResultSummary
      metrics={metrics}
      comparisonRows={comparisonRows}
      comparisonActive={comparisonActive}
      audioName={audio?.name}
    />
  ) : null;

  return (
    <main className="app-shell">
      <header className="project-header simple-card">
        <div>
          <h1>Amplitude Envelope Extraction</h1>
        </div>
        <div className="header-actions" aria-label="Help actions">
          <button
            className="info-icon-btn"
            data-guide-target="instructions"
            type="button"
            onClick={() => setInstructionsOpen(true)}
            aria-label="Open experiment instructions"
          >
            i
          </button>
          <button
            className="guide-start-btn"
            data-guide-target="ai-tutor"
            type="button"
            onClick={startGuide}
          >
            AI Tutor Guide
          </button>
        </div>
      </header>

      <section className="layout">
        <aside className="controls simple-card" aria-label="Experiment controls">
          <section className="field-group first-field" data-guide-target="audio-source">
            <label htmlFor="audioFile">Audio file</label>
            <input id="audioFile" type="file" accept="audio/*" onChange={(event) => loadAudioFile(event.target.files[0])} />
          </section>

          <section className="field-group" data-guide-target="algorithm-select">
            <label htmlFor="algorithm">Envelope algorithm</label>
            <select id="algorithm" className="select-box" value={options.algorithm} onChange={(event) => updateOption('algorithm', event.target.value)}>
              {ALGORITHM_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </section>

          <section className="field-group" data-guide-target="smoother-select">
            <label htmlFor="smoother">Smoothing model</label>
            <select id="smoother" className="select-box" value={options.smoother} onChange={(event) => updateOption('smoother', event.target.value)}>
              {SMOOTHER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </section>

          <section className="field-group" data-guide-target="compare-mode">
            <label>Compare mode</label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={options.compareSmoothers}
                onChange={(event) => setOptions((old) => ({
                  ...old,
                  compareSmoothers: event.target.checked,
                  compareAlgorithms: false,
                  comparisonVisibility: {},
                }))}
              />
              <span>Compare all smoothing models</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={options.compareAlgorithms}
                onChange={(event) => setOptions((old) => ({
                  ...old,
                  compareAlgorithms: event.target.checked,
                  compareSmoothers: false,
                  comparisonVisibility: {},
                }))}
              />
              <span>Compare all algorithms</span>
            </label>
          </section>

          <section className="field-group" data-guide-target="window-settings">
            <label>Short-time analysis window</label>
            <div className="row-2">
              <div>
                <span>Frame ms</span>
                <input type="number" min="5" max="250" value={options.frameMs} onChange={(event) => updateOption('frameMs', clamp(event.target.value, 5, 250))} />
              </div>
              <div>
                <span>Hop ms</span>
                <input type="number" min="2" max="100" value={options.hopMs} onChange={(event) => updateOption('hopMs', clamp(event.target.value, 2, 100))} />
              </div>
            </div>
          </section>

          <section className="field-group" data-guide-target="smoothness-control">
            <label htmlFor="smoothness">Smoothing strength</label>
            <div className="slider-row">
              <span>Fast</span>
              <input id="smoothness" type="range" min="1" max="100" value={options.smoothness} onChange={(event) => updateOption('smoothness', Number(event.target.value))} />
              <span>Slow</span>
            </div>
          </section>

          <section className="field-group" data-guide-target="frame-range">
            <label>Run frame range</label>
            <div className="row-2">
              <div>
                <span>Start frame</span>
                <input type="number" min="0" value={options.startFrame} onChange={(event) => updateOption('startFrame', event.target.value)} />
              </div>
              <div>
                <span>End frame</span>
                <input type="number" min="0" placeholder="All" value={options.endFrame} onChange={(event) => updateOption('endFrame', event.target.value)} />
              </div>
            </div>
          </section>

          <section className="field-group" data-guide-target="speed-control">
            <label htmlFor="speedMs">Experiment speed</label>
            <div className="slider-row">
              <span>Fast</span>
              <input id="speedMs" type="range" min="10" max="300" value={options.speedMs} onChange={(event) => updateOption('speedMs', Number(event.target.value))} />
              <span>Slow</span>
            </div>
            <div className="row-2 frame-step-row">
              <div>
                <span>Ms / tick</span>
                <input type="number" min="10" max="300" value={options.speedMs} onChange={(event) => updateOption('speedMs', clamp(event.target.value, 10, 300))} />
              </div>
              <div>
                <span>Frames / tick</span>
                <input type="number" min="1" max="1000" value={options.frameStep} onChange={(event) => updateOption('frameStep', clamp(event.target.value, 1, 1000))} />
              </div>
            </div>
          </section>

          {result ? (
            <section className="field-group" data-guide-target="current-frame-control">
              <label htmlFor="currentFrame">Current frame control</label>
              <input
                id="currentFrame"
                type="range"
                min={player.startFrame}
                max={player.endFrame}
                value={player.currentFrame}
                onChange={(event) => goToFrame(event.target.value)}
              />
              <div className="row-2 frame-step-row">
                <div>
                  <span>Current frame</span>
                  <input type="number" min={player.startFrame} max={player.endFrame} value={player.currentFrame} onChange={(event) => goToFrame(event.target.value)} />
                </div>
                <div>
                  <span>Time</span>
                  <input type="text" readOnly value={currentValues ? `${formatNumber(currentValues.time, 4)} s` : '-'} />
                </div>
              </div>
            </section>
          ) : null}

          <section className="field-group">
            <label>Display</label>
            <label className="toggle-row">
              <input type="checkbox" checked={options.normalize} onChange={(event) => updateOption('normalize', event.target.checked)} />
              <span>Normalize audio before analysis</span>
            </label>
          </section>

          <button className="run-btn" data-guide-target="run-experiment" type="button" onClick={runExperiment}>Run experiment</button>
          <div className="player-controls" data-guide-target="player-controls">
            <button className="secondary-btn mini-btn" type="button" onClick={pauseExperiment} disabled={!result}>Pause</button>
            <button className="secondary-btn mini-btn" type="button" onClick={resumeExperiment} disabled={!result || player.currentFrame >= player.endFrame}>Resume</button>
            <button className="secondary-btn mini-btn" type="button" onClick={resetExperimentFrame} disabled={!result}>Reset</button>
          </div>
          <div className="player-controls">
            <button className="secondary-btn mini-btn" type="button" onClick={() => stepFrame(-1)} disabled={!result}>- step</button>
            <button className="secondary-btn mini-btn" type="button" onClick={() => stepFrame(1)} disabled={!result}>+ step</button>
          </div>
          {error ? <p className="error-box">{error}</p> : null}
        </aside>

        <section className="content">
          {!result ? (
            <section className="empty-state simple-card" data-guide-target="plots-area">
              <h2>Upload audio to begin</h2>
              <p>This React app extracts the amplitude envelope using selectable algorithms, compares algorithms/smoothing models when needed, and lets you run the experiment frame-by-frame inside your chosen range.</p>
            </section>
          ) : (
            <>
              <section className="plots">
                <div data-guide-target="plots-area">
                  {options.visibility.waveformPlot ? (
                  <CanvasPlot
                    title="Waveform + extracted envelopes"
                    topControls={waveformPlotControls}
                    xLabel="X-axis: Time (seconds)"
                    yLabel="Y-axis: Normalized amplitude / envelope magnitude"
                    waveformPoints={options.visibility.waveform ? result.waveformPoints : []}
                    waveformColor={options.colors.waveform}
                    cursorColor={options.colors.cursor}
                    x={result.times}
                    series={visibleMainSeries}
                    height={420}
                    range={{ start: player.startFrame, end: player.endFrame }}
                    visibleUntilIndex={player.currentFrame}
                    currentFrame={player.currentFrame}
                  />
                ) : (
                  <HiddenPlotCard title="Waveform + extracted envelopes" badge={rangeLabel} controls={waveformPlotControls} message="This graph is disabled. Turn on the first button above to show it again." />
                  )}
                </div>

                {options.visibility.detailPlot ? (
                  <CanvasPlot
                    title="Envelope detail + residual"
                    topControls={detailPlotControls}
                    xLabel="X-axis: Time (seconds)"
                    yLabel="Y-axis: Envelope magnitude / residual"
                    x={result.times}
                    series={visibleDetailSeries}
                    height={320}
                    range={{ start: player.startFrame, end: player.endFrame }}
                    visibleUntilIndex={player.currentFrame}
                    currentFrame={player.currentFrame}
                    cursorColor={options.colors.cursor}
                  />
                ) : (
                  <HiddenPlotCard title="Envelope detail + residual" badge={`${result.smootherName} active`} controls={detailPlotControls} message="This graph is disabled. Turn on the first button above to show it again." />
                )}

                {comparisonActive ? (
                  options.visibility.comparisonPlot && visibleComparisonSeries.length ? (
                    <CanvasPlot
                      title="Comparison graph"
                      topControls={comparisonPlotControls}
                      xLabel="X-axis: Time (seconds)"
                      yLabel="Y-axis: Final envelope value"
                      x={result.times}
                      series={visibleComparisonSeries}
                      height={360}
                      range={{ start: player.startFrame, end: player.endFrame }}
                      visibleUntilIndex={player.currentFrame}
                      currentFrame={player.currentFrame}
                      cursorColor={options.colors.cursor}
                    />
                  ) : (
                    <HiddenPlotCard
                      title="Comparison graph"
                      controls={comparisonPlotControls}
                      message={options.visibility.comparisonPlot ? 'All comparison curves are disabled. Turn on at least one curve above to show this graph.' : 'This graph is disabled. Turn on the first button above to show it again.'}
                    />
                  )
                ) : null}
              </section>

              {options.visibility.flowPlot ? (
                <>
                  <section className="result-panel-toggle simple-card">
                    {resultPanelControls}
                  </section>
                  <div data-guide-target="flow-panel">
                    <ExperimentFlow
                      algorithmName={result.algorithmName}
                      smootherName={result.smootherName}
                      activeStep={player.activeStep}
                      frameRangeLabel={rangeLabel}
                    >
                      {summaryBlock}
                    </ExperimentFlow>
                  </div>
                </>
              ) : (
                <HiddenPlotCard title="Conclusion / result panel" controls={resultPanelControls} message="This panel is disabled. Turn on the button above to show the conclusion and result summary again." />
              )}

              {audio?.url ? <audio className="audio-player" src={audio.url} controls /> : null}
            </>
          )}
        </section>
      </section>
      <InstructionModal open={instructionsOpen} onClose={() => setInstructionsOpen(false)} onStartGuide={startGuide} />
      <AiTutorOverlay
        open={guideOpen}
        step={activeGuideStep}
        stepIndex={guideIndex}
        totalSteps={AI_TUTOR_STEPS.length}
        rect={guideRect}
        voiceEnabled={voiceEnabled}
        onPrevious={() => moveGuide(-1)}
        onNext={nextGuideStep}
        onClose={closeGuide}
        onReplay={() => speakGuideStep(activeGuideStep)}
        onToggleVoice={toggleGuideVoice}
      />
    </main>
  );
}
