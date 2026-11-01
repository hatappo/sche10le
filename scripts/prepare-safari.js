import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Synchronize only generated metadata; never overwrite the Xcode project/signing.
 * @param {string} root
 */
export async function prepareSafari(root) {
  const read = async (name) => readFile(path.join(root, name), "utf8");
  const pkg = JSON.parse(await read("package.json"));
  const manifest = JSON.parse(await read(".output/safari-mv3/manifest.json"));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || manifest.version !== pkg.version) {
    throw new Error("package.jsonとSafariビルドのバージョンが一致しません。npm run build:safariを実行してください。");
  }
  const project = await read("native/safari/Sche10le.xcodeproj/project.pbxproj");
  const references = [...project.matchAll(/path = "\.\.\/\.\.\/\.output\/safari-mv3\/([^"/]+)"; sourceTree = SOURCE_ROOT/g)]
    .map((match) => match[1]).sort();
  const resources = (await readdir(path.join(root, ".output/safari-mv3"))).sort();
  if (JSON.stringify(references) !== JSON.stringify(resources)) {
    throw new Error("Safariの生成物とXcodeのリソース参照が一致しません。両ExtensionターゲットのCopy Bundle Resourcesを更新してください。");
  }
  const config = `// Generated from package.json by npm run prepare:safari.\nMARKETING_VERSION = ${pkg.version}\n`;
  await writeFile(path.join(root, "native/safari/Config/Version.xcconfig"), config);
  return pkg.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    const version = await prepareSafari(root);
    console.log(`Safari ${version}: Xcode用のWebリソースとバージョンを確認しました。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
