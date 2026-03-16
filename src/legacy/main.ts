/**
 * Thin entry point — kept only because Vite's rollup config points here.
 *
 * All startup orchestration lives in `src/runtime/bootstrap.ts`.
 */
import './styles/index.css';
import { bootstrap, type BootstrapResult } from '../runtime/bootstrap.ts';

export { bootstrap as startLegacyApp };
export type { BootstrapResult };

// Main entry point
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
}
