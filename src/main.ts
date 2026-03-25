/**
 * Thin entry point — kept only because Vite's rollup config points here.
 *
 * All startup orchestration lives in `src/runtime/bootstrap.ts`.
 */
import './ui/styles/index.css';
import { bootstrap, type BootstrapResult } from './runtime/bootstrap.ts';

// Performance instrumentation — loaded eagerly so window.__useqPerf / __useqBench
// are available in DevTools immediately. No runtime cost when disabled.
import './lib/perfTrace.ts';
import './effects/perfBenchmark.ts';

export { bootstrap as startLegacyApp };
export type { BootstrapResult };

// Main entry point
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
}
