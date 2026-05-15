import { post } from './console.mjs';

export { upgradeCheck };

function upgradeCheck(versionMsg) {
  const verRE = /([0-9])\.([0-9])(.([0-9]))?/g;
  const groups = verRE.exec(versionMsg);
  if (!groups) {
    post(`**Connected to uSEQ** (firmware: ${versionMsg})`);
    return;
  }
  const moduleVersionMajor = groups[1];
  const moduleVersionMinor = groups[2];
  let moduleVersionPatch = 0;
  if (groups[4]) {
    moduleVersionPatch = groups[4];
  }
  post(`**Connected to uSEQ, firmware version ${versionMsg}**`);
  $.ajax({
    url: "https://api.github.com/repos/Emute-Lab-Instruments/uSEQ/releases",
    type: "GET",
    data: { "accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    error: function (xhr, ajaxOptions, thrownError) {
    }
  }).then(function (data) {
    const re = /uSEQ_(.*)_(([0-9])\.([0-9])\.([0-9]))_[0-9]{8}/g;
    const matches = re.exec(data[0]['tag_name']);
    if (!matches) return;
    const version = matches[2];
    const ghVersionMajor = matches[3];
    const ghVersionMinor = matches[4];
    const ghVersionPatch = matches[5];
    if (ghVersionMajor > moduleVersionMajor ||
      (ghVersionMinor > moduleVersionMinor && ghVersionMajor >= moduleVersionMajor)
      ||
      (ghVersionPatch > moduleVersionPatch && ghVersionMinor >= moduleVersionMinor && ghVersionMajor >= moduleVersionMajor)) {
      post("Info: There is a new firmware release available:");
      post(`• <a target='blank' href='${data[0]['html_url']}'>Download new firmware</a>`);
      post(`• <a target="blank" href="https://emutelabinstruments.co.uk/useqinfo/useq-update/">Firmware update guide</a>`);
    }
  });
}
