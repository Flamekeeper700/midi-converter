async function getAudioBuffer(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") await ctx.resume();
  const arrayBuffer = await file.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

function quantize(values, numBins) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / numBins;
  return values.map(v => Math.round((v - min) / step));
}

document.getElementById('convertBtn').onclick = async () => {
  const file = document.getElementById('fileInput').files[0];
  const numNotes = parseInt(document.getElementById('numNotes').value);
  const status = document.getElementById('status');
  const bar = document.getElementById('progressBar');
  const container = document.getElementById('progressContainer');

  if (!file) {
    alert("Select an MP3 first.");
    return;
  }

  container.style.display = "block";
  bar.style.width = "0%";
  status.textContent = "Preparing…";
  await new Promise(r => setTimeout(r, 50)); // let DOM render

  try {
    status.textContent = "Decoding audio…";
    bar.style.width = "5%";
    const buffer = await getAudioBuffer(file);

    status.textContent = "Analyzing…";
    const data = buffer.getChannelData(0);
    const frameSize = 2048;
    const hop = 1024;
    const sampleRate = buffer.sampleRate;
    const pitches = [];
    let nextUpdate = 0;

    for (let i = 0; i < data.length - frameSize; i += hop) {
      const frame = data.slice(i, i + frameSize);
      const mag = frame.map(v => Math.abs(v));
      const maxIdx = mag.indexOf(Math.max(...mag));
      const freq = maxIdx * (sampleRate / frameSize);
      if (freq > 50 && freq < 2000) pitches.push(69 + 12 * Math.log2(freq / 440));

      const progress = (i / (data.length - frameSize)) * 90 + 5;
      if (progress > nextUpdate) {
        bar.style.width = progress.toFixed(1) + "%";
        nextUpdate += 1;
        await new Promise(r => setTimeout(r, 0)); // yield to render
      }
    }

    if (pitches.length === 0) {
      status.textContent = "No tonal content detected.";
      bar.style.width = "0%";
      return;
    }

    status.textContent = "Building MIDI…";
    bar.style.width = "95%";

    const q = quantize(pitches, numNotes);
    const uniqueBins = [...new Set(q)];

    // Build MIDI file using jsmidgen
    const fileMidi = new JSMIDGEN.File();
    const track = new JSMIDGEN.Track();
    fileMidi.addTrack(track);

    let last = q[0];
    let duration = 1;
    for (let i = 1; i < q.length; i++) {
      if (q[i] === last) duration++;
      else {
        track.addNote(0, uniqueBins[last] + 60, duration);
        last = q[i];
        duration = 1;
      }
    }
    // Add last note
    track.addNote(0, uniqueBins[last] + 60, duration);

    const midiData = fileMidi.toBytes();
    const blob = new Blob([new Uint8Array(midiData.split('').map(c => c.charCodeAt(0)))], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/\.mp3$/i, '.mid');
    a.click();

    bar.style.width = "100%";
    status.textContent = "Done. MIDI downloaded.";
  } catch (err) {
    console.error(err);
    status.textContent = "Error processing file.";
    bar.style.width = "0%";
  }
};
