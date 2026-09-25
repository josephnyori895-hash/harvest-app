import fs from "node:fs";
import { spawnSync } from "node:child_process";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}`);
const xml = fs.readFileSync(manifestPath, "utf8");
const checks = [
  ["no literal escaped newlines", !xml.includes("\\\\n")],
  ["manifest root exists", /<manifest\\b[^>]*xmlns:android=/.test(xml)],
  ["MainActivity exists", /<activity\\b[^>]*android:name=\"\\.MainActivity\"/.test(xml)],
  ["MainActivity exported", /android:exported=\"true\"/.test(xml)],
  ["adjustResize configured", /android:windowSoftInputMode=\"adjustResize\"/.test(xml)],
];
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) process.exitCode = 1;
}
if (process.exitCode) process.exit(1);

const result = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("PASS: repository validation completed");
