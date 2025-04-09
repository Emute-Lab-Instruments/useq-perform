import { post } from '../io/console.mjs';
import { dbg } from '../utils.mjs';
import { enterBootloaderMode } from '../io/serialComms.mjs';


export function showUpdateNotification(currentVersion, latestVersion, releaseUrl, currentFirmwareVersion = "Unknown") {
    // Create update notification panel
    const $updatePanel = createNotificationPanel(currentVersion, latestVersion);
    
    // Add to the body and apply fade-in animation
    $('body').append($updatePanel);
    $updatePanel.hide().fadeIn(300);
}

function createNotificationPanel(currentVersion, latestVersion) {
     // Create panel elements
    const $updatePanel = createPanelElement();
    const $panelContent = createPanelContent();
    const $title = createPanelTitle('Firmware Update Available');
    const $description = createUpdateDescription(currentVersion, latestVersion);
    const $buttonsContainer = createButtonsContainer();
    
    // Create action buttons
    const $updateButton = createUpdateButton(latestVersion, $updatePanel);
    const $remindLaterButton = createRemindLaterButton($updatePanel);
    
    // Assemble the panel
    $buttonsContainer.append($updateButton, $remindLaterButton);
    $panelContent.append($title, $description, $buttonsContainer);
    $updatePanel.append($panelContent);
    
    return $updatePanel;
}



function createPanelElement() {
    return $('<div>', {
        id: 'update-notification-panel',
        class: 'panel-aux update-notification',
        css: {
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '450px',
            height: 'auto',
            maxWidth: '80%',
            padding: '20px',
            zIndex: 1000,
            backgroundColor: 'var(--panel-bg)',
            borderRadius: 'var(--panel-border-radius)',
            border: '1px solid var(--accent-color)'
        }
    });
}

function createPanelContent() {
    return $('<div>', {
        class: 'panel-section',
        css: {
            backgroundColor: 'var(--panel-section-bg)'
        }
    });
}

function createPanelTitle(titleText) {
    return $('<div>', {
        class: 'panel-section-title',
        text: titleText,
        css: {
            fontSize: '1.2rem',
            fontWeight: 'bold',
            color: 'var(--accent-color)',
            marginBottom: '15px'
        }
    });
}

function createUpdateDescription(currentVersion, latestVersion) {
    return $('<div>', {
        class: 'update-description',
        html: `A new firmware update is available! 
            <div class="version-comparison">v${currentVersion} → <span style="color:var(--accent-color)">v${latestVersion}</span></div>
            <p>uSEQ is updated frequently with new features and bug fixes, so we highly recommend all users update their firmware whenever a new version is out.</p>
            <p>Would you like to update now? It will only take a moment.</p>`
    });
}

function createButtonsContainer() {
    return $('<div>', {
        class: 'update-buttons',
        css: {
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '20px',
            gap: '10px'
        }
    });
}

function createUpdateButton(latestVersion, $updatePanel) {
    return $('<button>', {
        class: 'panel-button primary',
        text: 'Yes, update now',
        css: {
            backgroundColor: 'var(--accent-color)',
            color: '#000',
            flex: '1',
            border: 'none',
            borderRadius: '4px',
            padding: '10px',
            fontWeight: 'bold',
            cursor: 'pointer'
        }
    }).on('click', function() {
-        $updatePanel.remove();
        startUpgradeFlow(latestVersion);
    });
}

function createRemindLaterButton($updatePanel) {
    return $('<button>', {
        class: 'panel-button',
        text: 'No, remind me later',
        css: {
            backgroundColor: 'var(--panel-control-bg)',
            color: 'var(--text-primary)',
            border: 'none',
            borderRadius: '4px',
            padding: '10px',
            flex: '1',
            cursor: 'pointer'
        }
    }).on('click', function() {
        $updatePanel.remove();
    });
}

export async function startUpgradeFlow(latestVersion) {
    const $guidePanel = createUpgradeGuidePanel();
    showUpgradeGuidePanel($guidePanel);
    
    try {
        // Get the release info to find the filename
        const releaseData = await fetchLatestRelease();
        const assets = releaseData.assets || [];
        const uf2File = findUF2Asset(assets);
        
        if (!uf2File) {
            throw new Error('Could not find UF2 file in the latest release');
        }
        
        // Construct direct download URL from our server
        const directUrl = `https://www.emutelabinstruments.co.uk/firmware/binaries/${uf2File.name}`;
        const blob = await downloadFirmwareFromServer(directUrl, uf2File.name);
        
        markStepComplete($guidePanel, 1);
        // post('Firmware downloaded successfully');
        
        await enterBootloaderMode();
        markStepComplete($guidePanel, 2);
        // post('Device in bootloader mode');
        
        // Add save firmware button to step 3
        const $saveButton = createSaveFirmwareButton(blob, uf2File.name, $guidePanel);
        $guidePanel.find(`.upgrade-step[data-step="3"]`).append($saveButton);
        
    } catch (error) {
        showUpdateError($guidePanel, error);
        post(`Error: ${error.message}`);
        console.error('Upgrade error:', error);
    }
}

function createSaveFirmwareButton(blob, filename, $guidePanel) {
    return $('<button>', {
        id: 'save-firmware-button',
        text: 'Click to save firmware to uSEQ',
        css: {
            display: 'block',
            margin: '15px auto 5px',
            padding: '12px 20px',
            backgroundColor: 'var(--accent-color)',
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            fontWeight: 'bold',
            cursor: 'pointer',
            width: '100%',
            maxWidth: '300px',
            textAlign: 'center',
            fontSize: '1.1em',
            transition: 'all 0.2s ease'
        }
    }).on('click', async function() {
        try {
            $(this).text('Saving...').css('opacity', '0.7').prop('disabled', true);
            await saveFileToBootloader(blob, filename);
            markStepComplete($guidePanel, 3);
            showUpdateComplete($guidePanel);
            post('Update completed successfully!');
            
            // Auto-close after 4 seconds
            setTimeout(() => {
                $guidePanel.fadeOut(300, () => $guidePanel.remove());
            }, 4000);
        } catch (error) {
            $(this).text('Error - Try Again').css('opacity', '1').prop('disabled', false);
            showUpdateError($guidePanel, error);
            post(`Error saving firmware: ${error.message}`);
        }
    });
}

async function saveFileToBootloader(blob, filename) {
    // Add debug info to check blob size and type
    dbg(`Firmware blob size: ${blob.size} bytes`);
    dbg(`Firmware blob type: ${blob.type}`);
    
    if (blob.size === 0) {
        dbg("**Error**: The firmware file is empty (0 bytes). Download failed.");
        return Promise.reject(new Error("Firmware file is empty"));
    }
    
    return new Promise((resolve, reject) => {
        try {
            // Create file object for saving
            const file = new File([blob], filename, { type: 'application/octet-stream' });
            dbg(`Created File object: ${file.name}, size: ${file.size} bytes`);
            
            // Use the File System Access API if available
            if ('showSaveFilePicker' in window) {
                window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'Firmware files',
                        accept: { 'application/octet-stream': ['.uf2'] }
                    }]
                })
                .then(fileHandle => {
                    dbg("Got file handle, creating writable");
                    return fileHandle.createWritable();
                })
                .then(writable => {
                    dbg(`Writing ${blob.size} bytes to file`);
                    // Log a sample of the blob content to verify it's valid
                    blob.slice(0, 20).arrayBuffer().then(buffer => {
                        const view = new Uint8Array(buffer);
                        dbg(`First 20 bytes: ${Array.from(view).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    });
                    
                    // Write the actual blob directly
                    return writable.write(blob)
                        .then(() => {
                            dbg("Write complete, closing file");
                            return writable.close();
                        })
                        .then(() => {
                            resolve();
                        });
                })
                .catch(err => {
                    dbg(`Save error: ${err.message}`);
                    reject(err);
                });
            } else {
                // Fallback to traditional download approach
                const a = document.createElement('a');
                const url = URL.createObjectURL(blob);
                dbg(`Created object URL for blob: ${url}`);
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                
                // Add some visible feedback that download is occurring
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    resolve();
                }, 100);
            }
        } catch (error) {
            dbg(`Error in saveFileToBootloader: ${error.message}`);
            console.error("Save file error:", error);
            reject(error);
        }
    });
}

function createUpgradeGuidePanel() {
    // Create the main panel
    const $guidePanel = $('<div>', {
        id: 'upgrade-guide-panel',
        class: 'panel-aux upgrade-guide',
        css: {
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '500px',
            height: 'auto',
            maxWidth: '80%',
            padding: '20px',
            zIndex: 1000,
            backgroundColor: 'var(--panel-bg)',
            borderRadius: 'var(--panel-border-radius)',
            border: '1px solid var(--accent-color)'
        }
    });

    // Create panel content
    const $panelContent = createPanelContent();
    const $title = createPanelTitle('Firmware Update Progress');
    const $stepsContainer = createStepsContainer();
    const $completion = createCompletionMessage();
    const $closeButton = createCloseButton($guidePanel);

    // Assemble the panel
    $panelContent.append($title, $stepsContainer, $completion, $closeButton);
    $guidePanel.append($panelContent);

    return $guidePanel;
}

function createStepsContainer() {
    const $container = $('<div>', {
        class: 'upgrade-steps-container'
    });

    // Add the upgrade steps
    const steps = [
        'Download latest firmware (auto)',
        'Put uSEQ in bootloader mode (auto)',
        `Once the module appears as an external drive connected to your computer (this may take a moment):
        1) click the button below to open a save dialog,
        2) Navigate to the external drive (named Raspberry-Pi),
        3) Click 'save' to write the firmware to the module`,
    ];

    steps.forEach((step, index) => {
        const $step = createUpgradeStep(index + 1, step);
        $container.append($step);
    });

    return $container;
}

function createUpgradeStep(number, text) {
    const $step = $('<div>', {
        class: 'upgrade-step',
        'data-step': number,
        css: {
            display: 'flex',
            alignItems: 'center',
            margin: '15px 0',
            padding: '10px',
            backgroundColor: 'var(--panel-control-bg)',
            borderRadius: 'var(--item-border-radius)',
            color: 'var(--text-muted, #888)',
            transition: 'all 0.3s ease'
        }
    });

    const $number = $('<div>', {
        class: 'step-number',
        text: number,
        css: {
            width: '30px',
            height: '30px',
            borderRadius: '50%',
            backgroundColor: 'var(--panel-item-hover-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: '15px',
            fontWeight: 'bold',
            transition: 'all 0.3s ease'
        }
    });

    const $text = $('<div>', {
        class: 'step-text',
        text: text
    });

    const $status = $('<div>', {
        class: 'step-status',
        css: {
            marginLeft: 'auto',
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            color: 'var(--accent-color)',
            opacity: '0'
        },
        html: '✓'
    });

    $step.append($number, $text, $status);
    return $step;
}

function createCompletionMessage() {
    return $('<div>', {
        class: 'upgrade-completion',
        css: {
            textAlign: 'center',
            margin: '20px 0',
            padding: '15px',
            backgroundColor: 'rgba(0, 255, 0, 0.1)',
            borderRadius: 'var(--item-border-radius)',
            display: 'none'
        },
        html: '<div style="font-size: 2em; color: var(--accent-color);">✓</div>' +
              '<div>Update completed successfully!</div>'
    });
}

function createCloseButton($panel) {
    return $('<button>', {
        class: 'panel-button',
        text: 'Close',
        css: {
            display: 'block',
            margin: '20px auto 0',
            backgroundColor: 'var(--panel-control-bg)',
            color: 'var(--text-primary)',
            border: 'none',
            borderRadius: '4px',
            padding: '10px',
            cursor: 'pointer'
        }
    }).on('click', function() {
        $panel.fadeOut(300, () => $panel.remove());
    });
}

function showUpgradeGuidePanel($guidePanel) {
    $('body').append($guidePanel);
    $guidePanel.hide().fadeIn(300);
}

function markStepComplete($panel, stepNumber) {
    const $step = $panel.find(`.upgrade-step[data-step="${stepNumber}"]`);
    
    $step.css({
        backgroundColor: 'rgba(0, 255, 0, 0.1)',
        color: 'var(--text-primary)'
    });
    
    $step.find('.step-number').css({
        backgroundColor: 'var(--accent-color)',
        color: '#000'
    });
    
    $step.find('.step-status').css({
        opacity: '1'
    });
}

function showUpdateComplete($panel) {
    $panel.find('.upgrade-completion').fadeIn(300);
}

function showUpdateError($panel, error) {
    const $errorMessage = $('<div>', {
        class: 'upgrade-error',
        css: {
            margin: '15px 0',
            padding: '15px',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
            borderRadius: 'var(--item-border-radius)',
            color: '#ff3333',
            textAlign: 'center'
        },
        html: `<strong>Error:</strong> ${error.message || 'An unexpected error occurred'}`
    });
    
    $panel.find('.panel-section').append($errorMessage);
}

function findUF2Asset(assets) {
    return assets.find(asset => asset.name.endsWith('.uf2'));
}

function fetchLatestRelease() {
    return fetch("https://api.github.com/repos/Emute-Lab-Instruments/uSEQ/releases/latest")
        .then(response => {
            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }
            return response.json();
        });
}

function downloadFirmwareFromServer(url, filename) {
    
    // Create a URL using the CORS proxy
    const proxyUrl = `https://api.cors.lol/?url=${encodeURIComponent(url)}`;
    dbg(`Using CORS proxy: ${proxyUrl}`);
    
    return fetch(proxyUrl)
        .then(response => {
            dbg(`Response received: status ${response.status}, type: ${response.type}`);
            
            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }
            
            return response.blob();
        })
        .then(blob => {
            dbg(`Downloaded blob via proxy: ${filename}, size: ${blob.size} bytes, type: ${blob.type}`);
            
            // Check if we got actual content or an empty blob
            if (blob.size === 0) {
                dbg("Empty blob received from proxy, trying direct user download");
                return promptDirectDownload(url, filename);
            }
            
            // Log a sample of the blob content to verify it's valid
            return blob.slice(0, 32).arrayBuffer()
                .then(buffer => {
                    const view = new Uint8Array(buffer);
                    dbg(`First 32 bytes: ${Array.from(view).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
                    return blob;
                });
        })
        .catch(error => {
            dbg(`Proxy download error: ${error.message}. Trying direct user download...`);
            return promptDirectDownload(url, filename);
        });
}

function downloadWithXHR(url, filename) {
    dbg(`Attempting XHR download from: ${url}`);
    
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        
        xhr.onload = function() {
            if (this.status === 200) {
                const blob = this.response;
                dbg(`XHR download complete: ${filename}, size: ${blob.size} bytes`);
                
                if (blob.size === 0) {
                    dbg("XHR also returned empty blob, trying direct user download");
                    promptDirectDownload(url, filename).then(resolve).catch(reject);
                } else {
                    resolve(blob);
                }
            } else {
                dbg(`XHR failed with status: ${this.status}`);
                reject(new Error(`Download failed with status: ${this.status}`));
            }
        };
        
        xhr.onerror = function() {
            dbg("XHR network error occurred");
            promptDirectDownload(url, filename).then(resolve).catch(reject);
        };
        
        xhr.onprogress = function(event) {
            if (event.lengthComputable) {
                const percentComplete = Math.round((event.loaded / event.total) * 100);
                dbg(`Download progress: ${percentComplete}%`);
            }
        };
        
        xhr.send();
    });
}

function promptDirectDownload(url, filename) {
    return new Promise((resolve, reject) => {
        const $downloadDialog = $('<div>', {
            class: 'cors-download-dialog',
            css: {
                position: 'fixed',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '450px',
                padding: '20px',
                backgroundColor: 'var(--panel-bg)',
                borderRadius: 'var(--panel-border-radius)',
                border: '1px solid var(--accent-color)',
                zIndex: 1001
            },
            html: `
                <h3>Download Required</h3>
                <p>Due to browser security restrictions, we need your help to download the firmware.</p>
                <p>Click the button below to download the firmware file.</p>
                <p>After downloading, click "Continue" and select the downloaded file.</p>
            `
        });
        
        const $buttonContainer = $('<div>', {
            css: {
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '20px',
                gap: '10px'
            }
        });
        
        const $downloadButton = $('<button>', {
            text: 'Download Firmware',
            class: 'panel-button primary',
            css: {
                backgroundColor: 'var(--accent-color)',
                color: '#000',
                flex: '1',
                padding: '10px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
            },
            click: function() {
                // Create a download link
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.target = '_blank';
                a.click();
                
                $(this).text('Downloaded? Click Continue →');
                $continueButton.prop('disabled', false);
            }
        });
        
        const $continueButton = $('<button>', {
            text: 'Continue',
            class: 'panel-button',
            css: {
                backgroundColor: 'var(--panel-control-bg)',
                color: 'var(--text-primary)',
                flex: '1',
                padding: '10px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
            },
            prop: {
                disabled: true
            },
            click: function() {
                // Create a file input to let the user select the downloaded file
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.uf2';
                
                fileInput.onchange = function(e) {
                    const file = e.target.files[0];
                    if (file) {
                        $downloadDialog.remove();
                        resolve(file);
                    } else {
                        alert('Please select the firmware file you downloaded');
                    }
                };
                
                fileInput.click();
            }
        });
        
        $buttonContainer.append($downloadButton, $continueButton);
        $downloadDialog.append($buttonContainer);
        $('body').append($downloadDialog);
    });
}

/**
 * Downloads the latest UF2 file from the uSEQ GitHub repository
 * @returns {Promise} Promise that resolves when the download starts
 */
export function downloadLatestUF2() {
    return fetchLatestRelease()
        .then(releaseData => {
            const assets = releaseData.assets || [];
            const uf2File = findUF2Asset(assets);
            
            if (!uf2File) {
                throw new Error('Could not find UF2 file in the latest release');
            }
            
            // Construct direct download URL from our server
            const directUrl = `https://www.emutelabinstruments.co.uk/firmware/binaries/${uf2File.name}`;
            return directUrl;
        })
        .then(url => {
            // Create a download link
            const a = document.createElement('a');
            a.href = url;
            a.download = url.split('/').pop();
            a.click();
            
            post(`**Info**: Started downloading firmware to your browser's Downloads folder.`);
            return url;
        })
        .then(showFileRelocationOption)
        .catch(handleDownloadError);
}

/**
 * Handles download errors
 * @param {Error} error - The error that occurred
 * @returns {null} - Returns null to indicate failure
 */
function handleDownloadError(error) {
    dbg('GitHub API error:', error);
    return null;
}

/**
 * Shows the option to relocate the downloaded file
 * @param {string} url - The download URL
 * @returns {string} - The same URL for chaining
 */
function showFileRelocationOption(url) {
    if (!url) return null;
    
    const filename = url.split('/').pop();

    // Give the download a moment to start
    setTimeout(() => {
        const buttonHtml = createRelocationButton(filename);
        post(`**Download ready**: Click the button below to open the uf2 file that was just downloaded, then on the next screen save it on the "RP2040" external drive.${buttonHtml}`);
    }, 1000);

    return url;
}

/**
 * Creates a button to help relocate the file
 * @param {string} filename - Name of the downloaded file
 * @returns {string} - HTML for the relocation button
 */
function createRelocationButton(filename) {
    const buttonId = `relocate-btn-${Date.now()}`;
    const buttonHtml = `<button id="${buttonId}" class="relocate-button">Save ${filename} to RP2040</button>`;

    // Set up event listener after a short delay
    setTimeout(() => {
        const button = document.getElementById(buttonId);
        if (button) {
            button.addEventListener('click', () => openFilePicker(filename));
        }
    }, 100);

    return buttonHtml;
}

// Expose functions to the global scope for browser access
if (typeof window !== 'undefined') {
    window.downloadLatestUF2 = downloadLatestUF2;
    window.startUpgradeFlow = startUpgradeFlow;
}