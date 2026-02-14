/**
 * DOM utility functions to replace jQuery patterns.
 *
 * el('div', { class: 'foo', text: 'bar' })  -- creates an element
 * el('div', { class: 'foo', html: '<b>x</b>' })
 * el('input', { type: 'text', value: 'hi' })
 */

/**
 * Create a DOM element with optional attributes and content.
 * Supports: class, id, text, html, tabindex, and any standard attribute.
 * Returns a plain HTMLElement (not a jQuery wrapper).
 */
export function el(tag, opts = {}) {
  const elem = document.createElement(tag);

  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined || value === null) continue;

    switch (key) {
      case 'class':
        elem.className = String(value);
        break;
      case 'text':
        elem.textContent = String(value);
        break;
      case 'html':
        elem.innerHTML = String(value);
        break;
      case 'tabindex':
        elem.setAttribute('tabindex', String(value));
        break;
      default:
        // Handle boolean attributes like checked, disabled
        if (typeof value === 'boolean') {
          if (value) elem.setAttribute(key, '');
          // if false, don't set
        } else {
          elem.setAttribute(key, String(value));
        }
        break;
    }
  }

  return elem;
}

/**
 * Set multiple CSS properties on an element.
 */
export function css(elem, styles) {
  if (!elem) return;
  for (const [prop, value] of Object.entries(styles)) {
    elem.style[prop] = value;
  }
}

/**
 * Hide all elements matching a selector.
 */
export function hideAll(selector) {
  document.querySelectorAll(selector).forEach(e => e.style.display = 'none');
}

/**
 * Append multiple children to a parent element.
 * Children can be strings (converted to text nodes) or elements.
 */
export function appendChildren(parent, ...children) {
  for (const child of children) {
    if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else if (child) {
      parent.appendChild(child);
    }
  }
  return parent;
}
