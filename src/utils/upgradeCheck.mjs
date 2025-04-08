import { post } from '../io/console.mjs';
import { dbg } from '../utils.mjs';

/**
 * Downloads the latest UF2 file from the uSEQ GitHub repository
 * @returns {Promise} Promise that resolves when the download starts
 */
export function downloadLatestUF2() {
  return fetchLatestRelease()
    .then(findAndDownloadUF2)
    .then(showFileRelocationOption)
    .catch(handleDownloadError);
}

/**
 * Fetches the latest release data from GitHub
 * @returns {Promise} Promise that resolves with the release data
 */
function fetchLatestRelease() {
  return $.ajax({
    url: "https://api.github.com/repos/Emute-Lab-Instruments/uSEQ/releases/latest",
    type: "GET",
    data: { "accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  });
}

/**
 * Handles download errors
 * @param {Error} error - The error that occurred
 * @returns {null} - Returns null to indicate failure
 */
function handleDownloadError(error) {
  post(`**Error**: Failed to fetch the latest release information.`);
  dbg('GitHub API error:', error);
  return null;
}

/**
 * Finds and downloads the UF2 file from the assets
 * @param {Object} releaseData - The release data from GitHub
 * @returns {Object|null} - The UF2 file info or null if not found
 */
function findAndDownloadUF2(releaseData) {
  const assets = releaseData.assets || [];
  const uf2File = findUF2Asset(assets);
  
  if (uf2File) {
    downloadFile(uf2File.browser_download_url, uf2File.name);
    post(`**Info**: Started downloading ${uf2File.name} to your browser's Downloads folder.`);
    return uf2File;
  } else {
    post(`**Error**: Could not find UF2 file in the latest release.`);
    return null;
  }
}

/**
 * Finds the UF2 asset in the list of release assets
 * @param {Array} assets - Array of release assets
 * @returns {Object|null} - The UF2 asset object or null if not found
 */
function findUF2Asset(assets) {
  return assets.find(asset => asset.name.endsWith('.uf2'));
}

/**
 * Downloads a file using a hidden link
 * @param {string} url - URL of the file to download
 * @param {string} filename - Name to save the file as
 * @returns {void}
 */
function downloadFile(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Shows the option to relocate the downloaded file
 * @param {Object} uf2File - Information about the downloaded file
 * @returns {Object} - The same uf2File object for chaining
 */
function showFileRelocationOption(uf2File) {
  if (!uf2File) return null;
  
  // Give the download a moment to start
  setTimeout(() => {
    const buttonHtml = createRelocationButton(uf2File.name);
    post(`**Download ready**: Click the button below to open the uf2 file that was just downloaded, then on the next screen save it on the "RP2040" external drive.${buttonHtml}`);
  }, 1000);
  
  return uf2File;
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

/**
 * Opens a file picker dialog to select the downloaded file
 * @param {string} filename - Name of the downloaded file
 * @returns {Promise<void>}
 */
async function openFilePicker(filename) {
  try {
    if (!('showOpenFilePicker' in window)) {
      post(`**Error**: Your browser doesn't support the File System Access API.`);
      showManualInstructions(filename);
      return;
    }
    
    post(`**Info**: Please select the downloaded ${filename} file...`);
    
    // Show file picker to select the downloaded file
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'UF2 File',()   
        accept: { 'application/octet-stream': ['.uf2'] }
      }],
      multiple: false
    });
    
    const file = await fileHandle.getFile();
    
    // Now show save picker to choose destination
    await saveFileToDestination(file);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      post(`**Info**: File selection was canceled.`);
      // Recreate the button to allow another attempt
      const buttonHtml = createRelocationButton(filename);
      post(`**Retry Available**: Click the button below to try again.${buttonHtml}`);
    } else {
      post(`**Error**: ${error.message}`);
      dbg('File picker error:', error);
      showManualInstructions(filename);
    }
  }
}

/**
 * Saves the selected file to a user-chosen destination
 * @param {File} file - The file to save
 * @returns {Promise<void>}
 */
async function saveFileToDestination(file) {
  try {
    post(`**Info**: Now choose where to save the file (e.g., RP2040 bootloader drive)...`);
    
    const saveFileHandle = await window.showSaveFilePicker({
      suggestedName: file.name,
      types: [{
        description: 'UF2 File',
        accept: { 'application/octet-stream': ['.uf2'] }
      }]
    });
    
    const writable = await saveFileHandle.createWritable();
    await writable.write(await file.arrayBuffer());
    await writable.close();
    
    post(`**Success**: File successfully saved to the new location!`);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      post(`**Info**: Save operation was canceled.`);
      // Recreate the button to allow another attempt
      const buttonHtml = createRelocationButton(file.name);
      post(`**Retry Available**: Click the button below to try again.${buttonHtml}`);
    } else {
      post(`**Error**: Failed to save file to new location: ${error.message}`);
      dbg('Save error:', error);
    }
  }
}

/**
 * Shows manual instructions for moving the file
 * @param {string} filename - Name of the downloaded file
 * @returns {void}
 */
function showManualInstructions(filename) {
  post(`**Manual Instructions**:
1. Locate ${filename} in your Downloads folder
2. Connect your device in bootloader mode (it will appear as a USB drive)
3. Copy the file to the RP2040 device folder
4. The device will automatically restart after the file is copied`);
}

/**
 * Generates HTML for a download button with instructions
 * @param {string} url - URL of the asset to download
 * @param {string} filename - Name of the file to download
 * @returns {string} - The HTML for the download buttons and instructions
 */
function createDownloadButtons(url, filename) {
  const saveButtonId = `save-btn-${Date.now()}`;
  const downloadButtonId = `download-btn-${Date.now()}`;
  
  // Create HTML for the buttons
  return `
    <div class="download-options">
      <button id="${saveButtonId}" class="download-button primary-button">Use Save Dialog (Chrome/Edge)</button>
      <button id="${downloadButtonId}" class="download-button secondary-button">Direct Download (All Browsers)</button>
    </div>
    <div class="instructions">
      <p><strong>To save directly to your RP2040 bootloader:</strong></p>
      <ol>
        <li>Connect your device in bootloader mode</li>
        <li>Click "Use Save Dialog" button (Chrome/Edge) or "Direct Download" (other browsers)</li>
        <li>Select your RP2040 device from the save dialog</li>
      </ol>
    </div>
  `;
}

/**
 * Creates interactive download buttons in the console
 * @param {string} url - URL of the asset to download
 * @param {string} filename - Name of the file to download
 * @returns {string} - The HTML for the download interface
 */
function createDownloadLink(url, filename) {
  // Generate the HTML content for the download interface
  const buttonsHtml = createDownloadButtons(url, filename);
  
  // Post the interface to the console
  post(`**Download Ready**: ${buttonsHtml}`);
  
  // Set up event listeners after a short delay to ensure DOM is updated
  setTimeout(() => {
    setupDownloadButtonListeners(url, filename);
  }, 100);
  
  return buttonsHtml;
}

/**
 * Sets up event listeners for the download buttons
 * @param {string} url - URL of the asset to download
 * @param {string} filename - Name of the file to download
 * @returns {void}
 */
function setupDownloadButtonListeners(url, filename) {
  // Find the buttons by their class and recent creation time
  const saveButton = document.querySelector('.primary-button');
  const downloadButton = document.querySelector('.secondary-button');
  
  // Add listener for the save dialog button
  if (saveButton) {
    saveButton.addEventListener('click', () => handleSaveDialog(filename));
  }
  
  // Add listener for the direct download button
  if (downloadButton) {
    downloadButton.addEventListener('click', () => handleDirectDownload(url, filename));
  }
}

/**
 * Handles the save dialog process using File System Access API
 * @param {string} filename - Suggested name for the file
 * @returns {Promise<void>}
 */
async function handleSaveDialog(filename) {
  try {
    // Check if the File System Access API is available
    if ('showSaveFilePicker' in window) {
      post(`**Info**: Opening save dialog...`);
      
      // Show the file picker
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'UF2 File',
          accept: { 'application/octet-stream': ['.uf2'] }
        }]
      });
      
      // Get the file info to display to the user
      const fileInfo = await fileHandle.getFile();
      post(`**Success**: File will be saved as ${fileInfo.name} when you complete the download`);
      
      // Direct the user to the download page in a new tab
      openDownloadPage();
    } else {
      post(`**Error**: Your browser doesn't support the File System Access API. Please use the "Direct Download" button instead.`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      post(`**Info**: File save dialog was canceled`);
    } else {
      post(`**Error**: ${error.message}`);
      dbg('Save dialog error:', error);
    }
  }
}

/**
 * Opens the GitHub releases page in a new tab for downloading
 * @returns {void}
 */
function openDownloadPage() {
  const releasesUrl = 'https://github.com/Emute-Lab-Instruments/uSEQ/releases/latest';
  post(`**Info**: Opening the latest release page. Please download the UF2 file from there.`);
  window.open(releasesUrl, '_blank');
}

/**
 * Handles direct download through a new window
 * @param {string} url - URL of the file to download
 * @param {string} filename - Name of the file to download
 * @returns {void}
 */
function handleDirectDownload(url, filename) {
  post(`**Info**: Starting direct download of ${filename}`);
  
  // Open the download URL in a new tab
  window.open(url, '_blank');
  
  // Provide instructions on how to save to a specific location
  post(`**Tip**: Most browsers allow you to choose where to save downloaded files:
  - **Chrome/Edge**: Settings > Downloads > Ask where to save each file
  - **Firefox**: Options > General > Downloads > Always ask you where to save files
  - **Safari**: Preferences > General > File download location: Ask for each download`);
}

// Expose downloadLatestUF2 to the global scope for browser console access
if (typeof window !== 'undefined') {
  window.downloadLatestUF2 = downloadLatestUF2;
}

export function upgradeCheck(versionMsg) {
  // const verRE = /([0-9])\.([0-9])/g;
  const verRE = /([0-9])\.([0-9])(.([0-9]))?/g;
  const groups = verRE.exec(versionMsg);
  dbg(groups);
  // const groups = verRE.exec("1.0.2");
  const moduleVersionMajor = groups[1];
  const moduleVersionMinor = groups[2];
  let moduleVersionPatch = 0;
  if (groups[4]) {
    moduleVersionPatch = groups[4];
  }
  post(`**Connected to uSEQ (v${versionMsg})**`);
  //new release checker
  $.ajax({
    url: "https://api.github.com/repos/Emute-Lab-Instruments/uSEQ/releases",
    type: "GET",
    data: { "accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    error: function (xhr, ajaxOptions, thrownError) {
    }
  }).then(function (data) {
    //example uSEQ_1.0c_1.0.4_17072024
    // const re = /uSEQ_(.*)_(([0-9])\.([0-9]))/g;
    const re = /uSEQ_(.*)_(([0-9])\.([0-9])\.([0-9]))_[0-9]{8}/g;
    const matches = re.exec(data[0]['tag_name']);
    const version = matches[2];
    const ghVersionMajor = matches[3];
    const ghVersionMinor = matches[4];
    const ghVersionPatch = matches[5];
    dbg(version);
    //compare version
    if (ghVersionMajor > moduleVersionMajor ||
      (ghVersionMinor > moduleVersionMinor && ghVersionMajor >= moduleVersionMajor)
      ||
      (ghVersionPatch > moduleVersionPatch && ghVersionMinor >= moduleVersionMinor && ghVersionMajor >= moduleVersionMajor)) {
      //new release available
      post(`**Info**: There is a new firmware release (**v${version}**) available, you can 
        <a target='blank' href='${data[0]['html_url']}'>download it</a> 
        and follow the
        <a target="blank" href="https://emutelabinstruments.co.uk/useqinfo/useq-update/">update guide</a>.`);
    }
  });
}

