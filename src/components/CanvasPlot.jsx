import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '../utils/envelope.js';

const GRID = '#dbe3ef';
const TEXT = '#0f172a';

function drawAxes(ctx, width, height, padding, bounds) {
  const { xMin, xMax, yMin, yMax } = bounds;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT;
  ctx.font = `${12 * (window.devicePixelRatio || 1)}px Inter, sans-serif`;

  for (let i = 0; i <= 5; i += 1) {
    const y = padding.top + (i / 5) * (height - padding.top - padding.bottom);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(formatNumber(yMax - (i / 5) * (yMax - yMin), 2), 8, y + 4);
  }

  for (let i = 0; i <= 6; i += 1) {
    const x = padding.left + (i / 6) * (width - padding.left - padding.right);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.fillText(formatNumber(xMin + (i / 6) * (xMax - xMin), 2), x - 15, height - 12);
  }
}

function plotLine(ctx, xs, ys, scale, color, width = 2, startIndex = 0, endIndex = xs.length - 1) {
  if (endIndex < startIndex) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * (window.devicePixelRatio || 1);
  ctx.beginPath();
  let started = false;
  for (let i = startIndex; i <= endIndex; i += 1) {
    const yValue = ys[i];
    if (!Number.isFinite(yValue)) continue;
    const x = scale.x(xs[i]);
    const y = scale.y(yValue);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) ctx.stroke();
}

function maxSeries(series, startIndex, endIndex) {
  if (endIndex < startIndex) return 0;
  let max = 0;
  for (const item of series) {
    for (let i = startIndex; i <= endIndex; i += 1) max = Math.max(max, item.values[i] || 0);
  }
  return max;
}

function getBaseRange(x, range) {
  const last = Math.max(0, (x?.length || 1) - 1);
  const fullStart = Math.max(0, Math.min(last, Number(range?.start) || 0));
  const fullEnd = Math.max(fullStart, Math.min(last, Number(range?.end ?? last)));
  return { fullStart, fullEnd, last };
}

function getDisplayRange(x, range, visibleUntilIndex, zoom) {
  const { fullStart, fullEnd, last } = getBaseRange(x, range);
  const start = zoom
    ? Math.max(fullStart, Math.min(fullEnd, Number(zoom.start) || fullStart))
    : fullStart;
  const selectedEnd = zoom
    ? Math.max(start, Math.min(fullEnd, Number(zoom.end) || fullEnd))
    : fullEnd;
  const currentVisible = Number.isFinite(Number(visibleUntilIndex)) ? Number(visibleUntilIndex) : fullEnd;
  const visibleEnd = Math.max(start, Math.min(selectedEnd, currentVisible));
  return { start, selectedEnd, visibleEnd, fullStart, fullEnd, last };
}

function frameFromClientX(event, state, canvas) {
  const rect = canvas.getBoundingClientRect();
  const localX = (event.clientX - rect.left) * state.ratio;
  const clampedX = Math.max(state.padding.left, Math.min(state.width - state.padding.right, localX));
  const percent = (clampedX - state.padding.left) / Math.max(1, state.width - state.padding.left - state.padding.right);
  const frame = Math.round(state.start + percent * Math.max(0, state.selectedEnd - state.start));
  return Math.max(state.start, Math.min(state.selectedEnd, frame));
}

function insidePlot(event, state, canvas) {
  const rect = canvas.getBoundingClientRect();
  const localX = (event.clientX - rect.left) * state.ratio;
  const localY = (event.clientY - rect.top) * state.ratio;
  return (
    localX >= state.padding.left &&
    localX <= state.width - state.padding.right &&
    localY >= state.padding.top &&
    localY <= state.height - state.padding.bottom
  );
}

export default function CanvasPlot({
  title,
  badge,
  xLabel,
  yLabel,
  waveformPoints,
  waveformColor = '#2563eb',
  cursorColor = '#0f172a',
  x,
  series = [],
  height = 360,
  range,
  visibleUntilIndex,
  currentFrame,
  topControls,
}) {
  const canvasRef = useRef(null);
  const plotStateRef = useRef(null);
  const selectionRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [dragSelection, setDragSelection] = useState(null);

  useEffect(() => {
    setZoom(null);
    setDragSelection(null);
    selectionRef.current = null;
  }, [range?.start, range?.end, x?.length]);

  useEffect(() => {
    function handleWindowMouseUp(event) {
      if (selectionRef.current) finishSelection(event);
    }
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  });

  function updateZoom(factor, centerFrame = currentFrame) {
    if (!x?.length) return;
    const { fullStart, fullEnd } = getBaseRange(x, range);
    const currentStart = zoom?.start ?? fullStart;
    const currentEnd = zoom?.end ?? fullEnd;
    const fullWindow = Math.max(1, fullEnd - fullStart);
    const currentWindow = Math.max(1, currentEnd - currentStart);
    const nextWindow = Math.max(5, Math.min(fullWindow, Math.round(currentWindow * factor)));
    const center = Math.max(fullStart, Math.min(fullEnd, Number(centerFrame) || Math.round((currentStart + currentEnd) / 2)));
    let nextStart = Math.round(center - nextWindow / 2);
    let nextEnd = nextStart + nextWindow;

    if (nextStart < fullStart) {
      nextStart = fullStart;
      nextEnd = fullStart + nextWindow;
    }
    if (nextEnd > fullEnd) {
      nextEnd = fullEnd;
      nextStart = fullEnd - nextWindow;
    }

    if (nextStart <= fullStart && nextEnd >= fullEnd) setZoom(null);
    else setZoom({ start: nextStart, end: nextEnd });
  }

  function zoomToFrames(a, b) {
    if (!x?.length) return;
    const { fullStart, fullEnd } = getBaseRange(x, range);
    const start = Math.max(fullStart, Math.min(fullEnd, Math.min(a, b)));
    const end = Math.max(start, Math.min(fullEnd, Math.max(a, b)));
    if (end - start < 2) return;
    if (start <= fullStart && end >= fullEnd) setZoom(null);
    else setZoom({ start, end });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width * ratio));
    const canvasHeight = Math.floor(height * ratio);
    canvas.width = width;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!waveformPoints?.length && !series?.length) {
      ctx.clearRect(0, 0, width, canvasHeight);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, canvasHeight);
      plotStateRef.current = null;
      return;
    }
    const padding = { left: 54, right: 18, top: 18, bottom: 42 };
    const { start, selectedEnd, visibleEnd, fullStart, fullEnd } = getDisplayRange(x, range, visibleUntilIndex, zoom);
    const xMin = x?.[start] ?? waveformPoints?.[0]?.t ?? 0;
    const xMax = x?.[selectedEnd] ?? waveformPoints?.[waveformPoints.length - 1]?.t ?? 1;
    const xVisibleMax = x?.[visibleEnd] ?? xMax;
    const visibleWaveform = waveformPoints?.length
      ? waveformPoints.filter((point) => point.t >= xMin && point.t <= Math.min(xMax, xVisibleMax))
      : [];
    const yMin = visibleWaveform.length ? -1.05 : 0;
    const yMax = visibleWaveform.length
      ? Math.max(1.05, maxSeries(series, start, visibleEnd) * 1.15)
      : maxSeries(series, start, visibleEnd) * 1.15 || 1;

    drawAxes(ctx, width, canvasHeight, padding, { xMin, xMax, yMin, yMax });

    const scale = {
      x: (value) => padding.left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (width - padding.left - padding.right),
      y: (value) => canvasHeight - padding.bottom - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * (canvasHeight - padding.top - padding.bottom),
    };

    if (visibleWaveform.length) {
      ctx.strokeStyle = waveformColor;
      ctx.lineWidth = ratio;
      ctx.beginPath();
      for (const point of visibleWaveform) {
        const px = scale.x(point.t);
        ctx.moveTo(px, scale.y(point.min));
        ctx.lineTo(px, scale.y(point.max));
      }
      ctx.stroke();
    }

    for (const item of series) {
      plotLine(ctx, x, item.values, scale, item.color, item.width, start, visibleEnd);
    }

    if (Number.isFinite(currentFrame) && currentFrame >= start && currentFrame <= selectedEnd && x?.[currentFrame] !== undefined) {
      const cursorX = scale.x(x[currentFrame]);
      ctx.save();
      ctx.strokeStyle = cursorColor;
      ctx.lineWidth = 1.5 * ratio;
      ctx.setLineDash([6 * ratio, 5 * ratio]);
      ctx.beginPath();
      ctx.moveTo(cursorX, padding.top);
      ctx.lineTo(cursorX, canvasHeight - padding.bottom);
      ctx.stroke();
      ctx.restore();
    }

    plotStateRef.current = {
      padding,
      width,
      height: canvasHeight,
      ratio,
      xMin,
      xMax,
      start,
      visibleEnd,
      selectedEnd,
      fullStart,
      fullEnd,
      x,
      series,
      waveformPoints: visibleWaveform,
    };
  }, [height, series, waveformPoints, waveformColor, cursorColor, x, range, visibleUntilIndex, currentFrame, zoom]);

  function handleMove(event) {
    const state = plotStateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas || !state.x?.length) return;

    if (selectionRef.current) {
      const nextFrame = frameFromClientX(event, state, canvas);
      const rect = canvas.getBoundingClientRect();
      const startPx = selectionRef.current.startClientX - rect.left;
      const endPx = event.clientX - rect.left;
      setDragSelection({
        startFrame: selectionRef.current.startFrame,
        endFrame: nextFrame,
        left: Math.max(0, Math.min(startPx, endPx)),
        width: Math.abs(endPx - startPx),
      });
      setTooltip(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const localX = (event.clientX - rect.left) * state.ratio;
    const localY = (event.clientY - rect.top) * state.ratio;
    if (
      localX < state.padding.left ||
      localX > state.width - state.padding.right ||
      localY < state.padding.top ||
      localY > state.height - state.padding.bottom
    ) {
      setTooltip(null);
      return;
    }

    const percent = (localX - state.padding.left) / Math.max(1, state.width - state.padding.left - state.padding.right);
    const rawIndex = state.start + Math.round(percent * Math.max(0, state.selectedEnd - state.start));
    const frame = Math.max(state.start, Math.min(state.visibleEnd, rawIndex));
    const entries = state.series.map((item) => ({ name: item.name, color: item.color, value: item.values[frame] }));

    setTooltip({
      left: event.clientX - rect.left + 14,
      top: event.clientY - rect.top + 14,
      frame,
      time: state.x[frame],
      entries,
    });
  }

  function handleMouseDown(event) {
    const state = plotStateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas || !insidePlot(event, state, canvas)) return;
    const startFrame = frameFromClientX(event, state, canvas);
    selectionRef.current = { startFrame, startClientX: event.clientX };
    setTooltip(null);
    setDragSelection({ startFrame, endFrame: startFrame, left: event.clientX - canvas.getBoundingClientRect().left, width: 0 });
  }

  function finishSelection(event) {
    const state = plotStateRef.current;
    const canvas = canvasRef.current;
    const selection = selectionRef.current;
    if (!state || !canvas || !selection) return;
    const endFrame = frameFromClientX(event, state, canvas);
    const frameDistance = Math.abs(endFrame - selection.startFrame);
    const pixelDistance = Math.abs(event.clientX - selection.startClientX);
    selectionRef.current = null;
    setDragSelection(null);
    if (frameDistance >= 3 && pixelDistance >= 8) zoomToFrames(selection.startFrame, endFrame);
  }

  const zoomLabel = zoom ? `Zoomed frames ${zoom.start} - ${zoom.end}` : 'Showing full selected range';
  const hasVisibleContent = Boolean(waveformPoints?.length || series?.length);

  return (
    <article className="plot-card simple-card">
      <div className="section-title-row plot-title-row">
        <h2>{title}</h2>
        <span>{badge}</span>
      </div>
      {topControls ? <div className="plot-local-controls">{topControls}</div> : null}
      <div className="plot-toolbar plot-toolbar-no-legend">
        <div className="zoom-controls" aria-label={`${title} zoom controls`}>
          <button type="button" onClick={() => updateZoom(0.55)}>Zoom in</button>
          <button type="button" onClick={() => updateZoom(1.8)}>Zoom out</button>
          <button type="button" onClick={() => setZoom(null)}>Reset view</button>
        </div>
      </div>
      <div className="zoom-status">{zoomLabel}. Use Zoom in / Zoom out buttons, or drag across a graph portion and release to zoom into that exact selection.</div>
      <div className="canvas-wrap" onMouseLeave={() => setTooltip(null)}>
        <canvas
          ref={canvasRef}
          style={{ minHeight: height }}
          onMouseMove={handleMove}
          onMouseDown={handleMouseDown}
          onMouseUp={finishSelection}
        />
        {dragSelection ? (
          <div
            className="plot-drag-selection"
            style={{ left: dragSelection.left, width: Math.max(2, dragSelection.width) }}
          >
            <span>{Math.min(dragSelection.startFrame, dragSelection.endFrame)} - {Math.max(dragSelection.startFrame, dragSelection.endFrame)}</span>
          </div>
        ) : null}
        {!hasVisibleContent ? (
          <div className="plot-empty-message">No enabled layer for this graph. Turn on a layer using the buttons above this graph.</div>
        ) : null}
        {tooltip ? (
          <div className="plot-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
            <strong>Frame {tooltip.frame}</strong>
            <span>Time: {formatNumber(tooltip.time, 4)} s</span>
            {tooltip.entries.map((entry) => (
              <span key={entry.name}><i style={{ background: entry.color }} />{entry.name}: {formatNumber(entry.value, 5)}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="graph-label-row">
        <span>{xLabel}</span>
        <span>{yLabel}</span>
      </div>
    </article>
  );
}
