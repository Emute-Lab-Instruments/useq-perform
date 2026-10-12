/**
 * Thin entry point — kept only because Vite's rollup config points here.
 *
 * All startup orchestration lives in `src/runtime/bootstrap.ts`.
 */
import './ui/styles/index.css';
import { bootstrap, type BootstrapResult } from './runtime/bootstrap.ts';
import { reportBootstrapFailure } from './runtime/runtimeDiagnostics.ts';
import { showBootstrapRecovery } from './runtime/bootstrapRecoverySurface.ts';
import { bootstrapFailure as bootstrapFailureChannel } from './contracts/runtimeChannels.ts';

export { bootstrap };
export type { BootstrapResult };

export function handleBootstrapFailure(error: unknown): void {
  reportBootstrapFailure('bootstrap', error);
}

// Main entry point
if (typeof document !== 'undefined') {
  let activeApp: BootstrapResult['app'] | null = null;
  const unsubscribeBootstrapFailure = bootstrapFailureChannel.subscribe((failure) => {
    showBootstrapRecovery({
      id: `failure-${failure.scope}`,
      title: `Startup issue: ${failure.scope}`,
      message: failure.scope === 'bootstrap'
        ? 'The application could not finish starting. Reload the page to try again.'
        : 'The editor remains available, but part of startup did not complete.',
      detail: failure.message,
    });
  });
  // Readiness signal for headless / agent-driven profiling — DEV only.
  // Resolves once bootstrap finishes (WASM port loaded, UI mounted, app
  // started).  An agent can `await window.__useqReady` before driving
  // the app, instead of polling for `__useqPerf` or guessing.
  let signalReady: (() => void) | null = null;
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    (window as unknown as { __useqReady: Promise<void> }).__useqReady =
      new Promise<void>((resolve) => { signalReady = resolve; });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Performance instrumentation — DEV ONLY.  Vite substitutes
    // `import.meta.env.DEV` with the literal `false` in production builds
    // and Rollup eliminates the entire branch, so neither perfTrace nor
    // perfBenchmark ships.  Awaited so `window.__useqPerf` and
    // `window.__useqBench` are guaranteed installed before the app boots
    // and DevTools can call them immediately.
    try {
      if (import.meta.env.DEV) {
        await Promise.all([
          import('./lib/perfTrace.ts'),
          import('./effects/perfBenchmark.ts'),
        ]);
      }

      const { isZenRoute, mountZenMode } = await import('./zen/index.tsx');
      if (isZenRoute()) {
        mountZenMode();
        return;
      }
      activeApp = (await bootstrap()).app;
    } catch (error) {
      handleBootstrapFailure(error);
    } finally {
      if (import.meta.env.DEV) signalReady?.();
    }
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(async () => {
      unsubscribeBootstrapFailure();
      await activeApp?.stop();
      activeApp = null;
    });
  }
}
