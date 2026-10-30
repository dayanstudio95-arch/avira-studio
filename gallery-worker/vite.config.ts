import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// The face-search models come from npm (@vladmandic/face-api) and are copied into public/models
// at the start of every dev server and build, instead of being tracked in git (fix plan P86-b).
const MODELS = ['face_landmark_68_model-weights_manifest.json', 'face_landmark_68_model.bin', 'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin', 'ssd_mobilenetv1_model-weights_manifest.json', 'ssd_mobilenetv1_model.bin'];
function copyFaceModels() {
  return {
    name: 'copy-face-models',
    configResolved() {
      const from = path.resolve(__dirname, 'node_modules/@vladmandic/face-api/model');
      const to = path.resolve(__dirname, 'public/models');
      fs.mkdirSync(to, { recursive: true });
      for (const f of MODELS) fs.copyFileSync(path.join(from, f), path.join(to, f));
    },
  };
}

// Dev ports 8796/5275: 8787 and 5173 belong to the original films app on Daniel's Mac.
export default defineConfig({
  plugins: [copyFaceModels(), react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5275, proxy: { '/api': 'http://localhost:8796' } },
});
