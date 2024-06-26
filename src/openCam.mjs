export function openCam() {
  let error = false;
  let allMediaDevices = navigator.mediaDevices;
  if (!allMediaDevices || !allMediaDevices.getUserMedia) {
    console.log("getUserMedia() not supported.");
    return;
  }
  allMediaDevices.getUserMedia({
    audio: false,
    video: { width: 1920, height: 1080 }
  })
    .then(function (vidStream) {
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
      console.log(e.name + ": " + e.message);
      error = true;
    });
  return error;
}
