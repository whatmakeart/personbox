let video;

// AI Models
let bodyPose, segBodyPix, segSelfie, depthEstimator;

// Data storage
let poses = [];
let segBPResult = null;
let segSelfieResult = null;
let connections, partGroups;
let partsInitialized = false;

// Depth state
let pendingDepthResult = null;
let hasPendingDepthFrame = false;

let renderDepthMap = null;
let renderDepthDisplay = null;
let renderSourceFrame = null;
let renderSourcePixels = null;

// 3D Rendering & Camera Controls
let depthBuffer;
let camRotX = 0;
let camRotY = 0;
let camZoom = 0;

// App State
let currentFacingMode = "user";
let currentMode = "mocap";
let activeSegModel = "bodypix";

// Resolutions
let vW = 320;
let vH = 240;
let cW = 640;
let cH = 480;

function preload() {
  bodyPose = ml5.bodyPose("MoveNet");
  segBodyPix = ml5.bodySegmentation("BodyPix", { maskType: "parts" });
  segSelfie = ml5.bodySegmentation("SelfieSegmentation");
  depthEstimator = ml5.depthEstimation({ dilationFactor: 2 });
}

function setup() {
  pixelDensity(1);
  frameRate(30);

  createCanvas(cW, cH);

  depthBuffer = createGraphics(cW, cH, WEBGL);
  depthBuffer.pixelDensity(1);

  connections = bodyPose.getSkeleton();

  startCamera();
  setupUI();
}

function stopPipelines() {
  try {
    if (bodyPose && bodyPose.detectStop) bodyPose.detectStop();
  } catch (e) {}

  try {
    if (segBodyPix && segBodyPix.detectStop) segBodyPix.detectStop();
  } catch (e) {}

  try {
    if (segSelfie && segSelfie.detectStop) segSelfie.detectStop();
  } catch (e) {}

  try {
    if (depthEstimator && depthEstimator.estimateStop) depthEstimator.estimateStop();
  } catch (e) {}

  if (video && video.elt && video.elt.srcObject) {
    const tracks = video.elt.srcObject.getTracks();
    tracks.forEach((track) => track.stop());
  }

  poses = [];
  segBPResult = null;
  segSelfieResult = null;

  pendingDepthResult = null;
  hasPendingDepthFrame = false;

  renderDepthMap = null;
  renderDepthDisplay = null;
  renderSourceFrame = null;
  renderSourcePixels = null;
}

function startCamera() {
  stopPipelines();

  if (video) {
    video.remove();
    video = null;
  }

  const constraints = {
    video: {
      facingMode: currentFacingMode,
      width: { ideal: vW },
      height: { ideal: vH },
    },
    audio: false,
  };

  video = createCapture(constraints, () => {
    waitForVideo();
  });

  video.size(vW, vH);
  video.hide();
}

function waitForVideo() {
  if (video && video.elt && video.elt.readyState === 4 && video.elt.videoWidth > 0) {
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.innerText = "Booting Models...";

    bodyPose.detectStart(video, (res) => {
      poses = res || [];
    });

    segBodyPix.detectStart(video, (res) => {
      segBPResult = res;
      initParts();
    });

    segSelfie.detectStart(video, (res) => {
      segSelfieResult = res;
    });

    setTimeout(() => {
      if (statusEl) statusEl.innerText = "All Systems Active";

      depthEstimator.estimateStart(video, (res) => {
        if (!res) return;
        pendingDepthResult = res;
        hasPendingDepthFrame = true;
      });
    }, 500);
  } else {
    setTimeout(waitForVideo, 100);
  }
}

function commitPendingDepthFrame() {
  if (!hasPendingDepthFrame || !pendingDepthResult) return;

  const res = pendingDepthResult;
  pendingDepthResult = null;
  hasPendingDepthFrame = false;

  renderDepthMap = res;

  if (res.sourceFrame) {
    renderSourceFrame = res.sourceFrame.get();
    renderSourceFrame.loadPixels();
    renderSourcePixels = renderSourceFrame.pixels.slice();
  } else {
    renderSourceFrame = null;
    renderSourcePixels = null;
  }

  if (res.image) {
    renderDepthDisplay = res.image.get();

    if (res.mask) {
      const maskCopy = res.mask.get ? res.mask.get() : res.mask;
      renderDepthDisplay.mask(maskCopy);
    }
  } else {
    renderDepthDisplay = null;
  }
}

// Manual Orbit & Zoom Controls
function mouseDragged() {
  if (currentMode === "pointcloud" || currentMode === "mesh") {
    camRotY += (mouseX - pmouseX) * 0.01;
    camRotX -= (mouseY - pmouseY) * 0.01;
  }
}

function mouseWheel(event) {
  if (currentMode === "pointcloud" || currentMode === "mesh") {
    camZoom -= event.delta * 0.5;
    return false;
  }
}

function initParts() {
  if (!partsInitialized && segBodyPix.getPartsId) {
    const parts = segBodyPix.getPartsId();
    partGroups = {
      face: [parts.LEFT_FACE, parts.RIGHT_FACE],
      torso: [parts.TORSO_FRONT, parts.TORSO_BACK],
      arms: [
        parts.LEFT_UPPER_ARM_FRONT,
        parts.LEFT_UPPER_ARM_BACK,
        parts.RIGHT_UPPER_ARM_FRONT,
        parts.RIGHT_UPPER_ARM_BACK,
        parts.LEFT_LOWER_ARM_FRONT,
        parts.LEFT_LOWER_ARM_BACK,
        parts.RIGHT_LOWER_ARM_FRONT,
        parts.RIGHT_LOWER_ARM_BACK,
        parts.LEFT_HAND,
        parts.RIGHT_HAND,
      ],
      legs: [
        parts.LEFT_UPPER_LEG_FRONT,
        parts.LEFT_UPPER_LEG_BACK,
        parts.RIGHT_UPPER_LEG_FRONT,
        parts.RIGHT_UPPER_LEG_BACK,
        parts.LEFT_LOWER_LEG_FRONT,
        parts.LEFT_LOWER_LEG_BACK,
        parts.RIGHT_LOWER_LEG_FRONT,
        parts.RIGHT_LOWER_LEG_BACK,
        parts.LEFT_FOOT,
        parts.RIGHT_FOOT,
      ],
    };
    partsInitialized = true;
  }
}

function setupUI() {
  const camBtn = document.getElementById("camBtn");
  if (camBtn) {
    camBtn.addEventListener("click", () => {
      currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
      const statusEl = document.getElementById("status");
      if (statusEl) statusEl.innerText = "Switching camera...";
      startCamera();
    });
  }

  const fsBtn = document.getElementById("fsBtn");
  if (fsBtn) {
    fsBtn.addEventListener("click", () => {
      const canvasElt = document.querySelector("canvas");
      if (!canvasElt) return;

      if (!document.fullscreenElement) {
        canvasElt.requestFullscreen().catch((err) => console.log(err));
      } else {
        document.exitFullscreen();
      }
    });
  }

  const segModelSelect = document.getElementById("segModelSelect");
  if (segModelSelect) {
    segModelSelect.addEventListener("change", (e) => {
      activeSegModel = e.target.value;
      const bpControls = document.getElementById("bp-controls");
      if (bpControls) {
        bpControls.style.display = activeSegModel === "bodypix" ? "block" : "none";
      }
    });
  }

  const modeButtons = document.querySelectorAll(".modeBtn");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      modeButtons.forEach((b) => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      currentMode = e.currentTarget.getAttribute("data-mode");

      const segSettings = document.getElementById("seg-settings");
      const meshSettings = document.getElementById("mesh-settings");

      if (segSettings) segSettings.style.display = currentMode === "seg" ? "block" : "none";
      if (meshSettings) meshSettings.style.display = currentMode === "mesh" ? "block" : "none";

      camRotX = 0;
      camRotY = 0;
      camZoom = 0;
    });
  });
}

function draw() {
  background(15);
  if (!video) return;

  if (hasPendingDepthFrame) {
    commitPendingDepthFrame();
  }

  if (currentMode === "mocap" || currentMode === "hud" || currentMode === "box") {
    tint(255, 120);
    image(video, 0, 0, width, height);
    noTint();

    poses.forEach((pose) => {
      if (currentMode === "mocap") drawNeonMocap(pose);
      if (currentMode === "hud") drawDataHUD(pose);
      if (currentMode === "box") drawBoundingBox(pose);
    });
  } else if (currentMode === "seg") {
    drawSegmentationLab();
  } else if (currentMode === "depthmap") {
    drawDepthMask();
  } else if (currentMode === "pointcloud" || currentMode === "mesh") {
    if (renderDepthMap) {
      depthBuffer.clear();
      depthBuffer.background(0);

      depthBuffer.push();
      depthBuffer.translate(0, 0, camZoom);
      depthBuffer.rotateX(camRotX);
      depthBuffer.rotateY(camRotY);

      if (currentMode === "pointcloud") drawPointCloud(renderDepthMap);
      if (currentMode === "mesh") drawMesh(renderDepthMap);

      depthBuffer.pop();
      image(depthBuffer, 0, 0);
    } else {
      image(video, 0, 0, width, height);
    }

    fill(0, 255, 255);
    noStroke();
    textSize(16);
    textAlign(LEFT, TOP);
    text("Drag to Orbit | Scroll to Zoom", 10, 10);
  }
}

// --- DEPTH RENDERING ---
function drawDepthMask() {
  if (renderDepthDisplay) {
    image(renderDepthDisplay, 0, 0, width, height);
  } else if (renderDepthMap && renderDepthMap.image) {
    image(renderDepthMap.image, 0, 0, width, height);
  } else {
    image(video, 0, 0, width, height);
  }
}

function drawPointCloud(depthState) {
  if (!depthState || !renderSourcePixels) return;

  const step = 4;

  depthBuffer.push();
  depthBuffer.scale(2);
  depthBuffer.translate(-vW / 2, -vH / 2, 0);
  depthBuffer.strokeWeight(3);

  for (let y = 0; y < vH; y += step) {
    for (let x = 0; x < vW; x += step) {
      let depth;
      try {
        depth = depthState.getDepthAt(x, y);
      } catch (e) {
        continue;
      }

      if (!isFinite(depth) || depth <= 0) continue;

      const index = (x + y * vW) * 4;
      const z = map(depth, 0, 1, 200, -200);

      depthBuffer.stroke(renderSourcePixels[index], renderSourcePixels[index + 1], renderSourcePixels[index + 2], 255);
      depthBuffer.point(x, y, z);
    }
  }

  depthBuffer.pop();
}

function drawMesh(depthState) {
  if (!depthState || typeof depthState.getDepthAt !== "function") return;

  const textureToggle = document.getElementById("textureToggle");
  const useTexture = !!(textureToggle && textureToggle.checked && renderSourceFrame);

  depthBuffer.noStroke();
  if (!useTexture) {
    depthBuffer.fill(0, 255, 255);
    depthBuffer.stroke(0, 150, 150);
  }

  const step = 4;
  const cols = floor(vW / step);
  const rows = floor(vH / step);

  depthBuffer.push();
  depthBuffer.scale(2);
  depthBuffer.translate(-vW / 2, -vH / 2, 0);

  if (useTexture) {
    depthBuffer.textureMode(NORMAL);
    depthBuffer.texture(renderSourceFrame);
  }

  depthBuffer.beginShape(TRIANGLES);

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const x1 = x * step;
      const y1 = y * step;
      const x2 = (x + 1) * step;
      const y2 = y * step;
      const x3 = x * step;
      const y3 = (y + 1) * step;
      const x4 = (x + 1) * step;
      const y4 = (y + 1) * step;

      let d1, d2, d3, d4;

      try {
        d1 = depthState.getDepthAt(x1, y1);
        d2 = depthState.getDepthAt(x2, y2);
        d3 = depthState.getDepthAt(x3, y3);
        d4 = depthState.getDepthAt(x4, y4);
      } catch (e) {
        continue;
      }

      if (![d1, d2, d3, d4].every((d) => isFinite(d) && d > 0)) continue;

      const z1 = map(d1, 0, 1, 200, -200);
      const z2 = map(d2, 0, 1, 200, -200);
      const z3 = map(d3, 0, 1, 200, -200);
      const z4 = map(d4, 0, 1, 200, -200);

      if (abs(d1 - d2) < 0.1 && abs(d1 - d3) < 0.1) {
        if (useTexture) {
          depthBuffer.vertex(x1, y1, z1, x1 / vW, y1 / vH);
          depthBuffer.vertex(x2, y2, z2, x2 / vW, y2 / vH);
          depthBuffer.vertex(x3, y3, z3, x3 / vW, y3 / vH);
        } else {
          depthBuffer.vertex(x1, y1, z1);
          depthBuffer.vertex(x2, y2, z2);
          depthBuffer.vertex(x3, y3, z3);
        }
      }

      if (abs(d2 - d4) < 0.1 && abs(d2 - d3) < 0.1) {
        if (useTexture) {
          depthBuffer.vertex(x2, y2, z2, x2 / vW, y2 / vH);
          depthBuffer.vertex(x4, y4, z4, x4 / vW, y4 / vH);
          depthBuffer.vertex(x3, y3, z3, x3 / vW, y3 / vH);
        } else {
          depthBuffer.vertex(x2, y2, z2);
          depthBuffer.vertex(x4, y4, z4);
          depthBuffer.vertex(x3, y3, z3);
        }
      }
    }
  }

  depthBuffer.endShape();
  depthBuffer.pop();
}

// --- 2D DRAWING ---
function drawSegmentationLab() {
  const activeMask =
    activeSegModel === "selfie" && segSelfieResult
      ? segSelfieResult.mask
      : activeSegModel === "bodypix" && segBPResult
        ? segBPResult.mask
        : null;

  if (!activeMask) {
    image(video, 0, 0, width, height);
    return;
  }

  const renderStyleEl = document.getElementById("renderStyle");
  const renderStyle = renderStyleEl ? renderStyleEl.value : "bg";

  if (renderStyle === "bg" || renderStyle === "both") {
    background(0, 0, 255);
    const maskedVideo = video.get();
    maskedVideo.mask(activeMask);
    image(maskedVideo, 0, 0, width, height);
  } else {
    image(video, 0, 0, width, height);
  }

  if (renderStyle === "color" || renderStyle === "both") {
    tint(255, 105, 180, 200);
    image(activeMask, 0, 0, width, height);
    noTint();
  }

  if (activeSegModel === "bodypix" && partsInitialized && segBPResult) {
    trackAndLabelParts(segBPResult);
  }
}

function trackAndLabelParts(result) {
  const showLabelsEl = document.getElementById("showLabels");
  const showLabels = !!(showLabelsEl && showLabelsEl.checked);

  const activeParts = Array.from(document.querySelectorAll(".part-toggle:checked")).map((cb) => cb.value);

  const centroids = {
    face: { x: 0, y: 0, count: 0, color: [255, 255, 0] },
    torso: { x: 0, y: 0, count: 0, color: [255, 0, 255] },
    arms: { x: 0, y: 0, count: 0, color: [0, 255, 255] },
    legs: { x: 0, y: 0, count: 0, color: [0, 255, 0] },
  };

  const gridSize = 5;
  const scaleX = width / vW;
  const scaleY = height / vH;

  for (let y = 0; y < vH; y += gridSize) {
    for (let x = 0; x < vW; x += gridSize) {
      const idx = y * vW + x;
      const partId = result.data[idx];
      if (partId === -1) continue;

      for (const category of activeParts) {
        if (partGroups[category] && partGroups[category].includes(partId)) {
          fill(centroids[category].color[0], centroids[category].color[1], centroids[category].color[2], 150);
          noStroke();
          circle(x * scaleX, y * scaleY, gridSize * scaleX);
          centroids[category].x += x * scaleX;
          centroids[category].y += y * scaleY;
          centroids[category].count++;
        }
      }
    }
  }

  if (showLabels) {
    textAlign(CENTER, CENTER);
    textSize(24);
    stroke(0);
    strokeWeight(4);

    for (const category of activeParts) {
      const data = centroids[category];
      if (data.count > 0) {
        fill(data.color);
        text(category.toUpperCase(), data.x / data.count, data.y / data.count);
      }
    }
  }
}

function drawNeonMocap(pose) {
  strokeWeight(4);
  stroke(0, 255, 255);

  const scaleX = width / vW;
  const scaleY = height / vH;

  for (let j = 0; j < connections.length; j++) {
    const pA = pose.keypoints[connections[j][0]];
    const pB = pose.keypoints[connections[j][1]];
    if (pA.confidence > 0.1 && pB.confidence > 0.1) {
      line(pA.x * scaleX, pA.y * scaleY, pB.x * scaleX, pB.y * scaleY);
    }
  }

  noStroke();
  fill(255, 105, 180);

  pose.keypoints.forEach((kp) => {
    if (kp.confidence > 0.1) {
      circle(kp.x * scaleX, kp.y * scaleY, 10);
    }
  });
}

function drawDataHUD(pose) {
  textAlign(CENTER, CENTER);
  textSize(14);

  const scaleX = width / vW;
  const scaleY = height / vH;

  pose.keypoints.forEach((kp) => {
    if (kp.confidence > 0.2 && (kp.name.includes("wrist") || kp.name.includes("ankle") || kp.name === "nose")) {
      const kx = kp.x * scaleX;
      const ky = kp.y * scaleY;

      stroke(0, 255, 0);
      strokeWeight(2);
      noFill();
      rect(kx - 15, ky - 15, 30, 30);
      line(kx, ky - 20, kx, ky + 20);
      line(kx - 20, ky, kx + 20, ky);

      noStroke();
      fill(0, 255, 0);
      text(kp.name.toUpperCase(), kx, ky - 25);
    }
  });
}

function drawBoundingBox(pose) {
  const box = pose.box;
  if (!box) return;

  const scaleX = width / vW;
  const scaleY = height / vH;

  stroke(255, 255, 0);
  strokeWeight(4);
  noFill();
  rect(box.xMin * scaleX, box.yMin * scaleY, box.width * scaleX, box.height * scaleY);

  const avgConf = pose.keypoints.reduce((a, b) => a + b.confidence, 0) / pose.keypoints.length;

  noStroke();
  fill(255, 255, 0);
  textSize(22);
  textAlign(LEFT, TOP);
  text(`PERSON ${nf(avgConf * 100, 1, 1)}%`, box.xMin * scaleX + 5, box.yMin * scaleY + 5);
}
