// FOCUSON HRMS - In-App Camera & Selfie Capture Utility
// Captures camera frames with client-side JPEG compression (~30-50KB) for low-bandwidth mobile networks.
// Fallback to file input with capture="user" when getUserMedia is restricted.

export function compressImageFile(file, maxWidth = 640, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function openCameraCaptureModal({ onCapture, onCancel }) {
  let stream = null;

  const modalContainer = document.createElement('div');
  modalContainer.style.display = 'flex';
  modalContainer.style.flexDirection = 'column';
  modalContainer.style.alignItems = 'center';
  modalContainer.style.gap = '1rem';

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.width = '100%';
  video.style.maxWidth = '360px';
  video.style.aspectRatio = '4/3';
  video.style.borderRadius = 'var(--radius-md)';
  video.style.backgroundColor = '#000000';
  video.style.objectFit = 'cover';

  const previewCanvas = document.createElement('canvas');
  previewCanvas.style.display = 'none';

  const statusText = document.createElement('p');
  statusText.style.fontSize = '0.8125rem';
  statusText.style.color = 'var(--text-muted)';
  statusText.textContent = 'Initializing camera...';

  const controlsRow = document.createElement('div');
  controlsRow.style.display = 'flex';
  controlsRow.style.gap = '0.75rem';
  controlsRow.style.width = '100%';
  controlsRow.style.justifyContent = 'center';

  const snapBtn = document.createElement('button');
  snapBtn.className = 'btn btn-primary';
  snapBtn.textContent = 'Take Selfie';
  snapBtn.disabled = true;

  const fallbackInput = document.createElement('input');
  fallbackInput.type = 'file';
  fallbackInput.accept = 'image/*';
  fallbackInput.capture = 'user';
  fallbackInput.style.display = 'none';

  const fallbackBtn = document.createElement('button');
  fallbackBtn.className = 'btn btn-secondary';
  fallbackBtn.textContent = 'Upload Photo';
  fallbackBtn.onclick = () => fallbackInput.click();

  fallbackInput.onchange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const compressed = await compressImageFile(e.target.files[0]);
        cleanup();
        onCapture(compressed);
      } catch (err) {
        statusText.textContent = 'Failed to process image.';
      }
    }
  };

  controlsRow.appendChild(snapBtn);
  controlsRow.appendChild(fallbackBtn);
  controlsRow.appendChild(fallbackInput);

  modalContainer.appendChild(video);
  modalContainer.appendChild(statusText);
  modalContainer.appendChild(controlsRow);

  const cleanup = () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  };

  // Start video stream
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    }).then(s => {
      stream = s;
      video.srcObject = s;
      snapBtn.disabled = false;
      statusText.textContent = 'Look at the camera and tap Take Selfie';
    }).catch(err => {
      statusText.textContent = 'Camera blocked or unsupported. Use "Upload Photo" below.';
      snapBtn.style.display = 'none';
    });
  } else {
    statusText.textContent = 'In-app camera not supported on this browser. Use "Upload Photo".';
    snapBtn.style.display = 'none';
  }

  snapBtn.onclick = () => {
    if (!video.videoWidth) return;
    previewCanvas.width = video.videoWidth;
    previewCanvas.height = video.videoHeight;
    const ctx = previewCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Compress to JPEG 0.70
    const dataUrl = previewCanvas.toDataURL('image/jpeg', 0.7);
    cleanup();
    onCapture(dataUrl);
  };

  return {
    node: modalContainer,
    cleanup
  };
}
