import * as THREE from 'three';

// Central asset manager. Every file the game needs is listed here and
// loaded up front by loadAssets() — the world is only built and the loop
// only starts once everything has settled, so nothing pops in late.
// Modules grab ready textures synchronously via texture()/ready().
const MANIFEST = {
  droneAtlas: `${import.meta.env.BASE_URL}drone-atlas.png`,
  bark: `${import.meta.env.BASE_URL}bark.png`,
  leaves: `${import.meta.env.BASE_URL}leaves-atlas.png`,
  skyDay: `${import.meta.env.BASE_URL}sky-day.png`,
  skyDawn: `${import.meta.env.BASE_URL}sky-dawn.png`,
  skyNight: `${import.meta.env.BASE_URL}sky-night.png`,
};

const cache = {};

export function loadAssets(onProgress) {
  const manager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(manager);
  return new Promise((resolve) => {
    manager.onProgress = (url, loaded, total) => onProgress?.(loaded / total);
    // A missing file is never fatal — materials keep their flat-color looks.
    manager.onError = (url) => console.warn(`asset missing: ${url}`);
    manager.onLoad = () => resolve(cache);
    for (const [name, url] of Object.entries(MANIFEST)) {
      cache[name] = loader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
      });
    }
  });
}

// A texture from the manifest; ready() says whether its file really loaded.
export const texture = (name) => cache[name];
export const ready = (name) => !!cache[name]?.image;
