/**
 * 把图片 Blob 转成 data URL。
 *
 * 注意：不能用 FileReader——它在 Manifest V3 Service Worker 中不存在，
 * 会导致右键图片设封面时转换永远卡住。这里用 ArrayBuffer + btoa，
 * 两者在 Service Worker 中都是可用 API。
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}
