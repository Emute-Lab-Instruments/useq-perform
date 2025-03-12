import { post } from './console.mjs';

export { upgradeCheck };

function upgradeCheck(versionMsg) {
  // const verRE = /([0-9])\.([0-9])/g;
  const verRE = /([0-9])\.([0-9])(.([0-9]))?/g;
  const groups = verRE.exec(versionMsg);
  console.log(groups);
  // const groups = verRE.exec("1.0.2");
  const moduleVersionMajor = groups[1];
  const moduleVersionMinor = groups[2];
  let moduleVersionPatch = 0;
  if (groups[4]) {
    moduleVersionPatch = groups[4];
  }
  post(`**Connected to uSEQ, firmware version ${versionMsg}**`);
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
    console.log(version);
    //compare version
    if (ghVersionMajor > moduleVersionMajor ||
      (ghVersionMinor > moduleVersionMinor && ghVersionMajor >= moduleVersionMajor)
      ||
      (ghVersionPatch > moduleVersionPatch && ghVersionMinor >= moduleVersionMinor && ghVersionMajor >= moduleVersionMajor)) {
      //new release available
      post("Info: There is a new firmware release available:");
      post(`• <a target='blank' href='${data[0]['html_url']}'>Download new firmware</a>`);
      post(`• <a target="blank" href="https://emutelabinstruments.co.uk/useqinfo/useq-update/">Firmware update guide</a>`);
    }
  });
}
