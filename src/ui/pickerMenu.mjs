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
 * See pickerMenu.css for required styles. Uses native DOM APIs.
 */

import { el } from "../utils/dom.mjs";

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
  document.querySelectorAll('.picker-menu-overlay').forEach(e => e.remove());

  // Overlay
  const overlay = el('div', {class: 'picker-menu-overlay'});
  // Menu
  const menu = el('div', {class: 'picker-menu'});
  if (title) menu.appendChild(el('div', {class: 'picker-menu-title', text: title}));
  const itemsContainer = el('div', {class: `picker-menu-items ${layout === 'vertical' ? 'vertical' : 'grid'}`});

  // Determine initial active index
  let activeIdx = typeof initialIndex === 'number' ? initialIndex : Math.floor(items.length / 2);
  activeIdx = Math.max(0, Math.min(items.length - 1, activeIdx));

  // Render items
  items.forEach((item, i) => {
    const it = el('div', {
      class: 'picker-menu-item' + (i === activeIdx ? ' active' : ''),
      tabindex: 0,
      html: item.icon ? `<i class="lucide" data-lucide="${item.icon}"></i> ${item.label}` : item.label
    });
    it.addEventListener('click', e => {
      e.stopPropagation();
      selectItem(i);
    });
    it.addEventListener('mouseenter', () => setActive(i));
    itemsContainer.appendChild(it);
  });
  menu.appendChild(itemsContainer);
  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  // Fade in
  setTimeout(() => {
    overlay.classList.add('visible');
    menu.classList.add('visible');
    if (window.lucide) window.lucide.createIcons();
    focusActive();
  }, 10);


  // Keyboard/gamepad navigation
  function getItemChildren() {
    return Array.from(itemsContainer.children);
  }
  function focusActive() {
    const children = getItemChildren();
    if (children[activeIdx]) children[activeIdx].focus();
  }
  function setActive(idx) {
    const children = getItemChildren();
    children.forEach(c => c.classList.remove('active'));
    if (children[idx]) children[idx].classList.add('active');
    activeIdx = idx;
    focusActive();
  }
  function selectItem(idx) {
    if (onSelect) onSelect(items[idx], idx);
    closeMenu();
  }
  function closeMenu() {
    overlay.classList.remove('visible');
    menu.classList.remove('visible');
    setTimeout(() => overlay.remove(), 180);
    window.removeEventListener('keydown', keydownHandler);
    window.removeEventListener('gamepadpickerinput', handleGamepadInput);
    document.body.style.overflow = '';
  }

  // Gamepad navigation event handler
  function handleGamepadInput(e) {
    if (!Array.isArray(items) || items.length === 0) return;
    const { direction, action } = e.detail || {};

    if (layout === 'grid') {
      const numColumns = 3;
      const numRows = Math.ceil(items.length / numColumns);
      const currentRow = Math.floor(activeIdx / numColumns);
      const currentCol = activeIdx % numColumns;
      let newRow = currentRow;
      let newCol = currentCol;

      if (direction === 'left') {
        const maxColInRow = Math.min(numColumns, items.length - (currentRow * numColumns)) - 1;
        newCol = (currentCol < maxColInRow) ? currentCol + 1 : 0;
      } else if (direction === 'right') {
        newCol = (currentCol > 0) ? currentCol - 1 : numColumns - 1;
        if (newRow * numColumns + newCol >= items.length) {
          newCol = items.length - 1 - (newRow * numColumns);
        }
      } else if (direction === 'up') {
        newRow = (currentRow < numRows - 1) ? currentRow + 1 : 0;
        if (newRow * numColumns + currentCol >= items.length) {
          newRow = 0;
        }
        newCol = currentCol;
      } else if (direction === 'down') {
        let found = false;
        let tries = 0;
        do {
          newRow = (newRow > 0) ? newRow - 1 : numRows - 1;
          tries++;
          if (newRow * numColumns + currentCol < items.length) {
            found = true;
          }
        } while (!found && tries < numRows);
        newCol = currentCol;
      }

      let newIdx = newRow * numColumns + newCol;
      if (newIdx >= items.length) newIdx = items.length - 1;
      else if (newIdx < 0) newIdx = 0;
      if (newIdx !== activeIdx) setActive(newIdx);
    } else {
      if (direction === 'left' || direction === 'up') {
        setActive((activeIdx + 1) % items.length);
      } else if (direction === 'right' || direction === 'down') {
        setActive((activeIdx - 1 + items.length) % items.length);
      }
    }

    if (action === 'select') selectItem(activeIdx);
    else if (action === 'cancel') closeMenu();
  }
  window.addEventListener('gamepadpickerinput', handleGamepadInput);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeMenu();
  });

  function keydownHandler(e) {
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'Enter' || e.key === ' ') {
      selectItem(activeIdx);
    } else if (layout === 'grid') {
      const numColumns = 3;
      const numRows = Math.ceil(items.length / numColumns);
      const currentRow = Math.floor(activeIdx / numColumns);
      const currentCol = activeIdx % numColumns;
      let newRow = currentRow;
      let newCol = currentCol;

      if (e.key === 'ArrowLeft') {
        const maxColInRow = Math.min(numColumns, items.length - (currentRow * numColumns)) - 1;
        newCol = (currentCol < maxColInRow) ? currentCol + 1 : 0;
      } else if (e.key === 'ArrowRight') {
        newCol = (currentCol > 0) ? currentCol - 1 : numColumns - 1;
        if (newRow * numColumns + newCol >= items.length) {
          newCol = items.length - 1 - (newRow * numColumns);
        }
      } else if (e.key === 'ArrowUp') {
        newRow = (currentRow < numRows - 1) ? currentRow + 1 : 0;
        if (newRow * numColumns + currentCol >= items.length) newRow = 0;
        newCol = currentCol;
      } else if (e.key === 'ArrowDown') {
        newRow = (currentRow > 0) ? currentRow - 1 : numRows - 1;
        if (newRow * numColumns + currentCol >= items.length) {
          newRow = numRows - 1;
          if (newRow * numColumns + currentCol >= items.length) {
            newRow = Math.floor((items.length - 1) / numColumns);
          }
        }
        newCol = currentCol;
      }

      let newIdx = newRow * numColumns + newCol;
      if (newIdx >= items.length) newIdx = items.length - 1;
      else if (newIdx < 0) newIdx = 0;
      setActive(newIdx);
    } else {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setActive((activeIdx + 1) % items.length);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setActive((activeIdx - 1 + items.length) % items.length);
      }
    }
  }
  window.addEventListener('keydown', keydownHandler);

  // Prevent scroll on body
  document.body.style.overflow = 'hidden';

  return closeMenu;
}

/**
 * Show a number picker menu pop-up. Returns a function to close the menu.
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
  document.querySelectorAll('.picker-menu-overlay').forEach(e => e.remove());

  const overlay = el('div', {class: 'picker-menu-overlay'});
  const menu = el('div', {class: 'picker-menu number-picker-menu'});
  if (title) menu.appendChild(el('div', {class: 'picker-menu-title', text: title}));

  let value = typeof initialValue === 'number' ? initialValue : 0;
  value = Math.max(min, Math.min(max, value));

  const inputRow = el('div', {class: 'number-picker-row'});
  const decr = el('button', {class: 'number-picker-btn', text: '\u2212', tabindex: 0});
  const input = el('input', {class: 'number-picker-input', type: 'number', value: value, min: min, max: max, step: step, tabindex: 0});
  const incr = el('button', {class: 'number-picker-btn', text: '+', tabindex: 0});
  inputRow.appendChild(decr);
  inputRow.appendChild(input);
  inputRow.appendChild(incr);

  const actions = el('div', {class: 'number-picker-actions'});
  const ok = el('button', {class: 'picker-menu-action', text: 'OK', tabindex: 0});
  const cancel = el('button', {class: 'picker-menu-action', text: 'Cancel', tabindex: 0});
  actions.appendChild(ok);
  actions.appendChild(cancel);

  menu.appendChild(inputRow);
  menu.appendChild(actions);
  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('visible');
    menu.classList.add('visible');
    input.focus();
  }, 10);

  function setValue(newVal) {
    value = Math.max(min, Math.min(max, Number(newVal) || 0));
    input.value = value;
  }

  function confirm() {
    if (onSelect) onSelect(value);
    closeMenu();
  }
  function closeMenu() {
    overlay.classList.remove('visible');
    menu.classList.remove('visible');
    setTimeout(() => overlay.remove(), 180);
    window.removeEventListener('keydown', keydownHandler);
    window.removeEventListener('gamepadpickerinput', handleGamepadInput);
    document.body.style.overflow = '';
  }

  decr.addEventListener('click', () => setValue(value - step));
  incr.addEventListener('click', () => setValue(value + step));
  input.addEventListener('input', () => setValue(input.value));
  ok.addEventListener('click', confirm);
  cancel.addEventListener('click', closeMenu);

  function keydownHandler(e) {
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'Enter') confirm();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setValue(value - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setValue(value + step);
  }
  window.addEventListener('keydown', keydownHandler);

  function handleGamepadInput(e) {
    const { direction, action } = e.detail || {};
    if (direction === 'left' || direction === 'down') setValue(value - step);
    else if (direction === 'right' || direction === 'up') setValue(value + step);
    else if (action === 'select') confirm();
    else if (action === 'cancel') closeMenu();
  }
  window.addEventListener('gamepadpickerinput', handleGamepadInput);

  document.body.style.overflow = 'hidden';

  return closeMenu;
}
