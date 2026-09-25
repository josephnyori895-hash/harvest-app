import fs from "node:fs";

const manifestPath = "android/app/src/main/AndroidManifest.xml";
if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}`);
const xml = fs.readFileSync(manifestPath, "utf8");
const checks = [
  ["no literal escaped newlines", !xml.includes("\\n")],
  ["manifest root exists", xml.includes("<manifest") && xml.includes('xmlns:android="http://schemas.android.com/apk/res/android"')],
  ["MainActivity exists", xml.includes('android:name=".MainActivity"')],
  ["MainActivity exported", xml.includes('android:exported="true"')],
  ["adjustResize configured", xml.includes('android:windowSoftInputMode="adjustResize"')],
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log("PASS: release preflight validation completed");
