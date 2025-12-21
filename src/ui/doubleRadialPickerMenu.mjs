// Solid-backed double radial picker menu wrapper.
// This bridges the legacy (esbuild) app code to the Solid island global API.

export function showDoubleRadialPickerMenu({ categories, title = 'Create', onSelect, onCancel, menuSize, innerRadiusRatio, stickThreshold } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) return () => {};

  const api = typeof window !== 'undefined' ? window.__doubleRadialMenu : null;
  if (!api || typeof api.open !== 'function') {
    console.warn('[doubleRadialPickerMenu] Solid double radial menu island not loaded; cannot open menu');
    // Fail closed (return noop close).
    return () => {};
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { api.close?.(); } catch (_) {}
  };

  const closeFromIsland = api.open({
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


