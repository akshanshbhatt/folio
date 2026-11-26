"use strict";
const video = document.querySelector("video"),
  cues = JSON.parse(document.getElementById("cue-data").textContent);
if (typeof VTTCue === "function") {
  const lang = video.dataset.language || "und";
  const track = video.addTextTrack("captions", "Captions", lang);
  for (const c of cues) track.addCue(new VTTCue(c.start, c.end, c.text));
  track.mode = "disabled";
}
