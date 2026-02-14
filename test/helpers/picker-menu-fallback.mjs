let activeClose = null;

function removeActive() {
  if (activeClose) {
    activeClose();
    activeClose = null;
  }
}

function makeOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'picker-menu-overlay visible';
  document.body.appendChild(overlay);
  return overlay;
}

function bindGamepad(handler) {
  const listener = (event) => handler(event.detail?.action);
  window.addEventListener('gamepadpickerinput', listener);
  return () => window.removeEventListener('gamepadpickerinput', listener);
}

export function showPickerMenu({ items = [], onSelect, initialIndex = 0 } = {}) {
  removeActive();
  const overlay = makeOverlay();
  let activeIndex = Math.max(0, Math.min(initialIndex, Math.max(items.length - 1, 0)));

  const unbind = bindGamepad((action) => {
    if (!items.length) return;
    if (action === 'left' || action === 'up') {
      activeIndex = (activeIndex - 1 + items.length) % items.length;
    } else if (action === 'right' || action === 'down') {
      activeIndex = (activeIndex + 1) % items.length;
    } else if (action === 'select') {
      const item = items[activeIndex];
      onSelect?.(item);
      close();
    } else if (action === 'back') {
      close();
    }
  });

  function close() {
    unbind();
    overlay.remove();
    if (activeClose === close) activeClose = null;
  }

  activeClose = close;
  return close;
}

export function showNumberPickerMenu({ initial = 1, onSelect } = {}) {
  removeActive();
  const overlay = makeOverlay();
  const unbind = bindGamepad((action) => {
    if (action === 'select') {
      onSelect?.(initial);
      close();
    } else if (action === 'back') {
      close();
    }
  });

  function close() {
    unbind();
    overlay.remove();
    if (activeClose === close) activeClose = null;
  }

  activeClose = close;
  return close;
}

export function showHierarchicalGridPicker({ categories = [], onSelect } = {}) {
  removeActive();
  const overlay = makeOverlay();
  let level = 'categories';
  let categoryIndex = 0;
  let itemIndex = 0;

  const unbind = bindGamepad((action) => {
    if (!categories.length) return;
    if (action === 'select') {
      if (level === 'categories') {
        level = 'items';
        itemIndex = 0;
        return;
      }
      const selected = categories[categoryIndex]?.items?.[itemIndex];
      onSelect?.(selected);
      close();
      return;
    }

    if (action === 'back') {
      if (level === 'items') {
        level = 'categories';
        return;
      }
      close();
      return;
    }

    if (level === 'categories') {
      if (action === 'left' || action === 'up') {
        categoryIndex = (categoryIndex - 1 + categories.length) % categories.length;
      } else if (action === 'right' || action === 'down') {
        categoryIndex = (categoryIndex + 1) % categories.length;
      }
      return;
    }

    const items = categories[categoryIndex]?.items ?? [];
    if (!items.length) return;
    if (action === 'left' || action === 'up') {
      itemIndex = (itemIndex - 1 + items.length) % items.length;
    } else if (action === 'right' || action === 'down') {
      itemIndex = (itemIndex + 1) % items.length;
    }
  });

  function close() {
    unbind();
    overlay.remove();
    if (activeClose === close) activeClose = null;
  }

  activeClose = close;
  return close;
}
