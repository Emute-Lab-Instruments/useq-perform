/**
 * Simple modal system
 */

export function createModal(id, title, content) {
  // Create modal elements
  const $overlay = $('<div>')
    .addClass('modal-overlay')
    .attr('id', id + '-overlay');

  const $modal = $('<div>')
    .addClass('modal')
    .attr('id', id);

  const $header = $('<div>')
    .addClass('modal-header');

  const $title = $('<h3>')
    .addClass('modal-title')
    .text(title);

  const $closeBtn = $('<button>')
    .addClass('modal-close')
    .text('×')
    .on('click', () => closeModal(id));

  const $body = $('<div>')
    .addClass('modal-body')
    .html(content);

  // Assemble modal
  $header.append($title, $closeBtn);
  $modal.append($header, $body);

  // Close on overlay click
  $overlay.on('click', (e) => {
    if (e.target === $overlay[0]) {
      closeModal(id);
    }
  });

  // Close on escape key
  $(document).on('keydown.modal-' + id, (e) => {
    if (e.key === 'Escape') {
      closeModal(id);
    }
  });

  return { $overlay, $modal };
}

export function showModal(id, title, content) {
  // Remove existing modal if present
  closeModal(id);

  // Create actual DOM elements for testing
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = id + '-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = id;

  // Inherit theme from document root
  const rootClasses = document.documentElement.className;
  if (rootClasses.includes('cm-theme-light')) {
    modal.classList.add('cm-theme-light');
  } else if (rootClasses.includes('cm-theme-dark')) {
    modal.classList.add('cm-theme-dark');
  }

  const header = document.createElement('div');
  header.className = 'modal-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'modal-title';
  titleEl.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => closeModal(id);

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.innerHTML = content;

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  modal.appendChild(header);
  modal.appendChild(body);

  // Add to DOM
  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  // Make modal visible (override CSS display: none)
  overlay.style.display = 'block';
  overlay.style.zIndex = '1000';
  modal.style.display = 'block';
  modal.style.zIndex = '1001';

  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal(id);
    }
  };

  // Close on escape key
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal(id);
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);

  // Return jQuery-like object for compatibility
  return $(modal);
}

export function closeModal(id) {
  const overlay = document.getElementById(id + '-overlay');
  const modal = document.getElementById(id);

  if (modal) {
    modal.remove();
  }

  if (overlay) {
    overlay.remove();
  }
}