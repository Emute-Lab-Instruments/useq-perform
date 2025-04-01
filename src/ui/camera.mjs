export function openCam() {
  // let error = false;
  let allMediaDevices = navigator.mediaDevices;
  if (!allMediaDevices || !allMediaDevices.getUserMedia) {
    dbg("getUserMedia() not supported.");
    return;
  }
  try {
    allMediaDevices.getUserMedia({
      audio: false,
      video: { width: 1200, height: 800 }
    })
      .then(function (vidStream) {
        dbg(vidStream)
        var video = document.getElementById('videopanel');
        if ("srcObject" in video) {
          video.srcObject = vidStream;
        } else {
          video.src = window.URL.createObjectURL(vidStream);
        }
        video.onloadedmetadata = function (e) {
          video.play();
        };
      })
      .catch(function (e) {
        dbg(e.name + ": " + e.message);
        error = true;
      });
  }
   catch(err) {
    dbg(err)
  }
  // return error;
  return true;
}