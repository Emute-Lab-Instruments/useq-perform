import { post } from '../io/console.mjs';
import { dbg } from '../utils.mjs';
import { showUpdateNotification } from './upgradeFlow.mjs';

/**
 * Parses a version string into major, minor, patch components and keeps the original string
 */
function parseVersion(versionString) {
  const verRE = /([0-9])\.([0-9])(.([0-9]))?/g;
  const groups = verRE.exec(versionString);
  dbg(groups);
  
  const major = parseInt(groups[1], 10);
  const minor = parseInt(groups[2], 10);
  let patch = 0;
  
  if (groups[4]) {
    patch = parseInt(groups[4], 10);
  }
  
  return { 
    major, 
    minor, 
    patch,
    string: versionString
  };
}

/**
 * Fetches the latest release information from GitHub
 */
function fetchLatestRelease() {
  return $.ajax({
    url: "https://api.github.com/repos/Emute-Lab-Instruments/uSEQ/releases",
    type: "GET",
    data: { "accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    error: function (xhr, ajaxOptions, thrownError) {
      dbg("Failed to fetch releases:", thrownError);
    }
  });
}

/**
 * Extracts version information from a GitHub release tag
 */
function parseReleaseTag(tagName) {
  const re = /uSEQ_(.*)_(([0-9])\.([0-9])\.([0-9]))_[0-9]{8}/g;
  const matches = re.exec(tagName);
  
  if (!matches) {
    return null;
  }
  
  return {
    major: parseInt(matches[3], 10),
    minor: parseInt(matches[4], 10),
    patch: parseInt(matches[5], 10),
    string: matches[2]
  };
}

/**
 * Determines if a newer version is available
 */
function isNewerVersionAvailable(current, latest) {
  return (
    latest.major > current.major ||
    (latest.minor > current.minor && latest.major >= current.major) ||
    (latest.patch > current.patch && latest.minor >= current.minor && latest.major >= current.major)
  );
}

/**
 * Checks if a firmware upgrade is available
 */

export let currentVersion = null;

export function upgradeCheck(versionMsg) {
  currentVersion = parseVersion(versionMsg);
  post(`<span style="color: var(--accent-color); font-weight: bold; display: inline;">**Connected to uSEQ (v${currentVersion.string})**</span>`);
  
  fetchLatestRelease().then(function(data) {
    if (!data || !data.length) {
      return;
    }
    
    const latestRelease = parseReleaseTag(data[0]['tag_name']);
    if (!latestRelease) {
      return;
    }
    
    dbg(latestRelease.string);
    
    if (isNewerVersionAvailable(currentVersion, latestRelease)) {
      showUpdateNotification(currentVersion.string, latestRelease.string, data[0]['html_url']);
    }
  });
}



