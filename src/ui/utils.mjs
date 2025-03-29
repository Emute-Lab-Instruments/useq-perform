/**
 * Check if a panel element is visible using thorough visibility checks
 * @param {HTMLElement} element - The panel element to check
 * @returns {boolean} - Whether the panel is visible
 */
export function isPanelVisible(element) {
    const computedStyle = window.getComputedStyle(element);
    return computedStyle.display !== 'none' && 
           (parseFloat(computedStyle.opacity) > 0 || 
            element.classList.contains('is-opening'));
}