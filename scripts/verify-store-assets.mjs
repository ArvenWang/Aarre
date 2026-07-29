import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const expectedJpegs = new Map([
  ["store-assets/screenshots/00-search.jpg", [640, 400]],
  ["store-assets/screenshots/01-organize.jpg", [1280, 800]],
  ["store-assets/screenshots/02-report.jpg", [1280, 800]],
  ["store-assets/screenshots/03-topics.jpg", [1280, 800]],
  ["store-assets/promo-small.jpg", [440, 280]]
]);

function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("不是 JPEG 文件");
  }
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return [
        buffer.readUInt16BE(offset + 7),
        buffer.readUInt16BE(offset + 5)
      ];
    }
    offset += 2 + segmentLength;
  }
  throw new Error("JPEG 缺少尺寸信息");
}

for (const [relativePath, expected] of expectedJpegs) {
  const actual = jpegSize(await readFile(resolve(root, relativePath)));
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    throw new Error(
      `${relativePath} 尺寸错误：${actual.join("×")}，应为 ${expected.join("×")}`
    );
  }
}

const videoPath = resolve(root, "store-assets/aarre-overview-36s.mp4");
const probe = spawnSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate",
    "-of",
    "json",
    videoPath
  ],
  { encoding: "utf8", shell: false }
);
if (probe.status !== 0) {
  throw new Error(
    `ffprobe 无法验证宣传视频：${probe.stderr || "未安装 ffprobe"}`
  );
}
const video = JSON.parse(probe.stdout);
const duration = Number(video.format?.duration);
const videoStream = video.streams?.find(
  (stream) => stream.codec_type === "video"
);
const audioStream = video.streams?.find(
  (stream) => stream.codec_type === "audio"
);
if (!(duration >= 30 && duration <= 45)) {
  throw new Error(`宣传视频时长 ${duration} 秒，不在 30–45 秒范围`);
}
if (
  videoStream?.codec_name !== "h264" ||
  videoStream.width !== 1280 ||
  videoStream.height !== 800 ||
  videoStream.r_frame_rate !== "30/1"
) {
  throw new Error("宣传视频必须是 1280×800、30fps 的 H.264");
}
if (audioStream?.codec_name !== "aac") {
  throw new Error("宣传视频必须包含 AAC 音轨");
}

console.log(
  `商店素材验证通过：5 张 JPEG 尺寸正确，视频 ${duration.toFixed(2)} 秒、1280×800、H.264/AAC。`
);
