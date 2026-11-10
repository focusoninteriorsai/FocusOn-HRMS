// Camera capture is not initiated by Phase 1. These helpers are used by the
// attendance module only after feature-switch and consent checks succeed.
export async function openCamera(videoElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('unsupported'), { code: 'CAMERA_UNSUPPORTED' });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  videoElement.srcObject = stream;
  await videoElement.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function captureCompressedFrame(videoElement, { maxSize = 640, quality = 0.72 } = {}) {
  if (!videoElement.videoWidth || !videoElement.videoHeight) {
    throw Object.assign(new Error('notReady'), { code: 'CAMERA_NOT_READY' });
  }
  const scale = Math.min(1, maxSize / Math.max(videoElement.videoWidth, videoElement.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(videoElement.videoWidth * scale);
  canvas.height = Math.round(videoElement.videoHeight * scale);
  canvas.getContext('2d', { alpha: false }).drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw Object.assign(new Error('captureFailed'), { code: 'CAMERA_CAPTURE_FAILED' });
  return blob;
}
