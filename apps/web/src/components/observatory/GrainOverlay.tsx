/**
 * Film-grain texture over the whole viewport.
 *
 * Always mounted, but inert in the light theme: `--obs-noise-opacity` is 0
 * there, so it costs one empty fixed div and nothing else.
 */
export function GrainOverlay() {
  return <div className="obs-grain" aria-hidden="true" />;
}
