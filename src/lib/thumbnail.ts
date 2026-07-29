const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const THUMBNAIL_SIZE = 112;

async function readLimitedBlob(
  response: Response,
  maxBytes = MAX_IMAGE_BYTES
): Promise<Blob> {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) {
    throw new Error("代表图文件过大");
  }
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error("代表图文件过大");
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("代表图文件过大");
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new Blob(chunks, {
    type: response.headers.get("content-type") || "image/jpeg"
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      parts.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      );
    }
    return `data:${blob.type};base64,${btoa(parts.join(""))}`;
  });
}

/**
 * 在扩展后台把远程代表图裁成 2x 列表尺寸的 WebP。
 * 缓存只写入本机 IndexedDB，不会同步到云端。
 */
export async function cacheRepresentativeImage(
  imageUrl: string
): Promise<string> {
  if (!imageUrl) return "";
  const response = await fetch(imageUrl, {
    credentials: "omit",
    redirect: "follow",
    headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.5" },
    signal: AbortSignal.timeout(12_000)
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
    throw new Error("代表图无法读取");
  }

  const source = await readLimitedBlob(response);
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("代表图处理不可用");

    const scale = Math.max(
      THUMBNAIL_SIZE / bitmap.width,
      THUMBNAIL_SIZE / bitmap.height
    );
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (THUMBNAIL_SIZE - width) / 2,
      (THUMBNAIL_SIZE - height) / 2,
      width,
      height
    );
    return blobToDataUrl(
      await canvas.convertToBlob({ type: "image/webp", quality: 0.78 })
    );
  } finally {
    bitmap.close();
  }
}
