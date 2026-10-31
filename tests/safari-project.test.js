import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareSafari } from "../scripts/prepare-safari.js";

const projectPath = "native/safari/Sche10le.xcodeproj/project.pbxproj";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "sche10le-native-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of [".output/safari-mv3", "native/safari/Sche10le.xcodeproj", "native/safari/Config"]) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  await writeFile(path.join(root, projectPath), await readFile(projectPath));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.6.1" }));
  await writeFile(path.join(root, ".output/safari-mv3/manifest.json"), JSON.stringify({ version: "0.6.1" }));
  for (const dir of ["chunks", "content-scripts", "icons"]) await mkdir(path.join(root, ".output/safari-mv3", dir));
  for (const file of ["background.js", "help.html"]) await writeFile(path.join(root, ".output/safari-mv3", file), "fixture");
  return root;
}

test("Safariの準備でバージョンだけを同期し、プロジェクトや署名設定を上書きしない", async (t) => {
  const root = await fixture(t);
  const signing = path.join(root, "native/safari/Config/Signing.local.xcconfig");
  await writeFile(signing, "DEVELOPMENT_TEAM = LOCAL_ONLY\n");
  const project = await readFile(path.join(root, projectPath), "utf8");
  assert.equal(await prepareSafari(root), "0.6.1");
  assert.match(await readFile(path.join(root, "native/safari/Config/Version.xcconfig"), "utf8"), /MARKETING_VERSION = 0\.6\.1/);
  assert.equal(await readFile(path.join(root, projectPath), "utf8"), project);
  assert.equal(await readFile(signing, "utf8"), "DEVELOPMENT_TEAM = LOCAL_ONLY\n");
});

test("古いSafariビルドやXcode未登録の生成物を検出して同期を中止する", async (t) => {
  const root = await fixture(t);
  const versionFile = path.join(root, "native/safari/Config/Version.xcconfig");
  await writeFile(versionFile, "unchanged");
  const manifest = path.join(root, ".output/safari-mv3/manifest.json");
  await writeFile(manifest, JSON.stringify({ version: "0.6.0" }));
  await assert.rejects(prepareSafari(root), /バージョンが一致/);
  await writeFile(manifest, JSON.stringify({ version: "0.6.1" }));
  await writeFile(path.join(root, ".output/safari-mv3/new-page.html"), "new entrypoint");
  await assert.rejects(prepareSafari(root), /リソース参照が一致/);
  assert.equal(await readFile(versionFile, "utf8"), "unchanged");
  await rm(path.join(root, ".output/safari-mv3/new-page.html"));
  await rm(path.join(root, ".output/safari-mv3/help.html"));
  await assert.rejects(prepareSafari(root), /リソース参照が一致/);
});

test("Git管理するSafari設定に個人情報・絶対パス・二重のバージョン定義を持ち込まない", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const version = await readFile("native/safari/Config/Version.xcconfig", "utf8");
  assert.ok(version.includes(`MARKETING_VERSION = ${pkg.version}\n`));
  const project = await readFile(projectPath, "utf8");
  assert.doesNotMatch(project, /\/Users\/|DEVELOPMENT_TEAM\s*=|MARKETING_VERSION\s*=|CURRENT_PROJECT_VERSION\s*=/);
  assert.equal((project.match(/baseConfigurationReference =/g) ?? []).length, 2);
  assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = "\$\(SCHE10LE_EXTENSION_BUNDLE_IDENTIFIER\)";/g) ?? []).length, 4);
  for (const platform of ["iOS", "macOS"]) {
    const scheme = await readFile(`native/safari/Sche10le.xcodeproj/xcshareddata/xcschemes/Sche10le (${platform}).xcscheme`, "utf8");
    assert.ok(scheme.includes(`BlueprintName="Sche10le (${platform})"`));
    const plist = await readFile(`native/safari/${platform} (App)/Info.plist`, "utf8");
    assert.match(plist, /\$\(SCHE10LE_EXTENSION_BUNDLE_IDENTIFIER\)/);
  }
  const ignored = execFileSync("git", ["check-ignore", "native/safari/Config/Signing.local.xcconfig", "native/safari/Sche10le.xcodeproj/xcuserdata/local.xcuserdatad/user.xcuserstate"], { encoding: "utf8" });
  assert.equal(ignored.trim().split("\n").length, 2);
});
