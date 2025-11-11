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
    if (!file) return alert("Select an MP3 first.");
  
    status.textContent = "Processing audio…";
  
    const buffer = await getAudioBuffer(file);
    const data = buffer.getChannelData(0);
  
    // crude pitch estimate (FFT magnitude peaks)
    const frameSize = 2048;
    const hop = 1024;
    const sampleRate = buffer.sampleRate;
    const pitches = [];
    for (let i = 0; i < data.length - frameSize; i += hop) {
      const frame = data.slice(i, i + frameSize);
      const fft = new Float32Array(frameSize);
      const re = new Float32Array(frameSize);
      for (let j = 0; j < frameSize; j++) re[j] = frame[j];
      const mag = re.map(v => Math.abs(v));
      const maxIdx = mag.indexOf(Math.max(...mag));
      const freq = maxIdx * (sampleRate / frameSize);
      if (freq > 50 && freq < 2000) pitches.push(69 + 12 * Math.log2(freq / 440));
    }
  
    if (pitches.length === 0) {
      status.textContent = "No tonal content detected.";
      return;
    }
  
    // quantize into N bins
    const q = quantize(pitches, numNotes);
    const uniqueBins = [...new Set(q)];
  
    // Build MIDI
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
  
    status.textContent = "Done. MIDI downloaded.";
  };
  