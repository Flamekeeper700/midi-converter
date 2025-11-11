console.log("Script loaded");

// Minimal JS MIDI generator
class MidiFile {
  constructor() { this.tracks = []; }
  addTrack(track) { this.tracks.push(track); }
  toBytes() {
    const header = [0x4d,0x54,0x68,0x64, 0x00,0x00,0x00,0x06, 0x00,0x01, 0x00,this.tracks.length, 0x01,0xe0]; // 480 ticks per quarter
    let bytes = [...header];
    for(const t of this.tracks) bytes.push(...t.toBytes());
    return bytes.map(b=>String.fromCharCode(b)).join('');
  }
}

class MidiTrack {
  constructor() { this.events = []; }
  addNote(channel, note, duration) {
    this.events.push(0x00, 0x90 | channel, note, 0x64); // note on
    this.events.push(duration, 0x80 | channel, note, 0x40); // note off
  }
  toBytes() {
    const data = [...this.events];
    const len = data.length;
    const header = [0x4d,0x54,0x72,0x6b, (len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff];
    return [...header,...data];
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
  const speed = parseFloat(document.getElementById('speed').value) || 1;
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

    // Compute ticks per frame to match song duration
    const totalFrames = Math.ceil(data.length / hop);
    const desiredSeconds = data.length / sampleRate / speed;
    const bpm = 120;
    const ticksPerQuarter = 480;
    const secondsPerTick = 60 / (bpm * ticksPerQuarter);
    const ticksPerFrame = Math.max(1, Math.round((desiredSeconds / totalFrames) / secondsPerTick));

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
