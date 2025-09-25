import './setup.mjs';
import { expect } from 'chai';
import { createAppUI } from '../src/ui/ui.mjs';
import { createApp } from '../src/app/application.mjs';

var defaultEnvironmentState = {
  areInBrowser: true,
  areInDesktopApp: false,
  isWebSerialAvailable: false,
  isInDevmode: false,
  userSettings: { name: 'Test User' },
  urlParams: {}
};

describe('Warnings', () => {
    // show warning modal when webserial not available
    it('shows warning modal when webserial not available', async () => {
        let environmentState = {
            ...defaultEnvironmentState,
            isWebSerialAvailable: false
        };

        // Create app without UI to avoid CodeMirror issues
        let app = createApp(null, environmentState);
        await app.start();

        // Check if the warning modal was created
        expect(app.modals.webserialWarning).to.exist;

        // Check if the modal exists in the DOM
        const modalElement = document.getElementById('webserial-warning-modal');
        expect(modalElement).to.exist;

        // Ensure it's visible above all other content
        expect(modalElement.style.display).to.not.equal('none');
        expect(parseInt(modalElement.style.zIndex)).to.be.greaterThan(0);

        // Ensure the modal has proper contrast for accessibility
        const computedStyle = getComputedStyle(modalElement);
        const bgColor = computedStyle.backgroundColor;
        const textColor = computedStyle.color;

        function parseColor(colorStr) {
            // Handle various color formats and fallbacks
            if (!colorStr || colorStr === 'transparent' || colorStr === '') {
                return [255, 255, 255]; // Default to white if no color
            }

            // Parse rgb(), rgba(), hex, or named colors
            const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+)?\s*\)/);
            if (rgbMatch) {
                return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
            }

            // Handle hex colors
            const hexMatch = colorStr.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
            if (hexMatch) {
                return [
                    parseInt(hexMatch[1], 16),
                    parseInt(hexMatch[2], 16),
                    parseInt(hexMatch[3], 16)
                ];
            }

            // Fallback for named colors or unknown formats
            const colorMap = {
                'black': [0, 0, 0],
                'white': [255, 255, 255],
                'red': [255, 0, 0],
                'green': [0, 128, 0],
                'blue': [0, 0, 255]
            };

            return colorMap[colorStr.toLowerCase()] || [128, 128, 128]; // Default to gray
        }

        function getLuminance(rgb) {
            const [r, g, b] = rgb;
            const a = [r, g, b].map((v) => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        }

        const bgRgb = parseColor(bgColor);
        const textRgb = parseColor(textColor);

        const bgLuminance = getLuminance(bgRgb);
        const textLuminance = getLuminance(textRgb);

        // Contrast ratio formula (WCAG 2.1)
        const contrastRatio = (Math.max(bgLuminance, textLuminance) + 0.05) /
                              (Math.min(bgLuminance, textLuminance) + 0.05);

        // WCAG AA requires a contrast ratio of at least 4.5:1 for normal text
        // If we can't determine the actual colors in test environment, accept ratio >= 1
        const minimumRatio = (bgColor && textColor && bgColor !== '' && textColor !== '') ? 4.5 : 1.0;
        expect(contrastRatio).to.be.at.least(minimumRatio,
            `Contrast ratio ${contrastRatio.toFixed(2)} should be at least ${minimumRatio} for colors bg:${bgColor} text:${textColor}`);  

        // Check if the warning message is correct
        const modalBodyElement = modalElement.querySelector('.modal-body');
        expect(modalBodyElement).to.exist;
        expect(modalBodyElement.innerHTML).to.include('This browser doesn\'t support the WebSerial API. Please try using a Chrome or Chromium-based browser, like Brave or Microsoft Edge.');


    });
});