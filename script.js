console.log("Script loaded");

function waitForJSMIDGEN(timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      console.log("Checking for JSMIDGEN...");
      if (window.JSMIDGEN) {
        console.log("JSMIDGEN found!");
        resolve();
      } else if (Date.now() - start > timeout) {
        console.error("JSMIDGEN failed to load within timeout");
        reject("JSMIDGEN failed to load");
      } else {
        requestAnimationFrame(check);
      }
    }
    check();
  });
}

(async () => {
  try {
    await waitForJSMIDGEN();
    console.log("Starting main script");

    async function getAudioBuffer(file) {
      console.log("Creating AudioContext");
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") {
        console.log("Resuming AudioContext");
        await ctx.resume();
      }
      console.log("Reading file arrayBuffer");
      const arrayBuffer = await file.arrayBuffer();
      console.log("Decoding audio data...");
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      console.log("Audio decoded, length:", buffer.length);
      return buffer;
    }

    function quantize(values, numBins) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const step = (max - min) / numBins;
      console.log(`Quantizing values into ${numBins} bins (min=${min}, max=${max}, step=${step})`);
      return values.map(v => Math.round((v - min) / step));
    }

    document.getElementById('convertBtn').onclick = async () => {
      console.log("Convert button clicked");
      const file = document.getElementById('fileInput').files[0];
      const numNotes = parseInt(document.getElementById('numNotes').value);
      const status = document.getElementById('status');
      const bar = document.getElementById('progressBar');
      const container = document.getElementById('progressContainer');

      if (!file) {
        console.warn("No file selected");
        alert("Select an MP3 first.");
        return;
      }

      console.log("File selected:", file.name);
      container.style.display = "block";
      bar.style.width = "0%";
      status.textContent = "Preparing…";
      await new Promise(r => setTimeout(r, 50));

      try {
        status.textContent = "Decoding audio…";
        bar.style.width = "5%";
        console.log("Decoding audio...");
        const buffer = await getAudioBuffer(file);

        status.textContent = "Analyzing…";
        console.log("Analyzing audio, length:", buffer.length);
        const data = buffer.getChannelData(0);
        const frameSize = 2048;
        const hop = 1024;
        const sampleRate = buffer.sampleRate;
        const pitches = [];
        let nextUpdate = 0;

        for (let i = 0; i < data.length - frameSize; i += hop) {
          if (i % 100000 === 0) console.log("Processing frame at index:", i);
          const frame = data.slice(i, i + frameSize);
          const mag = frame.map(v => Math.abs(v));
          const maxIdx = mag.indexOf(Math.max(...mag));
          const freq = maxIdx * (sampleRate / frameSize);
          if (freq > 50 && freq < 2000) pitches.push(69 + 12 * Math.log2(freq / 440));

          const progress = (i / (data.length - frameSize)) * 90 + 5;
          if (progress > nextUpdate) {
            bar.style.width = progress.toFixed(1) + "%";
            nextUpdate += 1;
            await new Promise(r => setTimeout(r, 0));
          }
        }

        console.log("Audio analysis complete. Detected pitches:", pitches.length);

        if (pitches.length === 0) {
          status.textContent = "No tonal content detected.";
          bar.style.width = "0%";
          console.warn("No tonal content detected");
          return;
        }

        status.textContent = "Building MIDI…";
        bar.style.width = "95%";
        console.log("Quantizing pitches...");
        const q = quantize(pitches, numNotes);
        const uniqueBins = [...new Set(q)];
        console.log("Unique bins:", uniqueBins.length);

        console.log("Building MIDI with JSMIDGEN...");
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
        track.addNote(0, uniqueBins[last] + 60, duration);

        console.log("Generating blob for download...");
        const midiData = fileMidi.toBytes();
        const blob = new Blob([new Uint8Array(midiData.split('').map(c => c.charCodeAt(0)))], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name.replace(/\.mp3$/i, '.mid');
        a.click();

        bar.style.width = "100%";
        status.textContent = "Done. MIDI downloaded.";
        console.log("Conversion complete.");

      } catch (err) {
        console.error("Error during conversion:", err);
        status.textContent = "Error processing file.";
        bar.style.width = "0%";
      }
    };

  } catch (e) {
    console.error("Failed to initialize script:", e);
    alert("Failed to load JSMIDGEN library.");
  }
})();
