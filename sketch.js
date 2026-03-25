let video;
let detector;
let detections = [];
let currentFacingMode = 'user'; // 'user' = front camera, 'environment' = back camera

function setup() {
  createCanvas(640, 480);
  
  // Initialize the camera stream
  startCamera();
  
  // Initialize the COCO-SSD object detector
  detector = ml5.objectDetector('cocossd', modelReady);
  
  // Set up the camera switch button
  let switchBtn = document.getElementById('switchBtn');
  switchBtn.addEventListener('click', switchCamera);
}

function modelReady() {
  document.getElementById('status').innerText = "Model loaded! Detecting...";
  // Start the continuous detection loop
  detectObjects();
}

function startCamera() {
  // Define video constraints
  let constraints = {
    video: {
      facingMode: currentFacingMode
    },
    audio: false
  };

  // Create the video capture element
  video = createCapture(constraints, function() {
    // This callback runs when the video is successfully loaded
    console.log("Camera loaded");
  });
  
  video.size(640, 480);
  video.hide(); // Hide the raw HTML video element, since it is drawn on the p5 canvas
}

function switchCamera() {
  // Toggle the facing mode
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  
  // Remove the old video element to free up the webcam
  if (video) {
    video.remove();
  }
  
  // Restart the camera with the new constraints
  startCamera();
  
  // Re-initiate detection on the new video feed
  if (detector) {
    detectObjects();
  }
}

function detectObjects() {
  // Tell ml5 to look at the video stream and trigger gotDetections when done
  if (video && video.loadedmetadata) {
    detector.detect(video, gotDetections);
  } else {
    // If video isn't ready yet, try again in a few milliseconds
    setTimeout(detectObjects, 100);
  }
}

function gotDetections(error, results) {
  if (error) {
    console.error(error);
    return;
  }
  
  detections = results;
  
  // Loop the detection continuously
  detectObjects();
}

function draw() {
  background(0);
  
  // Draw the video frame to the canvas
  if (video) {
 if (currentFacingMode === 'user') {
      translate(width, 0);
      scale(-1, 1);
    }
    
    image(video, 0, 0, width, height);
  }

  // Draw bounding boxes around detected people
  for (let i = 0; i < detections.length; i++) {
    let object = detections[i];
    
    // Only  draw boxes for people
    if (object.label === 'person') {
      stroke(0, 255, 0); // Green box
      strokeWeight(4);
      noFill();
      rect(object.x, object.y, object.width, object.height);
      
      // Draw the label and confidence score
      noStroke();
      fill(0, 255, 0);
      textSize(24);
      let confidence = nf(object.confidence * 100, 2, 1); // Format to 1 decimal place
      text(`${object.label} ${confidence}%`, object.x + 5, object.y + 25);
    }
  }
}
