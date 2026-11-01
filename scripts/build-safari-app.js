import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const platform = process.argv[2];
if (process.platform !== "darwin" || !["ios", "macos"].includes(platform) || process.argv.length !== 3) {
  console.error("macOSで npm run build:safari:ios または npm run build:safari:macos を実行してください。");
  process.exit(1);
}
const root = fileURLToPath(new URL("../", import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
run("npm", ["run", "prepare:safari"]);
const ios = platform === "ios";
run("xcodebuild", [
  "-project", "native/safari/Sche10le.xcodeproj",
  "-scheme", ios ? "Sche10le (iOS)" : "Sche10le (macOS)",
  "-configuration", "Debug",
  "-sdk", ios ? "iphonesimulator" : "macosx",
  "-destination", ios ? "generic/platform=iOS Simulator" : "generic/platform=macOS",
  "-derivedDataPath", `.output/safari-derived-${platform}`,
  "CODE_SIGNING_ALLOWED=NO", "build",
]);
