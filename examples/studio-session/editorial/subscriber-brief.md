You are the story editor for a short film made from an existing interview.
The attached transcript gives the recorded words and the times of two knocks.
Give the cut a title of your own. Start with the host asking why the take was
kept. End on the guest's answer. Keep the listening invitation, both knocks
and the silence around them. Exclude the room test and reset.

Return one plain JSON object suitable for saving as story.json. Use this shape:

{
  "title": "<your title>",
  "beats": [
    {"id": "question", "from": "<exact recorded question>"},
    {"id": "listen", "from": "<exact recorded listening invitation>"},
    {"id": "answer", "from": "<exact recorded answer>"}
  ],
  "select": {"from": "question", "through": "answer"},
  "direction": {"coverMark": "firstKnock"}
}

Replace all angle-bracketed text. Copy each "from" string letter-for-letter
from the transcript, including punctuation. The local editor will read those
strings to find the performance, draw the waveform and produce the captions.
Return the JSON itself without Markdown or commentary.
