const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

const STATE_FILE = path.join(__dirname, 'task_state.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const TEMP_DIR = path.join(__dirname, 'temp');

// Create required directories
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Initial default state
let taskState = {
  status: 'idle', // 'idle', 'processing', 'completed', 'failed'
  seriesId: null,
  seriesName: null,
  totalEpisodes: 0,
  currentEpisode: 0,
  progressPercent: 0,
  downloadUrl: null,
  error: null,
  logs: []
};

// Load state from file if exists (for reload persistence)
if (fs.existsSync(STATE_FILE)) {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const saved = JSON.parse(raw);
    // If it was processing and server restarted, set as failed or idle
    if (saved.status === 'processing') {
      saved.status = 'failed';
      saved.error = 'Server restarted during processing.';
    }
    taskState = saved;
  } catch (err) {
    console.error('Error loading task state:', err);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(taskState, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving task state:', err);
  }
}

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] ${message}`;
  console.log(formatted);
  taskState.logs.push(formatted);
  if (taskState.logs.length > 200) {
    taskState.logs.shift(); // Keep logs memory bound
  }
  saveState();
}

// Disk space checker (Windows and Linux)
function getFreeSpaceGB() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('wmic logicaldisk get freespace,caption').toString();
      const lines = out.trim().split('\n');
      for (const line of lines) {
        if (line.includes('C:')) {
          const parts = line.trim().split(/\s+/);
          const freeBytes = parseInt(parts[1], 10);
          return freeBytes / (1024 * 1024 * 1024);
        }
      }
      // If C: isn't found, try other drive letter or parsing first line
      const cleanLines = lines.map(l => l.trim()).filter(l => l.length > 0);
      if (cleanLines.length > 1) {
        const parts = cleanLines[1].split(/\s+/);
        if (parts.length >= 2) {
          const freeBytes = parseInt(parts[1], 10) || parseInt(parts[0], 10);
          return freeBytes / (1024 * 1024 * 1024);
        }
      }
      return 15; // default fallback
    } else {
      // Linux/Unix VPS
      const out = execSync('df -B1 / | tail -n 1').toString();
      const parts = out.trim().split(/\s+/);
      const freeBytes = parseInt(parts[3], 10);
      return freeBytes / (1024 * 1024 * 1024);
    }
  } catch (e) {
    console.error('Disk check error:', e);
    return 15; // default fallback
  }
}

// Clean temporary directory
function cleanTempDir() {
  if (fs.existsSync(TEMP_DIR)) {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEMP_DIR, file));
    }
  }
}

// Express API endpoints
app.get('/api/task-status', (req, res) => {
  res.json({
    ...taskState,
    vpsFreeSpaceGB: getFreeSpaceGB().toFixed(2)
  });
});

app.post('/api/fetch-series', async (req, res) => {
  const { token, seriesId } = req.body;
  if (!token || !seriesId) {
    return res.status(400).json({ error: 'Token and Series ID are required.' });
  }

  try {
    const response = await fetch(`https://api.seriesjeen.online/api/platform/reelshort/allepisodes/${seriesId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API responded with status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/task-start', async (req, res) => {
  const { token, seriesId, seriesName, episodes, settings } = req.body;

  if (taskState.status === 'processing') {
    return res.status(400).json({ error: 'A task is already running. Please wait or cancel the current task.' });
  }

  if (!episodes || episodes.length === 0) {
    return res.status(400).json({ error: 'No episodes provided for processing.' });
  }

  const freeSpace = getFreeSpaceGB();
  if (freeSpace < 4.0) {
    return res.status(400).json({ error: `Not enough disk space on VPS. Remaining: ${freeSpace.toFixed(2)} GB. Need at least 4.0 GB.` });
  }

  // Reset state for new task
  taskState = {
    status: 'processing',
    seriesId,
    seriesName: seriesName || seriesId,
    totalEpisodes: episodes.length,
    currentEpisode: 0,
    progressPercent: 0,
    downloadUrl: null,
    error: null,
    logs: []
  };
  saveState();

  addLog(`Starting new processing task for Series ID: ${seriesId}`);
  addLog(`Total episodes to download: ${episodes.length}`);
  addLog(`Free space on disk: ${freeSpace.toFixed(2)} GB`);

  // Start background task loop
  runTaskPipeline(episodes, settings);

  res.json({ message: 'Task started successfully.', state: taskState });
});

app.post('/api/task-delete', (req, res) => {
  addLog('Request received to delete outputs and reset server state.');
  
  // Reset server state
  const prevFile = taskState.downloadUrl ? path.basename(taskState.downloadUrl) : null;
  
  taskState = {
    status: 'idle',
    seriesId: null,
    seriesName: null,
    totalEpisodes: 0,
    currentEpisode: 0,
    progressPercent: 0,
    downloadUrl: null,
    error: null,
    logs: []
  };
  saveState();

  // Delete downloaded file if exists
  if (prevFile) {
    const filePath = path.join(DOWNLOADS_DIR, prevFile);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        addLog(`Deleted merged output file: ${prevFile}`);
      } catch (err) {
        addLog(`Error deleting file ${prevFile}: ${err.message}`);
      }
    }
  }

  cleanTempDir();
  res.json({ message: 'Task wiped and output files deleted.', state: taskState });
});

// Primary background processing pipeline
async function runTaskPipeline(episodes, settings) {
  try {
    cleanTempDir();
    const tempFiles = [];

    // 1. Process each episode sequentially
    for (let i = 0; i < episodes.length; i++) {
      if (taskState.status !== 'processing') {
        addLog('Processing aborted by user action or system.');
        return;
      }

      const ep = episodes[i];
      taskState.currentEpisode = i + 1;
      taskState.progressPercent = Math.round((i / episodes.length) * 90); // Use 0-90% for conversion, last 10% for merging
      saveState();

      addLog(`[Episode ${i + 1}/${episodes.length}] Starting download & filtering...`);

      const tempFile = path.join(TEMP_DIR, `ep_${String(i + 1).padStart(3, '0')}.ts`);
      
      // Construct Video and Audio Filter Arguments
      let videoFilters = [];
      let mapArgs = [];
      let input2Arg = null;
      let hasOverlay = false;
      let currentInStream = '0:v';
      
      // Overlay filter (Watermark or Black Box)
      if (settings.zones && settings.zones.length > 0) {
        hasOverlay = true;
        
        if (settings.watermarkBase64) {
          // Write base64 to temp file once
          const wmBuffer = Buffer.from(settings.watermarkBase64.split(',')[1], 'base64');
          const wmPath = path.join(TEMP_DIR, 'watermark.png');
          require('fs').writeFileSync(wmPath, wmBuffer);
          input2Arg = wmPath;
        }

        settings.zones.forEach((zone, index) => {
          if (settings.watermarkBase64) {
            videoFilters.push(`[1:v]scale=${zone.w}:${zone.h}[wm${index}]`);
            videoFilters.push(`[${currentInStream}][wm${index}]overlay=x=${zone.x}:y=${zone.y}[v_wm${index}]`);
            currentInStream = `v_wm${index}`;
          } else {
            videoFilters.push(`[${currentInStream}]drawbox=x=${zone.x}:y=${zone.y}:w=${zone.w}:h=${zone.h}:color=black:t=fill[v_box${index}]`);
            currentInStream = `v_box${index}`;
          }
        });
      }
      
      let simpleVf = [];
      // Speed adjustments
      if (settings.speed && settings.speed !== 1.0) {
        const setpts = (1 / settings.speed).toFixed(4);
        simpleVf.push(`setpts=${setpts}*PTS`);
      }
      
      // Color tweaks
      if (settings.contrast !== 1.0 || settings.saturation !== 1.0) {
        simpleVf.push(`eq=contrast=${settings.contrast || 1.0}:saturation=${settings.saturation || 1.0}`);
      }
      
      // Edge crop
      if (settings.crop && settings.crop > 0) {
        simpleVf.push(`crop=in_w-${settings.crop}:in_h-${settings.crop}`);
      }

      // Guarantee even dimensions
      simpleVf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');

      if (hasOverlay) {
        if (simpleVf.length > 0) {
          videoFilters.push(`[${currentInStream}]${simpleVf.join(',')}[v_final]`);
          mapArgs.push('-map', '[v_final]');
        } else {
          mapArgs.push('-map', `[${currentInStream}]`);
        }
        mapArgs.push('-map', '0:a');
      } else {
        if (simpleVf.length > 0) {
          videoFilters.push(simpleVf.join(','));
        }
      }

      // Audio filters
      let audioFilters = [];
      if (settings.speed && settings.speed !== 1.0) {
        if (settings.pitchShift) {
          // Accelerate rate (raises pitch) and keep speed matched
          const rateMultiplier = settings.speed.toFixed(3);
          audioFilters.push(`asetrate=48000*${rateMultiplier}`);
        } else {
          // Accelerate tempo without changing pitch
          const tempo = settings.speed.toFixed(3);
          audioFilters.push(`atempo=${tempo}`);
        }
      }

      const ffmpegArgs = [
        '-y',
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', ep.url
      ];

      if (input2Arg) {
        ffmpegArgs.push('-i', input2Arg);
      }

      if (videoFilters.length > 0) {
        if (hasOverlay) {
          ffmpegArgs.push('-filter_complex', videoFilters.join(';'));
          ffmpegArgs.push(...mapArgs);
        } else {
          ffmpegArgs.push('-vf', videoFilters.join(','));
        }
      }

      if (audioFilters.length > 0) {
        ffmpegArgs.push('-af', audioFilters.join(','));
      }

      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '24',
        '-r', '30',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        tempFile
      );

      // Run FFmpeg child process
      await runFFmpegPromise(ffmpegArgs, `Ep ${i + 1}`);
      tempFiles.push(tempFile);
      addLog(`[Episode ${i + 1}/${episodes.length}] Finished successfully.`);
    }

    // 2. Concatenate all .ts files into final MP4
    if (taskState.status !== 'processing') return;
    
    addLog('All episodes downloaded and filtered. Starting final merge (concatenation)...');
    taskState.progressPercent = 95;
    saveState();

    // Create file list for concatenation
    const listFile = path.join(TEMP_DIR, 'concat_list.txt');
    const listContent = tempFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFile, listContent, 'utf8');

    const cleanName = (taskState.seriesName || 'series').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const finalFileName = `${cleanName}_${taskState.seriesId}.mp4`;
    const finalFilePath = path.join(DOWNLOADS_DIR, finalFileName);

    const mergeArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      finalFilePath
    ];

    await runFFmpegPromise(mergeArgs, 'Final Merge');

    // Finished! Update states
    taskState.status = 'completed';
    taskState.progressPercent = 100;
    taskState.downloadUrl = `/downloads/${finalFileName}`;
    saveState();

    addLog(`Task completed successfully! Merged video is ready.`);
    
    // Cleanup temporary files
    cleanTempDir();

  } catch (err) {
    addLog(`Pipeline Error: ${err.message}`);
    taskState.status = 'failed';
    taskState.error = err.message;
    saveState();
  }
}

// Wrapper to track FFmpeg execution
function runFFmpegPromise(args, taskLabel) {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', args);
    let errorLog = '';

    process.stderr.on('data', (data) => {
      // FFmpeg prints logs to stderr
      errorLog += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Truncate long error output to keep logs readable
        const shortError = errorLog.split('\n').slice(-6).join('\n');
        reject(new Error(`FFmpeg [${taskLabel}] failed with exit code ${code}.\nError details:\n${shortError}`));
      }
    });
  });
}

// Daily automatic cleanup cron (24 hours)
setInterval(() => {
  console.log('Running daily automatic storage cleanup...');
  if (fs.existsSync(DOWNLOADS_DIR)) {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(DOWNLOADS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > oneDay) {
          fs.unlinkSync(filePath);
          console.log(`Auto-cleaned old file: ${file}`);
        }
      } catch (err) {
        console.error(`Error in auto-cleanup of ${file}:`, err);
      }
    }
  }
}, 60 * 60 * 1000); // Check hourly

app.listen(PORT, () => {
  console.log(`Reelshort server running on http://localhost:${PORT}`);
});
