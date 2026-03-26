let video;
// AI Models
let bodyPose, segBodyPix, segSelfie, depthEstimator;
// Data storage
let poses = [];
let segBPResult, segSelfieResult, depthMap;
let connections, partGroups;
let partsInitialized = false;

// 3D Rendering & Camera Controls
let depthBuffer;
let camRotX = 0;
let camRotY = 0;
let camZoom = 0;
let newDataAvailable = false;

// THE FIX: Data Caches to prevent CPU starvation
let pcPoints = [];
let meshTriangles = [];

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
    waitForVideo();
  });
  video.size(vW, vH);
  video.hide();
}

function waitForVideo() {
  if (video && video.elt && video.elt.readyState === 4 && video.elt.videoWidth > 0) {
    document.getElementById("status").innerText = "Booting Models...";
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

    setTimeout(() => {
      document.getElementById("status").innerText = "All Systems Active";
      depthEstimator.estimateStart(video, (res) => {
        depthMap = res;
        newDataAvailable = true;
      });
    }, 500);
  } else {
    setTimeout(waitForVideo, 100);
  }
}

// Controls for the 3D buffer
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
    let canvasElt = document.querySelector("canvas");
    if (canvasElt) {
      if (!document.fullscreenElement) canvasElt.requestFullscreen().catch((err) => console.log(err));
      else document.exitFullscreen();
    }
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
      camRotX = 0;
      camRotY = 0;
      camZoom = 0;
    });
  });
}

// THE FIX: Heavy Data Extraction happens ONLY when new data is ready
function updatePointCloudData() {
  pcPoints = [];
  if (!depthMap || !depthMap.sourceFrame) return;
  let src = depthMap.sourceFrame;
  src.loadPixels();
  let step = 4; // Safest increment for mobile devices

  for (let y = 0; y < vH; y += step) {
    for (let x = 0; x < vW; x += step) {
      try {
        let depth = depthMap.getDepthAt(x, y);
        if (depth > 0) {
          let idx = (x + y * vW) * 4;
          let z = map(depth, 0, 1, 200, -200);
          pcPoints.push({ x: x, y: y, z: z, r: src.pixels[idx], g: src.pixels[idx + 1], b: src.pixels[idx + 2] });
        }
      } catch (e) {}
    }
  }
}

function updateMeshData() {
  meshTriangles = [];
  if (!depthMap || typeof depthMap.getDepthAt !== "function") return;
  let step = 4;
  let cols = floor(vW / step);
  let rows = floor(vH / step);

  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      let x1 = x * step,
        y1 = y * step,
        x2 = (x + 1) * step,
        y2 = y * step;
      let x3 = x * step,
        y3 = (y + 1) * step,
        x4 = (x + 1) * step,
        y4 = (y + 1) * step;

      try {
        let d1 = depthMap.getDepthAt(x1, y1);
        let d2 = depthMap.getDepthAt(x2, y2);
        let d3 = depthMap.getDepthAt(x3, y3);
        let d4 = depthMap.getDepthAt(x4, y4);

        let z1 = map(d1, 0, 1, 200, -200);
        let z2 = map(d2, 0, 1, 200, -200);
        let z3 = map(d3, 0, 1, 200, -200);
        let z4 = map(d4, 0, 1, 200, -200);

        if (d1 > 0 && d2 > 0 && d3 > 0 && abs(d1 - d2) < 0.1 && abs(d1 - d3) < 0.1) {
          meshTriangles.push([
            { x: x1, y: y1, z: z1, u: x1 / vW, v: y1 / vH },
            { x: x2, y: y2, z: z2, u: x2 / vW, v: y2 / vH },
            { x: x3, y: y3, z: z3, u: x3 / vW, v: y3 / vH },
          ]);
        }
        if (d2 > 0 && d4 > 0 && d3 > 0 && abs(d2 - d4) < 0.1 && abs(d2 - d3) < 0.1) {
          meshTriangles.push([
            { x: x2, y: y2, z: z2, u: x2 / vW, v: y2 / vH },
            { x: x4, y: y4, z: z4, u: x4 / vW, v: y4 / vH },
            { x: x3, y: y3, z: z3, u: x3 / vW, v: y3 / vH },
          ]);
        }
      } catch (e) {}
    }
  }
}

function draw() {
  background(15);
  if (!video) return;

  // ONLY extract data if the async thread delivered a new frame
  if (newDataAvailable && depthMap) {
    if (currentMode === "pointcloud") updatePointCloudData();
    if (currentMode === "mesh") updateMeshData();
    newDataAvailable = false;
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
    if (depthMap) drawDepthMask();
  } else if (currentMode === "pointcloud" || currentMode === "mesh") {
    depthBuffer.clear();
    depthBuffer.background(0);
    depthBuffer.push();
    depthBuffer.translate(0, 0, camZoom);
    depthBuffer.rotateX(camRotX);
    depthBuffer.rotateY(camRotY);

    if (currentMode === "pointcloud") drawPointCloud();
    if (currentMode === "mesh") drawMesh();

    depthBuffer.pop();
    image(depthBuffer, 0, 0);
    fill(0, 255, 255);
    noStroke();
    textSize(16);
    textAlign(LEFT, TOP);
    text("Drag to Orbit | Scroll to Zoom", 10, 10);
  }
}

function drawDepthMask() {
  if (depthMap && depthMap.image && depthMap.mask) {
    try {
      // Create a safely cloned image so we don't corrupt the ml5 background pipeline
      let safeCopy = depthMap.image.get();
      safeCopy.mask(depthMap.mask);
      image(safeCopy, 0, 0, width, height);
    } catch (e) {}
  }
}

// 60FPS Draw Loop: We only loop over the pre-calculated array!
function drawPointCloud() {
  depthBuffer.push();
  depthBuffer.scale(2);
  depthBuffer.translate(-vW / 2, -vH / 2, 0);
  depthBuffer.strokeWeight(4);
  for (let p of pcPoints) {
    depthBuffer.stroke(p.r, p.g, p.b, 255);
    depthBuffer.point(p.x, p.y, p.z);
  }
  depthBuffer.pop();
}

function drawMesh() {
  let useTexture = document.getElementById("textureToggle").checked;
  depthBuffer.noStroke();
  if (!useTexture) {
    depthBuffer.fill(0, 255, 255);
    depthBuffer.stroke(0, 150, 150);
  }

  depthBuffer.push();
  depthBuffer.scale(2);
  depthBuffer.translate(-vW / 2, -vH / 2, 0);
  if (useTexture && depthMap && depthMap.sourceFrame) {
    depthBuffer.textureMode(NORMAL);
    depthBuffer.texture(depthMap.sourceFrame);
  }

  depthBuffer.beginShape(TRIANGLES);
  for (let tri of meshTriangles) {
    if (useTexture) {
      depthBuffer.vertex(tri[0].x, tri[0].y, tri[0].z, tri[0].u, tri[0].v);
      depthBuffer.vertex(tri[1].x, tri[1].y, tri[1].z, tri[1].u, tri[1].v);
      depthBuffer.vertex(tri[2].x, tri[2].y, tri[2].z, tri[2].u, tri[2].v);
    } else {
      depthBuffer.vertex(tri[0].x, tri[0].y, tri[0].z);
      depthBuffer.vertex(tri[1].x, tri[1].y, tri[1].z);
      depthBuffer.vertex(tri[2].x, tri[2].y, tri[2].z);
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
  if (activeSegModel === "bodypix" && partsInitialized && segBPResult) trackAndLabelParts(segBPResult);
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
