export default function ExperimentFlow({ algorithmName, smootherName, activeStep = 0, frameRangeLabel = 'All frames', children }) {
  const steps = [
    {
      title: 'Decode audio',
      body: 'Web Audio API reads the uploaded file and downmixes it into one waveform.',
    },
    {
      title: algorithmName || 'Envelope algorithm',
      body: 'The selected algorithm converts each audio frame into an amplitude value.',
    },
    {
      title: smootherName || 'Smoothing',
      body: 'The selected smoother reduces jitter so the envelope trend is easier to read.',
    },
    {
      title: 'Frame-by-frame plot',
      body: 'The result is revealed inside your selected frame range and can be paused anytime.',
    },
  ];

  return (
    <section className="state-space-visual simple-card">
      <div className="section-title-row">
        <h2>Experiment flow</h2>
        <span>{frameRangeLabel}</span>
      </div>

      <div className="flow-diagram flow-diagram-4">
        {steps.map((step, index) => (
          <div className="flow-step-wrap" key={step.title}>
            <div className={`flow-node ${index === activeStep ? 'active-step' : ''} ${index < activeStep ? 'done-step' : ''}`}>
              <span>Step {index + 1}</span>
              <strong>{step.title}</strong>
              <small>{step.body}</small>
            </div>
            {index < steps.length - 1 ? <div className="flow-arrow" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>

      <div className="equation-strip">
        <div>
          <strong>Selected algorithm</strong>
          <code>{algorithmName || 'Choose an algorithm'}</code>
        </div>
        <div>
          <strong>Core frame formula</strong>
          <code>frame(k) = audio[startFrame + k * hopSize]</code>
        </div>
      </div>

      {children}

      <div className="interpretation-box">
        <p><strong>Conclusion:</strong> This version is now a real comparison lab, not just a static plot. You can run frame-by-frame, zoom any graph, switch algorithms, compare every smoother, compare every algorithm, disable graph layers, and inspect exact values by hovering on the plot.</p>
      </div>
    </section>
  );
}
