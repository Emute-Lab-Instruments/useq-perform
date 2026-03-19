/**
 * Generic factory for creating Solid.js UI adapters with imperative mount APIs.
 *
 * Eliminates repeated boilerplate across adapter modules:
 * - Browser environment check
 * - Mount-once guard
 * - Container element creation/lookup
 * - Solid `render()` call
 * - Optional disposal
 *
 * @example
 * ```ts
 * const { mount, dispose } = createSolidAdapter({
 *   containerId: "my-root",
 *   Component: () => <MyComponent />,
 * });
 * ```
 */
import { render } from "solid-js/web";
import type { JSX } from "solid-js";

export interface SolidAdapterOptions {
  /** DOM id for the container element. Used for lookup and creation. */
  containerId: string;

  /** The Solid component tree to render (a no-arg JSX thunk). */
  Component: () => JSX.Element;

  /**
   * Optional hook to create/locate the container element.
   * When omitted, a plain `<div>` is created and appended to `document.body`.
   */
  ensureRoot?: () => HTMLElement;

  /**
   * Optional CSS properties applied to a freshly-created container.
   * Ignored when `ensureRoot` is provided or the element already exists.
   */
  containerStyle?: Partial<CSSStyleDeclaration>;

  /**
   * Optional callback invoked once after the first mount, receiving the
   * container element. Useful for fire-and-forget side-effects like lazy
   * icon loading.
   */
  onMount?: (container: HTMLElement) => void;
}

export interface SolidAdapterHandle {
  /** Mount the component. Safe to call multiple times; only mounts once. */
  mount(root?: HTMLElement): void;

  /** Dispose the Solid render tree and reset the mount guard. */
  dispose(): void;

  /** Whether the adapter has been mounted. */
  readonly mounted: boolean;
}

function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

/**
 * Create a reusable Solid adapter with mount-once semantics.
 */
export function createSolidAdapter(
  options: SolidAdapterOptions,
): SolidAdapterHandle {
  const { containerId, Component, ensureRoot, containerStyle, onMount: onMountCb } = options;

  let _mounted = false;
  let _disposeFn: (() => void) | undefined;

  function defaultEnsureRoot(): HTMLElement {
    const existing = document.getElementById(containerId);
    if (existing) return existing;

    const el = document.createElement("div");
    el.id = containerId;

    if (containerStyle) {
      Object.assign(el.style, containerStyle);
    }

    document.body.appendChild(el);
    return el;
  }

  function mount(root?: HTMLElement): void {
    if (_mounted) return;
    if (!isBrowser()) return;
    _mounted = true;

    const el = root || (ensureRoot ? ensureRoot() : defaultEnsureRoot());
    _disposeFn = render(Component, el);

    onMountCb?.(el);
  }

  function dispose(): void {
    _disposeFn?.();
    _disposeFn = undefined;
    _mounted = false;
  }

  return {
    mount,
    dispose,
    get mounted() {
      return _mounted;
    },
  };
}
