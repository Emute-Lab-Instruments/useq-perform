/**
 * pickerMenu.mjs
 *
 * This module provides a reusable, theme-aware pop-up picker menu for the app UI.
 *
 * Usage:
 *   - Import and call `showPickerMenu(options)` to display a centered picker menu with a dark overlay.
 *   - The menu supports both grid and vertical layouts (default: grid).
 *   - The active selection is visually distinct and uses the theme accent color.
 *   - The menu fades in/out and blocks background interaction while open.
 *   - Use for any modal selection, quick-pick, or command palette UI.
 *
 * To use:
 *   1. Call `showPickerMenu({
 *        title: 'Pick an option',
 *        items: [ ... ],
 *        layout: 'grid' | 'vertical',
 *        onSelect: (item, index) => { ... },
 *        ...
 *      })`.
 *   2. The menu will handle keyboard navigation, focus, and closing.
 *   3. Only one picker menu can be open at a time.
 *
 * See pickerMenu.css for required styles. Uses jQuery for DOM manipulation and events.
 */
// pickerMenu.mjs: jQuery-based pop-up picker menu with overlay
// Usage: call showPickerMenu({items, onSelect, title, layout, initialIndex})

/**
 * Show a picker menu pop-up. Returns a function to close the menu.
 * @param {Object} opts
 * @param {Array} opts.items - Array of {label, value, icon?}
 * @param {Function} opts.onSelect - Called with (item, index) when selected
 * @param {string} [opts.title] - Optional title
 * @param {string} [opts.layout] - 'grid' or 'vertical' (default: 'grid')
 * @param {number} [opts.initialIndex] - Index of initially active item (default: middle)
 * @returns {Function} closeMenu - Call to close the menu
 */
export function showPickerMenu({items, onSelect, title = '', layout = 'grid', initialIndex} = {}) {
  if (!Array.isArray(items) || items.length === 0) return () => {};
  // Remove any existing picker
  $(document.body).find('.picker-menu-overlay').remove();

  // Overlay
  const $overlay = $('<div>', {class: 'picker-menu-overlay'});
  // Menu
  const $menu = $('<div>', {class: 'picker-menu'});
  if (title) $menu.append($('<div>', {class: 'picker-menu-title', text: title}));
  const $items = $('<div>', {class: `picker-menu-items ${layout === 'vertical' ? 'vertical' : 'grid'}`});

  // Determine initial active index
  let activeIdx = typeof initialIndex === 'number' ? initialIndex : Math.floor(items.length / 2);
  activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx));

  // Render items
  items.forEach((item, i) => {
    const $it = $('<div>', {
      class: 'picker-menu-item' + (i === activeIdx ? ' active' : ''),
      tabindex: 0,
      html: item.icon ? `<i class="lucide" data-lucide="${item.icon}"></i> ${item.label}` : item.label
    });
    $it.on('click', e => {
      e.stopPropagation();
      selectItem(i);
    });
    $it.on('mouseenter', () => setActive(i));
    $items.append($it);
  });
  $menu.append($items);
  $overlay.append($menu);
  $(document.body).append($overlay);

  // Fade in
  setTimeout(() => {
    $overlay.addClass('visible');
    $menu.addClass('visible');
    if (window.lucide) window.lucide.createIcons();
    focusActive();
  }, 10);


  // Keyboard/gamepad navigation
  function focusActive() {
    $items.children().eq(activeIdx).focus();
  }
  function setActive(idx) {
    $items.children().removeClass('active');
    $items.children().eq(idx).addClass('active');
    activeIdx = idx;
    focusActive();
  }
  function selectItem(idx) {
    if (onSelect) onSelect(items[idx], idx);
    closeMenu();
  }
  function closeMenu() {
    $overlay.removeClass('visible');
    $menu.removeClass('visible');
    setTimeout(() => $overlay.remove(), 180);
    $(window).off('keydown.pickerMenu');
    window.removeEventListener('gamepadpickerinput', handleGamepadInput);
  }

  // Gamepad navigation event handler
  function handleGamepadInput(e) {
    if (!Array.isArray(items) || items.length === 0) return;
    const { direction, action } = e.detail || {};
    if (direction === 'left' || direction === 'up') {
      setActive((activeIdx - 1 + items.length) % items.length);
    } else if (direction === 'right' || direction === 'down') {
      setActive((activeIdx + 1) % items.length);
    } else if (action === 'select') {
      selectItem(activeIdx);
    } else if (action === 'cancel') {
      closeMenu();
    }
  }
  window.addEventListener('gamepadpickerinput', handleGamepadInput);

  $overlay.on('click', e => {
    if (e.target === $overlay[0]) closeMenu();
  });

  $(window).on('keydown.pickerMenu', e => {
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      setActive((activeIdx - 1 + items.length) % items.length);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      setActive((activeIdx + 1) % items.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      selectItem(activeIdx);
    }
  });

  // Prevent scroll on body
  document.body.style.overflow = 'hidden';
  $overlay.on('remove', () => {
    document.body.style.overflow = '';
  });

  return closeMenu;
}

/**
 * Show a number picker menu pop-up. Returns a function to close the menu.
 * @param {Object} opts
 * @param {Function} opts.onSelect - Called with (numberValue) when selected
 * @param {string} [opts.title] - Optional title
 * @param {number} [opts.initialValue] - Initial value (default: 0)
 * @param {number} [opts.min] - Minimum allowed value (default: -Infinity)
 * @param {number} [opts.max] - Maximum allowed value (default: +Infinity)
 * @param {number} [opts.step] - Step size for increment/decrement (default: 1)
 * @returns {Function} closeMenu - Call to close the menu
 */
export function showNumberPickerMenu({
  onSelect,
  title = 'Pick a number',
  initialValue = 0,
  min = -Infinity,
  max = Infinity,
  step = 1
} = {}) {
  // Remove any existing picker
  $(document.body).find('.picker-menu-overlay').remove();

  // Overlay
  const $overlay = $('<div>', {class: 'picker-menu-overlay'});
  // Menu
  const $menu = $('<div>', {class: 'picker-menu number-picker-menu'});
  if (title) $menu.append($('<div>', {class: 'picker-menu-title', text: title}));

  // Number input UI
  let value = typeof initialValue === 'number' ? initialValue : 0;
  value = Math.max(min, Math.min(max, value));

  const $inputRow = $('<div>', {class: 'number-picker-row'});
  const $decr = $('<button>', {class: 'number-picker-btn', text: '−', tabindex: 0});
  const $input = $('<input>', {
    class: 'number-picker-input',
    type: 'number',
    value: value,
    min: min,
    max: max,
    step: step,
    tabindex: 0
  });
  const $incr = $('<button>', {class: 'number-picker-btn', text: '+', tabindex: 0});
  $inputRow.append($decr, $input, $incr);

  // Confirm/cancel buttons
  const $actions = $('<div>', {class: 'number-picker-actions'});
  const $ok = $('<button>', {class: 'picker-menu-action', text: 'OK', tabindex: 0});
  const $cancel = $('<button>', {class: 'picker-menu-action', text: 'Cancel', tabindex: 0});
  $actions.append($ok, $cancel);

  $menu.append($inputRow, $actions);
  $overlay.append($menu);
  $(document.body).append($overlay);

  // Fade in
  setTimeout(() => {
    $overlay.addClass('visible');
    $menu.addClass('visible');
    $input.focus();
  }, 10);

  function setValue(newVal) {
    value = Math.max(min, Math.min(max, Number(newVal) || 0));
    $input.val(value);
  }

  function confirm() {
    if (onSelect) onSelect(value);
    closeMenu();
  }
  function closeMenu() {
    $overlay.removeClass('visible');
    $menu.removeClass('visible');
    setTimeout(() => $overlay.remove(), 180);
    $(window).off('keydown.numberPickerMenu');
    window.removeEventListener('gamepadpickerinput', handleGamepadInput);
  }

  $decr.on('click', () => setValue(value - step));
  $incr.on('click', () => setValue(value + step));
  $input.on('input', () => setValue($input.val()));
  $ok.on('click', confirm);
  $cancel.on('click', closeMenu);

  // Keyboard/gamepad navigation
  $(window).on('keydown.numberPickerMenu', e => {
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'Enter') confirm();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setValue(value - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setValue(value + step);
  });

  // Gamepad navigation event handler
  function handleGamepadInput(e) {
    const { direction, action } = e.detail || {};
    if (direction === 'left' || direction === 'down') setValue(value - step);
    else if (direction === 'right' || direction === 'up') setValue(value + step);
    else if (action === 'select') confirm();
    else if (action === 'cancel') closeMenu();
  }
  window.addEventListener('gamepadpickerinput', handleGamepadInput);

  // Prevent scroll on body
  document.body.style.overflow = 'hidden';
  $overlay.on('remove', () => {
    document.body.style.overflow = '';
  });

  return closeMenu;
}
