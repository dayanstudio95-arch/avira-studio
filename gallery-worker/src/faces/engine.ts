// Face detection and description in the browser, with the open face-api models served from our
// own site (/models). Loaded only on the pages that need it (studio indexing, guest selfie).
// Tests replace the engine through `window.__faceEngine`.
import type { IndexedFace } from '../../shared/faces';

export interface FaceEngine {
  /** Every face in a photo (boxes as fractions of the image). */
  detectAll(img: HTMLCanvasElement): Promise<IndexedFace[]>;
  /** The biggest face in a selfie (with where it is and how sure), or null. Test engines may return the numbers only. */
  detectOne(img: HTMLCanvasElement): Promise<SelfieFace | Float32Array | null>;
}

export interface SelfieFace {
  descriptor: Float32Array;
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

declare global {
  interface Window {
    __faceEngine?: FaceEngine;
  }
}

let loading: Promise<FaceEngine> | null = null;

export function getFaceEngine(onStatus?: (text: string) => void): Promise<FaceEngine> {
  if (window.__faceEngine) return Promise.resolve(window.__faceEngine);
  if (loading) return loading;
  loading = (async () => {
    onStatus?.('טוען את מנוע זיהוי הפנים…');
    const faceapi = await import('@vladmandic/face-api');
    // The bundled TensorFlow build: its typings leave out these two calls.
    const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
    try {
      if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu');
    } catch {
      await tf.setBackend('cpu');
    }
    await tf.ready();
    await Promise.all([faceapi.nets.ssdMobilenetv1.loadFromUri('/models'), faceapi.nets.faceLandmark68Net.loadFromUri('/models'), faceapi.nets.faceRecognitionNet.loadFromUri('/models')]);
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 40 });
    return {
      async detectAll(img) {
        const found = await faceapi.detectAllFaces(img, options).withFaceLandmarks().withFaceDescriptors();
        return found
          // Very small faces (far in the crowd) give unreliable descriptors.
          .filter((f) => f.detection.box.width >= 28)
          .map((f) => {
            const b = f.detection.box;
            return { box: [b.x / img.width, b.y / img.height, b.width / img.width, b.height / img.height], vec: Array.from(f.descriptor) } as IndexedFace;
          });
      },
      async detectOne(img) {
        const found = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4, maxResults: 10 })).withFaceLandmarks().withFaceDescriptors();
        if (found.length === 0) return null;
        const biggest = found.sort((a, b) => b.detection.box.area - a.detection.box.area)[0];
        const b = biggest.detection.box;
        return { descriptor: biggest.descriptor, box: { x: b.x, y: b.y, width: b.width, height: b.height }, score: biggest.detection.score };
      },
    } satisfies FaceEngine;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/** A photo or file drawn on a canvas no larger than `max` pixels on its long side. */
export async function toCanvas(src: Blob, max = 1280): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}
