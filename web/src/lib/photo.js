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

export async function uploadPhoto(file) {
  const dataUrl = await shrinkPhoto(file);
  const r = await api('/api/media', { method: 'POST', body: { dataUrl } });
  return r.url;
}
