const __v2 = 1;
/**
 * Capture a screenshot using the browser's Screen Capture API
 * Returns: { json: {success, filename, mimeType, size, width, height}, bytes: {content: Uint8Array} }
 */
async function captureScreen(args) {
  try {
    // Request screen capture permission
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        mediaSource: 'screen',
        cursor: 'always'
      },
      audio: false
    });

    // Create a video element to capture the frame
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;

    // Wait for video to be ready
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    // Give it a moment to render
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create canvas and capture the frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Stop all tracks
    stream.getTracks().forEach(track => track.stop());

    // Convert canvas to blob, then to Uint8Array
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Generate a unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;

    console.log('[`screenshot`] Captured screenshot, size:', bytes.length);

    return {
      json: {
        success: true,
        filename: filename,
        mimeType: 'image/png',
        size: bytes.length,
        width: canvas.width,
        height: canvas.height
      },
      bytes: {
        content: bytes
      }
    };
  } catch (err) {
    // User cancelled or error occurred
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return { json: { success: false, cancelled: true } };
    }

    return { json: { success: false, error: err.message } };
  }
}

registerModule({
  captureScreen,
});
