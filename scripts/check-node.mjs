const minimumMajorVersion = 22;
const currentMajorVersion = Number.parseInt(
  process.versions.node.split(".")[0],
  10
);

if (!Number.isFinite(currentMajorVersion) || currentMajorVersion < minimumMajorVersion) {
  console.error(
    `Bookmark Layer 需要 Node.js ${minimumMajorVersion} 或更高版本，当前是 ${process.versions.node}。`
  );
  process.exit(1);
}
