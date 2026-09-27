/**
 * Shared loading-state placeholder for help-panel tabs and other async
 * surfaces. Spinner-free: a subtle pulse that respects reduced-motion
 * preferences, announced politely to assistive technology.
 */

import "./loadingState.css";

export interface LoadingStateProps {
  /** Optional loading label; defaults to "Loading…". */
  label?: string;
  /** Extra class for layout context (e.g. a tab-specific padding rule). */
  class?: string;
}

export function LoadingState(props: LoadingStateProps) {
  return (
    <div
      class={props.class ? `loading-state ${props.class}` : "loading-state"}
      role="status"
      aria-live="polite"
    >
      <span>{props.label ?? "Loading…"}</span>
    </div>
  );
}
