import * as KotOR from "@/apps/game/KotOR";

/** Texture name -> image URL (or null when the game has no such texture); each texture is read once */
const cache = new Map<string, Promise<string | null>>();

/**
 * One of the game's textures (a portrait, an item icon) as an image URL for the page, read from the
 * game's files the way Forge's texture viewer reads them.
 */
export function gameTextureUrl(name: string): Promise<string | null> {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return Promise.resolve<string | null>(null);
  let pending = cache.get(key);
  if (!pending) {
    pending = load(key).catch((): string | null => null);
    cache.set(key, pending);
  }
  return pending;
}

async function load(name: string): Promise<string | null> {
  const found = await KotOR.TextureLoader.tpcLoader.findTPC(name);
  if (!found?.buffer) return null;
  const tpc = new KotOR.TPCObject({ file: found.buffer, filename: `${name}.tpc`, pack: found.pack } as any);
  const width = tpc.header.width;
  const height = tpc.header.height;
  if (!width || !height) return null;

  // The first mipmap, decompressed
  const dds = tpc.getDDS(false);
  const source: Uint8Array = dds.mipmaps[0].data;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (tpc.header.bitsPerPixel === 8) {
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = source[i];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    rgba.set(source.subarray(0, rgba.length));
  }

  // Textures are stored bottom row first
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = new ImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) image.data.set(rgba.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  ctx.putImageData(image, 0, 0);
  return await new Promise<string | null>((resolve) => canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png'));
}
