// DOM Elements
const videoEl = document.getElementById('preview-video');
const canvasEl = document.getElementById('canvas-overlay');
const ctx = canvasEl.getContext('2d');
const videoPlaceholder = document.getElementById('video-placeholder');
const coordsDisplay = document.getElementById('coords-display');
const clearBlurBtn = document.getElementById('clear-blur-btn');
const cmdPreview = document.getElementById('cmd-preview');
const playerControlsContainer = document.getElementById('player-controls');
const playPauseBtn = document.getElementById('play-pause-btn');
const videoSeekSlider = document.getElementById('video-seek-slider');
const videoTimeDisplay = document.getElementById('video-time-display');

// Forms & Inputs
const apiTokenInput = document.getElementById('api-token');
const seriesIdInput = document.getElementById('series-id');
const fetchSeriesBtn = document.getElementById('fetch-series-btn');
const seriesInfoCard = document.getElementById('series-info-card');
const seriesTitleEl = document.getElementById('series-title');
const episodeCountInfo = document.getElementById('episode-count-info');
const episodeSelect = document.getElementById('episode-select');

// Episode Selector DOM Elements
const episodesCheckboxContainer = document.getElementById('episodes-checkbox-container');
const selectAllEpsBtn = document.getElementById('select-all-eps-btn');
const selectNoneEpsBtn = document.getElementById('select-none-eps-btn');
const rangeStartInput = document.getElementById('range-start');
const rangeEndInput = document.getElementById('range-end');
const applyRangeBtn = document.getElementById('apply-range-btn');
const selectedSummaryText = document.getElementById('selected-summary-text');


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
const downloadsListContainer = document.getElementById('downloads-list-container');
const logsConsole = document.getElementById('logs-console');

// Application State
let activeSeries = null;
let episodesList = []; // Clean list of { episode, url }
let selectedEpisodesState = []; // Track checkbox states [true, false, ...]

// Render Checkboxes for Episode Selection
function renderEpisodesCheckboxes() {
  episodesCheckboxContainer.innerHTML = '';
  selectedEpisodesState = new Array(episodesList.length).fill(true); // default: select all

  episodesList.forEach((ep, idx) => {
    const item = document.createElement('div');
    item.className = 'episode-checkbox-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `ep-checkbox-${idx}`;
    cb.checked = true;
    cb.dataset.index = idx;

    cb.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      selectedEpisodesState[index] = e.target.checked;
      updateSelectedSummary();
    });

    const label = document.createElement('label');
    label.htmlFor = `ep-checkbox-${idx}`;

    const span = document.createElement('span');
    span.textContent = `${ep.name}`;

    label.appendChild(span);
    item.appendChild(cb);
    item.appendChild(label);
    episodesCheckboxContainer.appendChild(item);
  });

  // Default set range values in the helper inputs
  if (episodesList.length > 0) {
    rangeStartInput.value = 1;
    rangeEndInput.value = episodesList.length;
  }

  updateSelectedSummary();
}

function updateSelectedSummary() {
  const selectedCount = selectedEpisodesState.filter(Boolean).length;
  selectedSummaryText.textContent = `${selectedCount} / ${episodesList.length} episodes selected`;
  
  if (selectedCount === 0) {
    startTaskBtn.disabled = true;
    startTaskBtn.textContent = 'Select at least 1 episode';
  } else {
    startTaskBtn.textContent = 'Start Processing Series';
  }
}

let isDrawingNew = false;
let isDragging = false;
let isResizing = null; // 'nw', 'ne', 'se', 'sw'
let selectedZoneIndex = null;
let dragStartMouse = { x: 0, y: 0 };
let dragStartCoords = { x: 0, y: 0, w: 0, h: 0 };

let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;

// Coordinates mapped to displayed screen (scaled on submit)
let scaleFactors = { x: 1, y: 1 };

// Hls instance
let hlsInstance = null;

// Watermark Image object
let watermarkImg = new Image();

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

    renderEpisodesCheckboxes();

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
  playerControlsContainer.classList.remove('hidden');
  
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

function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

let drawnZones = [];

// Coordinates Drawing and Canvas Math
function resizeCanvasOverlay() {
  if (!videoEl.videoWidth) return;
  
  canvasEl.width = videoEl.clientWidth;
  canvasEl.height = videoEl.clientHeight;
  canvasEl.style.width = videoEl.clientWidth + 'px';
  canvasEl.style.height = videoEl.clientHeight + 'px';
  canvasEl.style.left = videoEl.offsetLeft + 'px';
  canvasEl.style.top = videoEl.offsetTop + 'px';
  
  drawOverlay();
}

const HANDLE_SIZE = 8;

function getCoords(e) {
  const rect = canvasEl.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function getHandleCoords(x, y, w, h) {
  return {
    nw: { x: x, y: y },
    ne: { x: x + w, y: y },
    se: { x: x + w, y: y + h },
    sw: { x: x, y: y + h }
  };
}

function getHoveredHandle(mx, my, zone, scaleX, scaleY) {
  if (!zone) return null;
  const dx = zone.actualCoords.x * scaleX;
  const dy = zone.actualCoords.y * scaleY;
  const dw = zone.actualCoords.w * scaleX;
  const dh = zone.actualCoords.h * scaleY;
  
  const handles = getHandleCoords(dx, dy, dw, dh);
  const clickTolerance = HANDLE_SIZE + 6; // Allow slightly off clicks for touch
  
  let hovered = null;
  Object.keys(handles).forEach(key => {
    const h = handles[key];
    const dist = Math.hypot(mx - h.x, my - h.y);
    if (dist <= clickTolerance) {
      hovered = key;
    }
  });
  return hovered;
}

function isPointInZone(mx, my, zone, scaleX, scaleY) {
  const dx = zone.actualCoords.x * scaleX;
  const dy = zone.actualCoords.y * scaleY;
  const dw = zone.actualCoords.w * scaleX;
  const dh = zone.actualCoords.h * scaleY;
  
  return mx >= dx && mx <= dx + dw && my >= dy && my <= dy + dh;
}

function updateClearButton() {
  if (drawnZones.length === 0) {
    clearBlurBtn.disabled = true;
    clearBlurBtn.textContent = 'Clear All';
  } else {
    clearBlurBtn.disabled = false;
    if (selectedZoneIndex !== null) {
      clearBlurBtn.textContent = 'Delete Selected';
    } else {
      clearBlurBtn.textContent = 'Clear All';
    }
  }
}

function handleStart(e) {
  if (videoEl.readyState < 2) return;
  
  // Prevent scrolling on touch devices when drawing
  if (e.type === 'touchstart') {
    e.preventDefault();
  }

  const coords = getCoords(e);
  startX = coords.x;
  startY = coords.y;
  currentX = coords.x;
  currentY = coords.y;

  const scaleX = canvasEl.width / videoEl.videoWidth;
  const scaleY = canvasEl.height / videoEl.videoHeight;

  // Check if click is on selected zone's handle
  const activeZone = selectedZoneIndex !== null ? drawnZones[selectedZoneIndex] : null;
  const hoveredHandle = getHoveredHandle(startX, startY, activeZone, scaleX, scaleY);

  if (hoveredHandle) {
    isResizing = hoveredHandle;
    dragStartMouse = { x: startX, y: startY };
    dragStartCoords = { ...activeZone.actualCoords };
  } else {
    // Check if clicked inside any zone
    let clickedZoneIndex = null;
    for (let i = drawnZones.length - 1; i >= 0; i--) {
      if (isPointInZone(startX, startY, drawnZones[i], scaleX, scaleY)) {
        clickedZoneIndex = i;
        break;
      }
    }

    if (clickedZoneIndex !== null) {
      selectedZoneIndex = clickedZoneIndex;
      isDragging = true;
      dragStartMouse = { x: startX, y: startY };
      dragStartCoords = { ...drawnZones[clickedZoneIndex].actualCoords };
    } else {
      // Clicked on empty space: start drawing new zone
      selectedZoneIndex = null;
      isDrawingNew = true;
    }
  }
  
  updateClearButton();
  drawOverlay();
}

function handleMove(e) {
  if (videoEl.readyState < 2) return;
  
  if (e.type === 'touchmove') {
    e.preventDefault();
  }

  const coords = getCoords(e);
  currentX = coords.x;
  currentY = coords.y;

  const scaleX = canvasEl.width / videoEl.videoWidth;
  const scaleY = canvasEl.height / videoEl.videoHeight;
  const invScaleX = videoEl.videoWidth / canvasEl.width;
  const invScaleY = videoEl.videoHeight / canvasEl.height;

  if (isDragging) {
    const activeZone = drawnZones[selectedZoneIndex];
    if (activeZone) {
      const dxCanvas = currentX - dragStartMouse.x;
      const dyCanvas = currentY - dragStartMouse.y;
      
      const dxVideo = Math.round(dxCanvas * invScaleX);
      const dyVideo = Math.round(dyCanvas * invScaleY);
      
      let newX = dragStartCoords.x + dxVideo;
      let newY = dragStartCoords.y + dyVideo;
      
      newX = Math.max(0, Math.min(videoEl.videoWidth - dragStartCoords.w, newX));
      newY = Math.max(0, Math.min(videoEl.videoHeight - dragStartCoords.h, newY));
      
      activeZone.actualCoords.x = newX;
      activeZone.actualCoords.y = newY;
      
      updateFFmpegCommandPreview();
      drawOverlay();
    }
    return;
  }

  if (isResizing) {
    const activeZone = drawnZones[selectedZoneIndex];
    if (activeZone) {
      const dxCanvas = currentX - dragStartMouse.x;
      const dyCanvas = currentY - dragStartMouse.y;
      const dxVideo = Math.round(dxCanvas * invScaleX);
      const dyVideo = Math.round(dyCanvas * invScaleY);

      let newX = dragStartCoords.x;
      let newY = dragStartCoords.y;
      let newW = dragStartCoords.w;
      let newH = dragStartCoords.h;

      const hasAspect = (watermarkBase64 && watermarkImg && watermarkImg.complete && watermarkImg.naturalWidth);
      const aspect = hasAspect ? (watermarkImg.width / watermarkImg.height) : (dragStartCoords.w / dragStartCoords.h);

      if (isResizing === 'se') {
        newW = dragStartCoords.w + dxVideo;
        if (hasAspect) {
          newH = Math.round(newW / aspect);
        } else {
          newH = dragStartCoords.h + dyVideo;
        }
      } else if (isResizing === 'sw') {
        newX = dragStartCoords.x + dxVideo;
        newW = dragStartCoords.w - dxVideo;
        if (hasAspect) {
          newH = Math.round(newW / aspect);
        } else {
          newH = dragStartCoords.h + dyVideo;
        }
      } else if (isResizing === 'ne') {
        newY = dragStartCoords.y + dyVideo;
        newW = dragStartCoords.w + dxVideo;
        if (hasAspect) {
          newH = Math.round(newW / aspect);
          newY = dragStartCoords.y + (dragStartCoords.h - newH);
        } else {
          newH = dragStartCoords.h - dyVideo;
        }
      } else if (isResizing === 'nw') {
        newX = dragStartCoords.x + dxVideo;
        newW = dragStartCoords.w - dxVideo;
        newY = dragStartCoords.y + dyVideo;
        if (hasAspect) {
          newH = Math.round(newW / aspect);
          newY = dragStartCoords.y + (dragStartCoords.h - newH);
        } else {
          newH = dragStartCoords.h - dyVideo;
        }
      }

      const minSize = 15;
      if (newW < minSize) {
        newW = minSize;
        if (isResizing === 'sw' || isResizing === 'nw') {
          newX = dragStartCoords.x + dragStartCoords.w - minSize;
        }
      }
      if (newH < minSize) {
        newH = minSize;
        if (isResizing === 'ne' || isResizing === 'nw') {
          newY = dragStartCoords.y + dragStartCoords.h - minSize;
        }
      }

      if (newX < 0) {
        newW += newX;
        newX = 0;
      }
      if (newY < 0) {
        newH += newY;
        newY = 0;
      }
      if (newX + newW > videoEl.videoWidth) {
        newW = videoEl.videoWidth - newX;
      }
      if (newY + newH > videoEl.videoHeight) {
        newH = videoEl.videoHeight - newY;
      }
      
      if (hasAspect) {
        newH = Math.round(newW / aspect);
        if (isResizing === 'ne' || isResizing === 'nw') {
          newY = dragStartCoords.y + (dragStartCoords.h - newH);
        }
      }

      activeZone.actualCoords = { x: newX, y: newY, w: newW, h: newH };
      updateFFmpegCommandPreview();
      drawOverlay();
    }
    return;
  }

  if (isDrawingNew) {
    drawOverlay();
    return;
  }

  let hoverCursor = 'crosshair';
  const activeZoneHover = selectedZoneIndex !== null ? drawnZones[selectedZoneIndex] : null;
  const hoveredHandle = getHoveredHandle(currentX, currentY, activeZoneHover, scaleX, scaleY);
  
  if (hoveredHandle) {
    if (hoveredHandle === 'nw' || hoveredHandle === 'se') {
      hoverCursor = 'nwse-resize';
    } else {
      hoverCursor = 'nesw-resize';
    }
  } else {
    let foundZone = false;
    for (let i = drawnZones.length - 1; i >= 0; i--) {
      if (isPointInZone(currentX, currentY, drawnZones[i], scaleX, scaleY)) {
        hoverCursor = 'move';
        foundZone = true;
        break;
      }
    }
  }
  canvasEl.style.cursor = hoverCursor;
}

function handleEnd() {
  if (isResizing) {
    isResizing = null;
  }
  if (isDragging) {
    isDragging = false;
  }
  if (isDrawingNew) {
    isDrawingNew = false;
    
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);

    if (w > 10 && h > 10 && videoEl.videoWidth) {
      const scaleX = videoEl.videoWidth / canvasEl.width;
      const scaleY = videoEl.videoHeight / canvasEl.height;

      let aCoords = {
        x: Math.round(x * scaleX),
        y: Math.round(y * scaleY),
        w: Math.round(w * scaleX),
        h: Math.round(h * scaleY)
      };

      aCoords.x = Math.max(0, Math.min(videoEl.videoWidth, aCoords.x));
      aCoords.y = Math.max(0, Math.min(videoEl.videoHeight, aCoords.y));
      aCoords.w = Math.min(videoEl.videoWidth - aCoords.x, aCoords.w);
      aCoords.h = Math.min(videoEl.videoHeight - aCoords.y, aCoords.h);

      drawnZones.push({ actualCoords: aCoords });
      selectedZoneIndex = drawnZones.length - 1;
      coordsDisplay.textContent = `${drawnZones.length} Zone(s) Selected`;
      updateFFmpegCommandPreview();
    }
  }
  updateClearButton();
  drawOverlay();
}

function drawOverlay() {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  
  if (!videoEl.videoWidth) return;

  const scaleX = canvasEl.width / videoEl.videoWidth;
  const scaleY = canvasEl.height / videoEl.videoHeight;
  
  drawnZones.forEach((zone, index) => {
    const dx = zone.actualCoords.x * scaleX;
    const dy = zone.actualCoords.y * scaleY;
    const dw = zone.actualCoords.w * scaleX;
    const dh = zone.actualCoords.h * scaleY;

    if (watermarkBase64 && watermarkImg && watermarkImg.complete && watermarkImg.naturalWidth) {
      ctx.drawImage(watermarkImg, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(dx, dy, dw, dh);
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BLUR BOX', dx + dw/2, dy + dh/2);
    }

    const isActive = (index === selectedZoneIndex);
    ctx.strokeStyle = isActive ? '#d97706' : 'rgba(217, 119, 6, 0.4)';
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.setLineDash(isActive ? [] : [4, 4]);
    ctx.strokeRect(dx, dy, dw, dh);

    if (isActive) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1.5;
      
      const handles = getHandleCoords(dx, dy, dw, dh);
      Object.keys(handles).forEach(key => {
        const h = handles[key];
        ctx.fillRect(h.x - HANDLE_SIZE/2, h.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(h.x - HANDLE_SIZE/2, h.y - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
      });
    }
  });
  
  if (isDrawingNew) {
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
      watermarkImg = new Image();
      watermarkImg.onload = () => {
        // If there's no drawn zones yet, create one by default in the center!
        if (drawnZones.length === 0 && videoEl.videoWidth) {
          const defaultW = Math.round(videoEl.videoWidth * 0.2);
          const defaultH = Math.round(defaultW / (watermarkImg.width / watermarkImg.height));
          const defaultX = Math.round((videoEl.videoWidth - defaultW) / 2);
          const defaultY = Math.round((videoEl.videoHeight - defaultH) / 2);
          drawnZones.push({
            actualCoords: {
              x: defaultX,
              y: defaultY,
              w: defaultW,
              h: defaultH
            }
          });
          selectedZoneIndex = drawnZones.length - 1;
          coordsDisplay.textContent = `${drawnZones.length} Zone(s) Selected`;
        }
        updateClearButton();
        resizeCanvasOverlay();
        updateFFmpegCommandPreview();
      };
      watermarkImg.src = watermarkBase64;
    };
    reader.readAsDataURL(file);
  } else {
    watermarkBase64 = null;
    watermarkImg = new Image();
    watermarkFileName.textContent = '';
    updateClearButton();
    resizeCanvasOverlay();
    updateFFmpegCommandPreview();
  }
});

function clearBlurBox() {
  if (selectedZoneIndex !== null) {
    drawnZones.splice(selectedZoneIndex, 1);
    selectedZoneIndex = null;
  } else {
    drawnZones = [];
    selectedZoneIndex = null;
  }

  if (drawnZones.length === 0) {
    coordsDisplay.textContent = 'None';
  } else {
    coordsDisplay.textContent = `${drawnZones.length} Zone(s) Selected`;
  }
  
  updateClearButton();
  resizeCanvasOverlay();
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

function renderDownloads(downloads) {
  if (!downloadsListContainer) return;
  
  if (downloads.length === 0) {
    downloadsListContainer.innerHTML = `
      <div class="no-downloads-placeholder">
        <p>No completed files available. Start processing a series to generate outputs.</p>
      </div>
    `;
    return;
  }
  
  let html = '';
  downloads.forEach(file => {
    const remainingSeconds = Math.floor(file.remainingMs / 1000);
    let timeStr = '';
    if (remainingSeconds <= 0) {
      timeStr = 'Expired';
    } else {
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      timeStr = `${hours}h ${minutes}m left`;
    }
    
    let badgeClass = 'badge-success';
    if (remainingSeconds < 3600 * 2) {
      badgeClass = 'badge-danger';
    } else if (remainingSeconds < 3600 * 6) {
      badgeClass = 'badge-warning';
    }
    
    html += `
      <div class="download-item">
        <div class="download-item-info">
          <span class="download-filename" title="${file.fileName}">${file.fileName}</span>
          <div class="download-metadata">
            <span class="download-filesize">${file.fileSizeMB} MB</span>
            <span class="download-timer ${badgeClass}">${timeStr}</span>
          </div>
        </div>
        <div class="download-item-actions">
          <a href="${file.downloadUrl}" class="btn btn-success btn-sm" download>Download</a>
          <button class="btn btn-danger btn-sm delete-file-btn" data-filename="${file.fileName}">Delete</button>
        </div>
      </div>
    `;
  });
  
  downloadsListContainer.innerHTML = html;
  
  // Bind click handlers for delete buttons
  downloadsListContainer.querySelectorAll('.delete-file-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const fileName = e.target.dataset.filename;
      deleteSpecificFile(fileName);
    });
  });
}

async function deleteSpecificFile(fileName) {
  const confirmDelete = confirm(`Are you sure you want to delete "${fileName}" from the server?`);
  if (!confirmDelete) return;
  
  try {
    const res = await fetch('/api/delete-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName })
    });
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    addSystemLog(`Deleted file from server: ${fileName}`);
    // Fetch and render immediately
    const dlRes = await fetch('/api/downloads');
    const downloads = await dlRes.json();
    renderDownloads(downloads);
  } catch (err) {
    alert(`Failed to delete file: ${err.message}`);
  }
}

// System Status Poller
async function pollStatus() {
  try {
    const res = await fetch('/api/task-status');
    const state = await res.json();
    
    // Fetch and render downloads list
    try {
      const dlRes = await fetch('/api/downloads');
      const downloads = await dlRes.json();
      renderDownloads(downloads);
    } catch (err) {
      console.error('Error fetching downloads:', err);
    }

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
    } 
    else if (state.status === 'completed') {
      statusDesc.textContent = `Processing for "${state.seriesName}" completed successfully! Download your file below.`;
      progressContainer.classList.add('hidden');
      progressTextPercent.classList.add('hidden');
      
      fetchSeriesBtn.disabled = false;
      if (activeSeries) {
        const selectedCount = selectedEpisodesState.filter(Boolean).length;
        startTaskBtn.disabled = (selectedCount === 0);
      } else {
        startTaskBtn.disabled = true;
      }
    } 
    else if (state.status === 'failed') {
      statusDesc.textContent = `Task failed. Error: ${state.error}`;
      progressContainer.classList.add('hidden');
      progressTextPercent.classList.add('hidden');

      fetchSeriesBtn.disabled = false;
      if (activeSeries) {
        const selectedCount = selectedEpisodesState.filter(Boolean).length;
        startTaskBtn.disabled = (selectedCount === 0);
      } else {
        startTaskBtn.disabled = true;
      }
    } 
    else {
      // Idle state
      statusDesc.textContent = 'Server is standby. Awaiting configuration.';
      progressContainer.classList.add('hidden');
      progressTextPercent.classList.add('hidden');

      fetchSeriesBtn.disabled = false;
      if (activeSeries) {
        const selectedCount = selectedEpisodesState.filter(Boolean).length;
        startTaskBtn.disabled = (selectedCount === 0);
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

  const selectedEpisodes = episodesList.filter((ep, idx) => selectedEpisodesState[idx]);
  if (selectedEpisodes.length === 0) {
    alert('Please select at least one episode to download.');
    return;
  }

  const confirmRun = confirm(`Start downloading and processing ${selectedEpisodes.length} selected episodes?\n\nFFmpeg processing will run in the background on the server.`);
  if (!confirmRun) return;

  // Compute a smart seriesName containing the episode range/status
  let rangeName = activeSeries.lang ? `Series_${activeSeries.lang}` : 'Series';
  if (selectedEpisodes.length === 1) {
    rangeName += `_ep_${selectedEpisodes[0].episode}`;
  } else {
    // Check if contiguous range
    let isContiguous = true;
    for (let i = 1; i < selectedEpisodes.length; i++) {
      if (selectedEpisodes[i].episode !== selectedEpisodes[i - 1].episode + 1) {
        isContiguous = false;
        break;
      }
    }
    if (isContiguous) {
      rangeName += `_eps_${selectedEpisodes[0].episode}-${selectedEpisodes[selectedEpisodes.length - 1].episode}`;
    } else {
      rangeName += `_selected_${selectedEpisodes.length}_eps`;
    }
  }

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
        seriesName: rangeName,
        episodes: selectedEpisodes,
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
  clearBlurBtn.addEventListener('click', clearBlurBox);

  // Episode Selection Actions
  selectAllEpsBtn.addEventListener('click', () => {
    const checkboxes = episodesCheckboxContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
      cb.checked = true;
      const index = parseInt(cb.dataset.index, 10);
      selectedEpisodesState[index] = true;
    });
    updateSelectedSummary();
  });

  selectNoneEpsBtn.addEventListener('click', () => {
    const checkboxes = episodesCheckboxContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
      cb.checked = false;
      const index = parseInt(cb.dataset.index, 10);
      selectedEpisodesState[index] = false;
    });
    updateSelectedSummary();
  });

  applyRangeBtn.addEventListener('click', () => {
    const start = parseInt(rangeStartInput.value, 10);
    const end = parseInt(rangeEndInput.value, 10);
    if (isNaN(start) || isNaN(end) || start < 1 || end < 1 || start > end) {
      alert('Please enter a valid range (Start must be <= End).');
      return;
    }

    const checkboxes = episodesCheckboxContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach((cb) => {
      const index = parseInt(cb.dataset.index, 10);
      const epNum = episodesList[index].episode;
      const currentEpNum = typeof epNum === 'number' ? epNum : (index + 1);

      if (currentEpNum >= start && currentEpNum <= end) {
        cb.checked = true;
        selectedEpisodesState[index] = true;
      } else {
        cb.checked = false;
        selectedEpisodesState[index] = false;
      }
    });
    updateSelectedSummary();
  });

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
    const val = parseFloat(e.target.value);
    speedVal.textContent = `${val.toFixed(2)}x`;
    videoEl.playbackRate = val;
    updateFFmpegCommandPreview();
  });
  pitchCheckbox.addEventListener('change', updateFFmpegCommandPreview);
  
  saturationSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    saturationVal.textContent = `${val.toFixed(2)}x`;
    videoEl.style.filter = `contrast(${contrastSlider.value}) saturate(${val})`;
    updateFFmpegCommandPreview();
  });
  
  contrastSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    contrastVal.textContent = `${val.toFixed(2)}x`;
    videoEl.style.filter = `contrast(${val}) saturate(${saturationSlider.value})`;
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

  // Video Player Controls Logic
  playPauseBtn.addEventListener('click', () => {
    if (videoEl.paused) {
      videoEl.play();
    } else {
      videoEl.pause();
    }
  });

  videoEl.addEventListener('play', () => {
    playPauseBtn.textContent = 'Pause';
    videoEl.playbackRate = parseFloat(speedSlider.value);
    videoEl.style.filter = `contrast(${contrastSlider.value}) saturate(${saturationSlider.value})`;
  });

  videoEl.addEventListener('pause', () => {
    playPauseBtn.textContent = 'Play';
  });

  let isUserSeeking = false;
  videoEl.addEventListener('timeupdate', () => {
    if (!isUserSeeking && videoEl.duration) {
      const pct = (videoEl.currentTime / videoEl.duration) * 100;
      videoSeekSlider.value = pct;
      videoTimeDisplay.textContent = `${formatTime(videoEl.currentTime)} / ${formatTime(videoEl.duration)}`;
    }
  });

  videoEl.addEventListener('durationchange', () => {
    if (videoEl.duration) {
      videoTimeDisplay.textContent = `${formatTime(videoEl.currentTime)} / ${formatTime(videoEl.duration)}`;
    }
  });

  videoSeekSlider.addEventListener('input', () => {
    isUserSeeking = true;
    if (videoEl.duration) {
      const targetTime = (videoSeekSlider.value / 100) * videoEl.duration;
      videoEl.currentTime = targetTime;
      videoTimeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(videoEl.duration)}`;
    }
  });

  videoSeekSlider.addEventListener('change', () => {
    isUserSeeking = false;
  });
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);
