// Shrinks a photo in the browser (longest side 1200 px, JPEG) and uploads it.
// Returns the public link WhatsApp uses to fetch it.
import { api } from './api.js';

export async function shrinkPhoto(file, max = 1200) {
  if (!/^image\//.test(file.type)) throw new Error('Choose a photo (JPG or PNG).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open that photo.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > 750_000 && quality > 0.4) {
      quality -= 0.12;
      data = canvas.toDataURL('image/jpeg', quality);
    }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MAX_VIDEO = 16 * 1024 * 1024;

/** Uploads a video as it is (MP4 or 3GP, up to 16 MB, WhatsApp's limit) and returns its link. */
export async function uploadVideo(file) {
  const type = file.type === 'video/3gpp' ? 'video/3gpp' : file.type === 'video/mp4' || /\.mp4$/i.test(file.name) ? 'video/mp4' : null;
  if (!type) throw new Error('Choose an MP4 video. WhatsApp plays MP4 (and 3GP) videos.');
  if (file.size > MAX_VIDEO) throw new Error(`That video is ${(file.size / 1024 / 1024).toFixed(1)} MB. WhatsApp allows up to 16 MB: shorten it or send a smaller one.`);
  let res;
  try {
    res = await fetch('/api/media/video', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': type }, body: file, signal: AbortSignal.timeout(5 * 60 * 1000) });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? 'The upload took too long. Try again on a faster connection.' : 'Could not upload the video. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not upload the video (${res.status}).`);
  return data.url;
}

export async function uploadPhoto(file) {
  const dataUrl = await shrinkPhoto(file);
  const r = await api('/api/media', { method: 'POST', body: { dataUrl }, timeout: 120000 }); // photos can be slow on mobile data
  return r.url;
}
