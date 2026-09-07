/**
 * Operating pods.
 *
 * Every figure in this app currently comes from Pod 1 — the imports carry no
 * pod of their own, so there is nothing to partition by yet. The selector
 * exists so that is stated on screen rather than assumed: a reader looking at
 * the numbers should be able to see whose they are.
 *
 * Pods that are not yet in service are listed and disabled rather than hidden,
 * because the fact that they are planned is itself information.
 *
 * When a second pod goes live, three things change together and none of them
 * should be done alone:
 *
 *   1. Flip `available` here.
 *   2. Give the data a pod: a `pod_id` on `reports` and `client_accounts`, set
 *      at import, defaulting existing rows to pod 1.
 *   3. Filter on it — the selector writes `?pod=` and the page reads it, the
 *      way the dashboard's period and customer filters already work.
 *
 * Flipping only the first would produce a control that silently shows Pod 1's
 * numbers under another pod's name, which is worse than no control at all.
 */

export interface Pod {
  id: string;
  label: string;
  /** False until the pod is operating and its data is being imported. */
  available: boolean;
}

export const PODS: readonly Pod[] = [
  { id: 'pod-1', label: 'Pod 1', available: true },
  { id: 'pod-2', label: 'Pod 2', available: false },
  { id: 'pod-3', label: 'Pod 3', available: false },
];

/** The pod every figure currently belongs to. */
export const DEFAULT_POD_ID = 'pod-1';

export function activePods(): Pod[] {
  return PODS.filter((p) => p.available);
}

/**
 * Resolve a requested pod id to one that can actually be shown.
 *
 * An unknown or not-yet-live id falls back to the default rather than
 * rendering an empty page: there is no data behind those ids to render.
 */
export function resolvePod(requested?: string | null): Pod {
  const match = PODS.find((p) => p.id === requested && p.available);
  return match ?? PODS.find((p) => p.id === DEFAULT_POD_ID)!;
}
