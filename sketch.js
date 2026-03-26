let video;
// AI Models
let bodyPose, segBodyPix, segSelfie, depthEstimator;
// Data storage
let poses = [];
let segBPResult, segSelfieResult, depthMap;
let connections, partGroups;
let partsInitialized = false;

// 3D Rendering
let depthBuffer; // Offscreen WEBGL canvas

// App State
let currentFacingMode = "user";
let currentMode = "mocap";
let activeSegModel = "bodypix";
let newDataAvailable = false;

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
  createCanvas(cW, cH);
  depthBuffer = createGraphics(cW, cH, WEBGL);
  connections = bodyPose.getSkeleton();

  startCamera();
  setupUI();
}

function startCamera() {
  if (video) video.remove();
  let constraints = { video: { facingMode: currentFacingMode }, audio: false };

  video = createCapture(constraints, () => {
    // Instead of trusting the browser, we start our own rigorous check
    waitForVideo();
  });

  video.size(vW, vH);
  video.hide();
}

// THE FIX: Actively poll the video element until it actually has pixels
function waitForVideo() {
  // readyState >= 2 means the browser has enough data to render the current frame
  if (video && video.elt && video.elt.readyState >= 2 && video.width > 0 && video.height > 0) {
    console.log("Video is truly ready! Launching AI models...");
    document.getElementById("status").innerText = "All Systems Active";

    bodyPose.detectStart(video, (res) => {
      poses = res;
    });
    segBodyPix.detectStart(video, (res) => {
      segBPResult = res;
      initParts();
    });
    segSelfie.detectStart(video, (res) => {
      segSelfieResult = res;
    });
    depthEstimator.estimateStart(video, (res) => {
      depthMap = res;
      newDataAvailable = true;
    });
  } else {
    // If it's not ready, check again in 100 milliseconds
    console.log("Waiting for camera pixels...");
    setTimeout(waitForVideo, 100);
  }
}

function initParts() {
  if (!partsInitialized && segBodyPix.getPartsId) {
    let parts = segBodyPix.getPartsId();
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
  document.getElementById("camBtn").addEventListener("click", () => {
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    document.getElementById("status").innerText = "Switching camera...";
    startCamera();
  });

  document.getElementById("fsBtn").addEventListener("click", () => {
    let fs = fullscreen();
    fullscreen(!fs);
  });

  document.getElementById("segModelSelect").addEventListener("change", (e) => {
    activeSegModel = e.target.value;
    document.getElementById("bp-controls").style.display = activeSegModel === "bodypix" ? "block" : "none";
  });

  let modeButtons = document.querySelectorAll(".modeBtn");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      modeButtons.forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      currentMode = e.target.getAttribute("data-mode");

      document.getElementById("seg-settings").style.display = currentMode === "seg" ? "block" : "none";
      document.getElementById("mesh-settings").style.display = currentMode === "mesh" ? "block" : "none";
    });
  });
}

function draw() {
  background(15);
  if (!video) return;

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
    if (depthMap) drawDepthMask();
  } else if (currentMode === "pointcloud" || currentMode === "mesh") {
    if (newDataAvailable && depthMap) {
      depthBuffer.clear();
      depthBuffer.background(0);
      depthBuffer.orbitControl();

      if (currentMode === "pointcloud") drawPointCloud();
      if (currentMode === "mesh") drawMesh();

      image(depthBuffer, 0, 0);
      newDataAvailable = false;
    } else {
      image(depthBuffer, 0, 0);
    }

    fill(0, 255, 255);
    noStroke();
    textSize(16);
    textAlign(LEFT, TOP);
    text("Click & Drag to Orbit | Scroll to Zoom", 10, 10);
  }
}

// --- DEPTH RENDERING ---
function drawDepthMask() {
  let maskedImg = depthMap.image.get();
  maskedImg.mask(depthMap.mask);
  image(maskedImg, 0, 0, width, height);
}

function drawPointCloud() {
  let src = depthMap.sourceFrame;
  src.loadPixels();
  depthBuffer.noStroke();

  let step = 4;

  for (let y = 0; y < src.height; y += step) {
    for (let x = 0; x < src.width; x += step) {
      let depth = depthMap.getDepthAt(x, y);
      if (depth > 0) {
        let index = (x + y * src.width) * 4;
        depthBuffer.push();
        depthBuffer.scale(2);
        depthBuffer.translate(-vW / 2, -vH / 2, 0);
        depthBuffer.translate(x, y, map(depth, 0, 1, 200, -200));
        depthBuffer.fill(src.pixels[index], src.pixels[index + 1], src.pixels[index + 2], 255);
        depthBuffer.sphere(1.5);
        depthBuffer.pop();
      }
    }
  }
}

function drawMesh() {
  let useTexture = document.getElementById("textureToggle").checked;

  depthBuffer.noStroke();
  if (!useTexture) {
    depthBuffer.fill(0, 255, 255);
    depthBuffer.stroke(0, 150, 150);
  }

  let step = 3;
  let cols = floor(vW / step);
  let rows = floor(vH / step);

  depthBuffer.push();
  depthBuffer.scale(2);
  depthBuffer.translate(-vW / 2, -vH / 2, 0);

  if (useTexture) {
    depthBuffer.textureMode(NORMAL);
    depthBuffer.texture(depthMap.sourceFrame);
  }

  depthBuffer.beginShape(TRIANGLES);

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      let x1 = x * step,
        y1 = y * step;
      let x2 = (x + 1) * step,
        y2 = y * step;
      let x3 = x * step,
        y3 = (y + 1) * step;
      let x4 = (x + 1) * step,
        y4 = (y + 1) * step;

      let d1 = depthMap.getDepthAt(x1, y1);
      let d2 = depthMap.getDepthAt(x2, y2);
      let d3 = depthMap.getDepthAt(x3, y3);
      let d4 = depthMap.getDepthAt(x4, y4);

      let z1 = map(d1, 0, 1, 200, -200);
      let z2 = map(d2, 0, 1, 200, -200);
      let z3 = map(d3, 0, 1, 200, -200);
      let z4 = map(d4, 0, 1, 200, -200);

      if (d1 > 0 && d2 > 0 && d3 > 0 && abs(d1 - d2) < 0.1 && abs(d1 - d3) < 0.1) {
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

      if (d2 > 0 && d4 > 0 && d3 > 0 && abs(d2 - d4) < 0.1 && abs(d2 - d3) < 0.1) {
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
  let activeMask =
    activeSegModel === "selfie" && segSelfieResult
      ? segSelfieResult.mask
      : activeSegModel === "bodypix" && segBPResult
        ? segBPResult.mask
        : null;

  if (!activeMask) {
    image(video, 0, 0, width, height);
    return;
  }

  let renderStyle = document.getElementById("renderStyle").value;

  if (renderStyle === "bg" || renderStyle === "both") {
    background(0, 0, 255);
    let maskedVideo = video.get();
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
  let showLabels = document.getElementById("showLabels").checked;
  let activeParts = Array.from(document.querySelectorAll(".part-toggle:checked")).map((cb) => cb.value);

  let centroids = {
    face: { x: 0, y: 0, count: 0, color: [255, 255, 0] },
    torso: { x: 0, y: 0, count: 0, color: [255, 0, 255] },
    arms: { x: 0, y: 0, count: 0, color: [0, 255, 255] },
    legs: { x: 0, y: 0, count: 0, color: [0, 255, 0] },
  };

  let gridSize = 5;
  let scaleX = width / vW;
  let scaleY = height / vH;

  for (let y = 0; y < vH; y += gridSize) {
    for (let x = 0; x < vW; x += gridSize) {
      let idx = y * vW + x;
      let partId = result.data[idx];
      if (partId === -1) continue;

      for (let category of activeParts) {
        if (partGroups[category].includes(partId)) {
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
    for (let category of activeParts) {
      let data = centroids[category];
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
  let scaleX = width / vW;
  let scaleY = height / vH;
  for (let j = 0; j < connections.length; j++) {
    let pA = pose.keypoints[connections[j][0]];
    let pB = pose.keypoints[connections[j][1]];
    if (pA.confidence > 0.1 && pB.confidence > 0.1) line(pA.x * scaleX, pA.y * scaleY, pB.x * scaleX, pB.y * scaleY);
  }
  noStroke();
  fill(255, 105, 180);
  pose.keypoints.forEach((kp) => {
    if (kp.confidence > 0.1) circle(kp.x * scaleX, kp.y * scaleY, 10);
  });
}

function drawDataHUD(pose) {
  textAlign(CENTER, CENTER);
  textSize(14);
  let scaleX = width / vW;
  let scaleY = height / vH;
  pose.keypoints.forEach((kp) => {
    if (kp.confidence > 0.2 && (kp.name.includes("wrist") || kp.name.includes("ankle") || kp.name === "nose")) {
      let kx = kp.x * scaleX;
      let ky = kp.y * scaleY;
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
  let box = pose.box;
  if (!box) return;
  let scaleX = width / vW;
  let scaleY = height / vH;
  stroke(255, 255, 0);
  strokeWeight(4);
  noFill();
  rect(box.xMin * scaleX, box.yMin * scaleY, box.width * scaleX, box.height * scaleY);
  let avgConf = pose.keypoints.reduce((a, b) => a + b.confidence, 0) / pose.keypoints.length;
  noStroke();
  fill(255, 255, 0);
  textSize(22);
  textAlign(LEFT, TOP);
  text(`PERSON ${nf(avgConf * 100, 1, 1)}%`, box.xMin * scaleX + 5, box.yMin * scaleY + 5);
}
