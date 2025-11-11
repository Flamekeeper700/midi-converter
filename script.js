console.log("Script loaded");

// Minimal JS MIDI generator with proper VLQ delta times
class MidiFile {
  constructor() { this.tracks = []; }
  addTrack(track) { this.tracks.push(track); }
  toBytes() {
    const header = [
      0x4d,0x54,0x68,0x64, // MThd
      0x00,0x00,0x00,0x06, // header length
      0x00,0x01,           // format 1
      0x00,this.tracks.length, // number of tracks
      0x01,0xe0              // ticks per quarter = 480
    ];
    let bytes = [...header];
    for(const t of this.tracks) bytes.push(...t.toBytes());
    return bytes.map(b=>String.fromCharCode(b)).join('');
  }
}

function encodeVarLen(value) {
  let buffer = value & 0x7F;
  const bytes = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= ((value & 0x7F) | 0x80);
  }
  while (true) {
    bytes.push(buffer & 0xFF);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

class MidiTrack {
  constructor() { this.events = []; }
  addNote(channel, note, duration) {
    // Store delta + noteOn, note, velocity + noteOff
    this.events.push([0, 0x90 | channel, note, 0x64]); // delta=0 for now
    this.events.push([duration, 0x80 | channel, note, 0x40]);
  }
  toBytes() {
    const result = [];
    for(const e of this.events){
      const deltaBytes = encodeVarLen(e[0]);
      result.push(...deltaBytes, e[1], e[2], e[3]);
    }
    const len = result.length;
    const header = [0x4d,0x54,0x72,0x6b, (len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff];
    return [...header,...result];
  }
}

// Utility functions
async function getAudioBuffer(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") await ctx.resume();
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

function quantize(values, numBins) {
  const min = Math.min(...values), max = Math.max(...values), step = (max-min)/numBins;
  return values.map(v=>Math.round((v-min)/step));
}

// Button click handler
document.getElementById('convertBtn').onclick = async () => {
  const file = document.getElementById('fileInput').files[0];
  const numNotes = parseInt(document.getElementById('numNotes').value);
  const status = document.getElementById('status');
  const bar = document.getElementById('progressBar');
  const container = document.getElementById('progressContainer');

  if (!file) { alert("Select an MP3 first."); return; }

  container.style.display = "block";
  bar.style.width = "0%";
  status.textContent = "Preparing…";
  await new Promise(r=>setTimeout(r,50));

  try {
    status.textContent = "Decoding audio…";
    bar.style.width = "5%";
    const buffer = await getAudioBuffer(file);

    status.textContent = "Analyzing…";
    const data = buffer.getChannelData(0);
    const frameSize = 2048, hop = 1024, sampleRate = buffer.sampleRate;
    const pitches = [];
    let nextUpdate = 0;

    for(let i=0;i<data.length-frameSize;i+=hop){
      const frame = data.slice(i,i+frameSize);
      const mag = frame.map(v=>Math.abs(v));
      const maxIdx = mag.indexOf(Math.max(...mag));
      const freq = maxIdx*(sampleRate/frameSize);
      if(freq>50 && freq<2000) pitches.push(69 + 12*Math.log2(freq/440));

      const progress = (i/(data.length-frameSize))*90+5;
      if(progress>nextUpdate){ bar.style.width = progress.toFixed(1)+"%"; nextUpdate+=1; await new Promise(r=>setTimeout(r,0)); }
      if(i%100000===0) console.log("Analyzing frame index:", i);
    }

    if(pitches.length===0){ status.textContent="No tonal content detected."; bar.style.width="0%"; console.warn("No pitches detected"); return; }

    status.textContent="Building MIDI…";
    bar.style.width="95%";

    const q = quantize(pitches,numNotes);
    const uniqueBins = [...new Set(q)];
    console.log("Unique bins:", uniqueBins.length);

    const midiFile = new MidiFile();
    const track = new MidiTrack();
    midiFile.addTrack(track);

    // Correct ticks per frame using VLQ
    const totalFrames = Math.ceil(data.length / hop);
    const bpm = 120;
    const ticksPerQuarter = 480;
    const songSeconds = data.length / sampleRate;
    const secondsPerTick = 60 / bpm / ticksPerQuarter;
    const ticksPerFrame = Math.max(1, Math.round((songSeconds / totalFrames) / secondsPerTick));

    console.log("Ticks per frame:", ticksPerFrame);

    let last = q[0], duration = 1;
    for(let i=1;i<q.length;i++){
      if(q[i]===last) duration++;
      else { track.addNote(0, uniqueBins[last]+60, ticksPerFrame*duration); last=q[i]; duration=1; }
    }
    track.addNote(0, uniqueBins[last]+60, ticksPerFrame*duration);

    console.log("Generating MIDI blob...");
    const midiData = midiFile.toBytes();
    const blob = new Blob([new Uint8Array(midiData.split('').map(c=>c.charCodeAt(0)))],{type:'audio/midi'});
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=file.name.replace(/\.mp3$/i,'.mid');
    a.click();

    bar.style.width="100%";
    status.textContent="Done. MIDI downloaded.";
    console.log("Conversion complete.");

  } catch(err){
    console.error("Error during conversion:", err);
    status.textContent="Error processing file.";
    bar.style.width="0%";
  }
};
