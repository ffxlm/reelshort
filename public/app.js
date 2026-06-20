// DOM Elements
const videoEl = document.getElementById('preview-video');
const canvasEl = document.getElementById('canvas-overlay');
const ctx = canvasEl.getContext('2d');
const videoPlaceholder = document.getElementById('video-placeholder');
const coordsDisplay = document.getElementById('coords-display');
const clearBlurBtn = document.getElementById('clear-blur-btn');
const cmdPreview = document.getElementById('cmd-preview');

// Forms & Inputs
const apiTokenInput = document.getElementById('api-token');
const seriesIdInput = document.getElementById('series-id');
const fetchSeriesBtn = document.getElementById('fetch-series-btn');
const seriesInfoCard = document.getElementById('series-info-card');
const seriesTitleEl = document.getElementById('series-title');
const episodeCountInfo = document.getElementById('episode-count-info');
const episodeSelect = document.getElementById('episode-select');

// Filters Sliders
const speedSlider = document.getElementById('speed-slider');
const speedVal = document.getElementById('speed-val');
const pitchCheckbox = document.getElementById('pitch-checkbox');
const saturationSlider = document.getElementById('saturation-slider');
const saturationVal = document.getElementById('saturation-val');
const contrastSlider = document.getElementById('contrast-slider');
const contrastVal = document.getElementById('contrast-val');
const cropSlider = document.getElementById('crop-slider');
const cropVal = document.getElementById('crop-val');

// Status controls
const vpsInfo = document.getElementById('vps-info');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusDesc = document.getElementById('status-desc');
const statusBox = document.getElementById('task-status-box');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressTextPercent = document.getElementById('progress-text-percent');
const startTaskBtn = document.getElementById('start-task-btn');
const completedBox = document.getElementById('completed-box');
const downloadLink = document.getElementById('download-link');
const deleteTaskBtn = document.getElementById('delete-task-btn');
const logsConsole = document.getElementById('logs-console');

// Application State
let activeSeries = null;
let episodesList = []; // Clean list of { episode, url }
let isDrawing = false;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

// Coordinates mapped to displayed screen (scaled on submit)
let scaleFactors = { x: 1, y: 1 };

// Hls instance
let hlsInstance = null;

// Initialize app
function init() {
  loadSavedCredentials();
  setupEventListeners();
  pollStatus();
  setInterval(pollStatus, 3000); // Check status every 3 seconds
}

// Load token and series ID if saved in localStorage
function loadSavedCredentials() {
  const savedToken = localStorage.getItem('reelshort_token');
  const savedSeriesId = localStorage.getItem('reelshort_series_id');
  if (savedToken) apiTokenInput.value = savedToken;
  if (savedSeriesId) seriesIdInput.value = savedSeriesId;
}

function saveCredentials(token, seriesId) {
  localStorage.setItem('reelshort_token', token);
  localStorage.setItem('reelshort_series_id', seriesId);
}

// Find H264 stream from the streams array (usually contains /vod-)
function getH264StreamUrl(streams) {
  if (!streams || streams.length === 0) return '';
  // Look for 720p streams containing /vod- (H.264 codec verified)
  const preferred = streams.find(s => s.quality === '720p' && s.url.includes('/vod-'));
  if (preferred) return preferred.url;

  // Fallback 1: 720p and doesn't contain '-video-' (HEVC stream naming indicator)
  const fb1 = streams.find(s => s.quality === '720p' && !s.url.includes('-video-'));
  if (fb1) return fb1.url;

  // Fallback 2: Any 720p stream
  const fb2 = streams.find(s => s.quality === '720p');
  if (fb2) return fb2.url;

  // Ultimate fallback
  return streams[0].url;
}

// API: Fetch series details
async function fetchSeries() {
  const token = apiTokenInput.value.trim();
  const seriesId = seriesIdInput.value.trim();

  if (!token || !seriesId) {
    alert('Please enter both Bearer Token and Series ID.');
    return;
  }

  saveCredentials(token, seriesId);
  fetchSeriesBtn.disabled = true;
  fetchSeriesBtn.textContent = 'Fetching...';

  try {
    const response = await fetch('/api/fetch-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, seriesId })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }

    if (!data.episodes || data.episodes.length === 0) {
      throw new Error('No episodes returned from API.');
    }

    activeSeries = data;
    
    // Process episodes list to select H.264 stream URL
    episodesList = data.episodes.map(ep => ({
      episode: ep.episode,
      name: ep.name || `Episode ${ep.episode}`,
      url: getH264StreamUrl(ep.streams)
    })).filter(ep => ep.url !== '');

    addSystemLog(`Fetched series: "${data.lang ? 'Series (' + data.lang + ')' : 'Series'}" with ${episodesList.length} episodes.`);
    
    // Update UI
    seriesTitleEl.textContent = `Series ID: ${seriesId}`;
    episodeCountInfo.textContent = `Total episodes found: ${episodesList.length}`;
    
    // Populate Select Options
    episodeSelect.innerHTML = '';
    episodesList.forEach((ep, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${ep.name} (720p)`;
      episodeSelect.appendChild(opt);
    });

    seriesInfoCard.classList.remove('hidden');
    startTaskBtn.disabled = false;

    // Load first episode in preview player
    loadPreviewVideo(episodesList[0].url);

  } catch (error) {
    alert(`Failed to fetch series: ${error.message}`);
    addSystemLog(`Error: ${error.message}`);
  } finally {
    fetchSeriesBtn.disabled = false;
    fetchSeriesBtn.textContent = 'Fetch Series Episodes';
  }
}

// Load HLS stream in preview player
function loadPreviewVideo(m3u8Url) {
  videoPlaceholder.classList.add('hidden');
  
  if (hlsInstance) {
    hlsInstance.destroy();
  }

  if (Hls.isSupported()) {
    hlsInstance = new Hls();
    hlsInstance.loadSource(m3u8Url);
    hlsInstance.attachMedia(videoEl);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      // Play is muted, safe to autoplay
      videoEl.play();
    });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari native support
    videoEl.src = m3u8Url;
    videoEl.addEventListener('canplay', () => {
      videoEl.play();
    });
  }

  // Once video metadata is loaded, sync canvas bounds
  videoEl.onloadedmetadata = () => {
    resizeCanvasOverlay();
    clearBlurBox(); // Clear coordinates when changing videos
  };
}

let drawnZones = [];

// Coordinates Drawing and Canvas Math
function resizeCanvasOverlay() {
  canvasEl.width = videoEl.clientWidth;
  canvasEl.height = videoEl.clientHeight;
  drawOverlay();
}

function getCoords(e) {
  const rect = canvasEl.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function handleStart(e) {
  if (videoEl.readyState < 2) return; // Video not loaded
  isDrawing = true;
  const coords = getCoords(e);
  startX = coords.x;
  startY = coords.y;
  currentX = coords.x;
  currentY = coords.y;
}

function handleMove(e) {
  if (!isDrawing) return;
  const coords = getCoords(e);
  currentX = coords.x;
  currentY = coords.y;
  drawOverlay();
}

function handleEnd() {
  if (!isDrawing) return;
  isDrawing = false;
  
  // Calculate bounding box properties
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);

  if (w > 10 && h > 10) {
    drawnZones.push({ displayCoords: { x, y, w, h } });
    calculateActualCoords();
    clearBlurBtn.disabled = false;
  }
  drawOverlay();
}

function calculateActualCoords() {
  if (drawnZones.length === 0 || !videoEl.videoWidth) return;
  
  // Resolution scaling factor (actual video res e.g. 720x1280 divided by displayed dimensions)
  scaleFactors.x = videoEl.videoWidth / videoEl.clientWidth;
  scaleFactors.y = videoEl.videoHeight / videoEl.clientHeight;

  drawnZones.forEach(zone => {
    let aCoords = {
      x: Math.round(zone.displayCoords.x * scaleFactors.x),
      y: Math.round(zone.displayCoords.y * scaleFactors.y),
      w: Math.round(zone.displayCoords.w * scaleFactors.x),
      h: Math.round(zone.displayCoords.h * scaleFactors.y)
    };

    // Limit bounds to actual video boundaries
    aCoords.x = Math.max(0, Math.min(videoEl.videoWidth, aCoords.x));
    aCoords.y = Math.max(0, Math.min(videoEl.videoHeight, aCoords.y));
    aCoords.w = Math.min(videoEl.videoWidth - aCoords.x, aCoords.w);
    aCoords.h = Math.min(videoEl.videoHeight - aCoords.y, aCoords.h);
    
    zone.actualCoords = aCoords;
  });

  coordsDisplay.textContent = `${drawnZones.length} Zone(s) Selected`;
  updateFFmpegCommandPreview();
}

function drawOverlay() {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  
  drawnZones.forEach(zone => {
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2;
    ctx.setLineDash([0]);
    ctx.strokeRect(zone.displayCoords.x, zone.displayCoords.y, zone.displayCoords.w, zone.displayCoords.h);
    ctx.fillStyle = 'rgba(217, 119, 6, 0.2)';
    ctx.fillRect(zone.displayCoords.x, zone.displayCoords.y, zone.displayCoords.w, zone.displayCoords.h);
  });
  
  if (isDrawing) {
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
  }
}

// File Upload Logic
const watermarkUpload = document.getElementById('watermark-upload');
const watermarkFileName = document.getElementById('watermark-file-name');
let watermarkBase64 = null;

watermarkUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    watermarkFileName.textContent = `Logo selected: ${file.name}`;
    const reader = new FileReader();
    reader.onload = (ev) => {
      watermarkBase64 = ev.target.result;
      updateFFmpegCommandPreview();
    };
    reader.readAsDataURL(file);
  } else {
    watermarkBase64 = null;
    watermarkFileName.textContent = '';
    updateFFmpegCommandPreview();
  }
});

function clearBlurBox() {
  drawnZones = [];
  coordsDisplay.textContent = 'None';
  clearBlurBtn.disabled = true;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  updateFFmpegCommandPreview();
}

// Live Command Line Generator
function updateFFmpegCommandPreview() {
  const speed = parseFloat(speedSlider.value);
  const saturation = parseFloat(saturationSlider.value);
  const contrast = parseFloat(contrastSlider.value);
  const crop = parseInt(cropSlider.value, 10);
  const pitch = pitchCheckbox.checked;

  let vf = [];
  let mapArgs = '';
  let currentInStream = '0:v';
  
  if (drawnZones.length > 0) {
    drawnZones.forEach((zone, i) => {
      const a = zone.actualCoords;
      if (watermarkBase64) {
        // Custom watermark image overlay
        vf.push(`[1:v]scale=${a.w}:${a.h}[wm${i}]`);
        vf.push(`[${currentInStream}][wm${i}]overlay=x=${a.x}:y=${a.y}[v_wm${i}]`);
        currentInStream = `v_wm${i}`;
      } else {
        // Fallback to solid black box
        vf.push(`[${currentInStream}]drawbox=x=${a.x}:y=${a.y}:w=${a.w}:h=${a.h}:color=black:t=fill[v_box${i}]`);
        currentInStream = `v_box${i}`;
      }
    });
    mapArgs = ` -map "[${currentInStream}]"`;
  }

  // Chain other filters if needed
  let simpleVf = [];
  if (speed !== 1.0) {
    simpleVf.push(`setpts=${(1/speed).toFixed(4)}*PTS`);
  }
  if (contrast !== 1.0 || saturation !== 1.0) {
    simpleVf.push(`eq=contrast=${contrast}:saturation=${saturation}`);
  }
  if (crop > 0) {
    simpleVf.push(`crop=in_w-${crop}:in_h-${crop}`);
  }
  simpleVf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');

  let af = [];
  if (speed !== 1.0) {
    if (pitch) {
      af.push(`asetrate=48000*${speed}`);
    } else {
      af.push(`atempo=${speed}`);
    }
  }

  let filterComplexString = '';
  if (drawnZones.length > 0) {
    if (simpleVf.length > 0) {
      vf.push(`[${currentInStream}]${simpleVf.join(',')}[v_final]`);
      mapArgs = ' -map "[v_final]"';
    }
    filterComplexString = ` -filter_complex "${vf.join(';')}"${mapArgs}`;
  } else if (simpleVf.length > 0) {
    filterComplexString = ` -vf "${simpleVf.join(',')}"`;
  }

  let afArg = af.length > 0 ? ` -af "${af.join(',')}"` : '';
  let input2Arg = (drawnZones.length > 0 && watermarkBase64) ? ' -i "watermark.png"' : '';

  cmdPreview.textContent = `ffmpeg -i "ep01.m3u8"${input2Arg}${filterComplexString}${afArg} -c:v libx264 -preset ultrafast -crf 24 -r 30 -pix_fmt yuv420p -c:a aac output.ts`;
}

// System Status Poller
async function pollStatus() {
  try {
    const res = await fetch('/api/task-status');
    const state = await res.json();

    // Update VPS Storage Badge
    vpsInfo.textContent = `VPS Storage: ${state.vpsFreeSpaceGB} GB Free`;
    if (parseFloat(state.vpsFreeSpaceGB) < 4.0) {
      vpsInfo.style.borderColor = 'var(--border-danger)';
      vpsInfo.style.color = 'var(--text-danger)';
    } else {
      vpsInfo.style.borderColor = 'var(--border)';
      vpsInfo.style.color = 'var(--text-main)';
    }

    // Set class lists dynamically on status block
    statusBox.className = `status-box status-${state.status}`;
    statusText.textContent = state.status;

    // Output logs
    if (state.logs && state.logs.length > 0) {
      const isAtBottom = logsConsole.scrollHeight - logsConsole.clientHeight <= logsConsole.scrollTop + 50;
      logsConsole.textContent = state.logs.join('\n');
      if (isAtBottom) {
        logsConsole.scrollTop = logsConsole.scrollHeight;
      }
    }

    if (state.status === 'processing') {
      statusDesc.textContent = `Currently downloading & processing "${state.seriesName}". Do not close this window (safe to reload).`;
      progressContainer.classList.remove('hidden');
      progressTextPercent.classList.remove('hidden');
      progressFill.style.width = `${state.progressPercent}%`;
      progressTextPercent.textContent = `Episode ${state.currentEpisode}/${state.totalEpisodes} (${state.progressPercent}% Completed)`;

      // Disable actions during run
      startTaskBtn.disabled = true;
      fetchSeriesBtn.disabled = true;
      completedBox.classList.add('hidden');
    } 
    else if (state.status === 'completed') {
      statusDesc.textContent = `Processing for "${state.seriesName}" completed successfully! Download your file below.`;
      progressContainer.classList.add('hidden');
      progressTextPercent.classList.add('hidden');
      
      startTaskBtn.disabled = true;
      completedBox.classList.remove('hidden');
      downloadLink.href = state.downloadUrl;
    } 
    else if (state.status === 'failed') {
      statusDesc.textContent = `Task failed. Error: ${state.error}`;
      progressContainer.classList.add('hidden');
      progressTextPercent.classList.add('hidden');

      startTaskBtn.disabled = false;
      fetchSeriesBtn.disabled = false;
      completedBox.classList.remove('hidden'); // Show wipe button so they can retry
      downloadLink.classList.add('hidden');     // Hide download since it failed
    } 
    else {
      // Idle state
      statusDesc.textContent = 'Server is standby. Awaiting configuration.';
      progressContainer.classList.add('hidden');
      progressTextPercent.classList.add('hidden');
      completedBox.classList.add('hidden');
      downloadLink.classList.remove('hidden'); // Reset download visual

      fetchSeriesBtn.disabled = false;
      if (activeSeries) {
        startTaskBtn.disabled = false;
      }
    }

  } catch (error) {
    console.error('Error polling status:', error);
    statusText.textContent = 'Disconnected';
    statusDesc.textContent = 'Unable to reach backend. Check if node server.js is running.';
  }
}

// Start Processing Task
async function startTask() {
  if (!activeSeries || episodesList.length === 0) return;

  const confirmRun = confirm(`Start downloading and processing ${episodesList.length} episodes?\n\nFFmpeg processing will run in the background on the server.`);
  if (!confirmRun) return;

  const settings = {
    zones: drawnZones.map(z => z.actualCoords),
    speed: parseFloat(speedSlider.value),
    pitchShift: pitchCheckbox.checked,
    saturation: parseFloat(saturationSlider.value),
    contrast: parseFloat(contrastSlider.value),
    crop: parseInt(cropSlider.value, 10),
    watermarkBase64: watermarkBase64
  };

  try {
    const res = await fetch('/api/task-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: apiTokenInput.value.trim(),
        seriesId: seriesIdInput.value.trim(),
        seriesName: activeSeries.lang ? `Series_${activeSeries.lang}` : 'Series',
        episodes: episodesList,
        settings
      })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    
    pollStatus();
  } catch (error) {
    alert(`Error starting task: ${error.message}`);
  }
}

// Delete and reset server
async function deleteTask() {
  const confirmWipe = confirm('Are you sure you want to delete the output MP4 and clean up VPS disk space? This cannot be undone.');
  if (!confirmWipe) return;

  try {
    const res = await fetch('/api/task-delete', { method: 'POST' });
    const data = await res.json();
    alert('Server space wiped successfully.');
    clearBlurBox();
    pollStatus();
  } catch (error) {
    alert(`Wipe error: ${error.message}`);
  }
}

function addSystemLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const formatted = `[${timestamp}] [Browser] ${msg}`;
  logsConsole.textContent += `\n${formatted}`;
  logsConsole.scrollTop = logsConsole.scrollHeight;
}

// Register Listeners
function setupEventListeners() {
  fetchSeriesBtn.addEventListener('click', fetchSeries);
  startTaskBtn.addEventListener('click', startTask);
  deleteTaskBtn.addEventListener('click', deleteTask);
  clearBlurBtn.addEventListener('click', clearBlurBox);

  // Selector dropdown
  episodeSelect.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (episodesList[idx]) {
      addSystemLog(`Swapping preview source to Episode ${episodesList[idx].episode}`);
      loadPreviewVideo(episodesList[idx].url);
    }
  });

  // Slider controls update values
  speedSlider.addEventListener('input', (e) => {
    speedVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
    updateFFmpegCommandPreview();
  });
  pitchCheckbox.addEventListener('change', updateFFmpegCommandPreview);
  
  saturationSlider.addEventListener('input', (e) => {
    saturationVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
    updateFFmpegCommandPreview();
  });
  
  contrastSlider.addEventListener('input', (e) => {
    contrastVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
    updateFFmpegCommandPreview();
  });
  
  cropSlider.addEventListener('input', (e) => {
    cropVal.textContent = `${e.target.value}px`;
    updateFFmpegCommandPreview();
  });

  // Drag and draw blur region (Mouse)
  canvasEl.addEventListener('mousedown', handleStart);
  canvasEl.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleEnd);

  // Drag and draw blur region (Touch/Mobile)
  canvasEl.addEventListener('touchstart', handleStart);
  canvasEl.addEventListener('touchmove', handleMove);
  canvasEl.addEventListener('touchend', handleEnd);

  // Sync canvas size on screen resize
  window.addEventListener('resize', resizeCanvasOverlay);
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);
