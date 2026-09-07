import { PODS, resolvePod } from '@/lib/pods';

/**
 * Which pod's figures are on screen.
 *
 * Rendered as a real select so the planned pods are visible and obviously not
 * yet selectable, rather than a label that hides what is coming. Disabled
 * options are the browser's own convention for "listed but unavailable", which
 * screen readers announce without any extra markup.
 *
 * No handler: with one pod live there is nothing to switch to, and a control
 * that appeared to filter while changing nothing would misrepresent the data.
 * The wiring goes in alongside the pod column — see lib/pods.ts.
 */
export function PodSelector({ podId }: { podId?: string }) {
  const active = resolvePod(podId);
  const pending = PODS.filter((p) => !p.available).length;

  return (
    <div className="pod-selector">
      <label className="pod-label" htmlFor="pod">
        Pod
      </label>
      <select
        id="pod"
        className="select"
        defaultValue={active.id}
        disabled
        title={
          pending > 0
            ? `${pending} further pod${pending === 1 ? '' : 's'} planned. All figures shown are ${active.label}.`
            : undefined
        }
        // `defaultValue` rather than `value`: a disabled select needs no change
        // handler, and React warns about a controlled input without one.
      >
        {PODS.map((pod) => (
          <option key={pod.id} value={pod.id} disabled={!pod.available}>
            {pod.label}
            {pod.available ? '' : ' — not yet in service'}
          </option>
        ))}
      </select>
    </div>
  );
}
