async function getAudioBuffer(file) {
    const ctx = new AudioContext();
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
    if (!file) return alert("Select an MP3 first.");
  
    status.textContent = "Decoding audio…";
    bar.style.width = "0%";
  
    const buffer = await getAudioBuffer(file);
    const data = buffer.getChannelData(0);
  
    // Processing setup
    const frameSize = 2048;
    const hop = 1024;
    const sampleRate = buffer.sampleRate;
    const pitches = [];
    const totalFrames = Math.floor((data.length - frameSize) / hop);
    let nextUpdate = 0;
  
    status.textContent = "Extracting pitches…";
  
    for (let i = 0; i < data.length - frameSize; i += hop) {
      const frame = data.slice(i, i + frameSize);
      // Simple magnitude spectrum to find peak
      const mag = frame.map(v => Math.abs(v));
      const maxIdx = mag.indexOf(Math.max(...mag));
      const freq = maxIdx * (sampleRate / frameSize);
      if (freq > 50 && freq < 2000) pitches.push(69 + 12 * Math.log2(freq / 440));
  
      const progress = (i / (data.length - frameSize)) * 100;
      if (progress > nextUpdate) {
        bar.style.width = progress.toFixed(1) + "%";
        nextUpdate += 1; // update every ~1%
        await new Promise(r => setTimeout(r, 0)); // yield to render
      }
    }
  
    if (pitches.length === 0) {
      status.textContent = "No tonal content detected.";
      bar.style.width = "0%";
      return;
    }
  
    status.textContent = "Building MIDI…";
    const q = quantize(pitches, numNotes);
    const uniqueBins = [...new Set(q)];
  
    const { Track, Writer, NoteEvent } = window.MidiWriter;
    const track = new Track();
    let last = q[0];
    let duration = 1;
    for (let i = 1; i < q.length; i++) {
      if (q[i] === last) duration++;
      else {
        track.addEvent(new NoteEvent({ pitch: [uniqueBins[last] + 60], duration: 'T' + duration }));
        last = q[i];
        duration = 1;
      }
    }
  
    const writer = new Writer(track);
    const blob = new Blob([writer.buildFile()], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/\.mp3$/i, '.mid');
    a.click();
  
    bar.style.width = "100%";
    status.textContent = "Done. MIDI downloaded.";
  };
  