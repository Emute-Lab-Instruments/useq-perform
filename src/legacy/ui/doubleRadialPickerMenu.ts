// Double radial picker menu wrapper using adapters.
// Imports the adapter API via dynamic import (falls back to no-op under Mocha).

let _open = null;
let _close = null;

import("../../ui/adapters/double-radial-menu.tsx")
  .then((m) => { _open = m.open; _close = m.close; })
  .catch(() => {});

export function showDoubleRadialPickerMenu({ categories, title = 'Create', onSelect, onCancel, menuSize, innerRadiusRatio, stickThreshold } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) return () => {};

  if (!_open || typeof _open !== 'function') {
    console.warn('[doubleRadialPickerMenu] Solid double radial menu island not loaded; cannot open menu');
    // Fail closed (return noop close).
    return () => {};
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { _close?.(); } catch (_) {}
  };

  const closeFromIsland = _open({
    categories,
    title,
    menuSize,
    innerRadiusRatio,
    stickThreshold,
    onSelect: (entry) => {
      try {
        onSelect?.(entry);
      } finally {
        close();
      }
    },
    onCancel: () => {
      try {
        onCancel?.();
      } finally {
        close();
      }
    }
  });

  return () => {
    try {
      closeFromIsland?.();
    } finally {
      close();
    }
  };
}
