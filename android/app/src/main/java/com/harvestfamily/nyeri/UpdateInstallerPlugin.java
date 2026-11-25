package com.harvestfamily.nyeri;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Downloads the release APK inside the app and hands it to Android's package
 * installer. The old flow used window.open(..., '_system'), which left the app
 * and handed the member to a browser download. Downloading here keeps the
 * update in context: progress is reported to the web layer, and when the file
 * is ready the OS installer opens over the app.
 *
 * Android 8+ requires the one-time "install unknown apps" grant for a sideloaded
 * APK. That screen is unavoidable, so this plugin opens the app-specific page,
 * remembers the URL, and starts the download automatically on return once the
 * permission is granted.
 *
 * Downloads are resumable: a dropped connection leaves the .part file in cache
 * and the next attempt asks for the remaining bytes with an HTTP Range header.
 * When the release manifest supplies a SHA-256, the finished APK is verified
 * before the installer is opened.
 */
@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    private static final String TAG = "UpdateInstaller";
    private static final String APK_NAME = "harvest-update.apk";
    private static final String PART_NAME = "harvest-update.apk.part";
    private static final String META_NAME = "harvest-update.meta";
    // Android's package installer ships under different names. Targeting the
    // one that exists skips the "Open with Files / Package installer" chooser
    // that the APK MIME type otherwise triggers.
    private static final String[] INSTALLER_PACKAGES = {
            "com.google.android.packageinstaller",
            "com.android.packageinstaller",
    };

    private volatile String pendingUrl;
    private volatile String pendingSha256;
    private volatile boolean downloading;

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing update URL");
            return;
        }
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Unsupported update URL");
            return;
        }

        String rawChecksum = call.getString("sha256");
        String checksum = rawChecksum == null ? "" : rawChecksum.trim().toLowerCase(Locale.US);
        if (!checksum.isEmpty() && !checksum.matches("[0-9a-f]{64}")) {
            call.reject("Invalid update checksum");
            return;
        }

        if (downloading) {
            JSObject out = new JSObject();
            out.put("status", "downloading");
            call.resolve(out);
            return;
        }

        if (!canInstallPackages()) {
            pendingUrl = url;
            pendingSha256 = checksum;
            JSObject out = new JSObject();
            out.put("status", "permission");
            call.resolve(out);
            openInstallPermissionSettings();
            return;
        }

        JSObject out = new JSObject();
        out.put("status", "downloading");
        call.resolve(out);
        startDownload(url, checksum);
    }

    @Override
    public void handleOnResume() {
        String url = pendingUrl;
        if (url == null || downloading) return;

        String checksum = pendingSha256 == null ? "" : pendingSha256;
        pendingUrl = null;
        pendingSha256 = null;
        if (canInstallPackages()) {
            startDownload(url, checksum);
        } else {
            emitStatus("permission-denied", -1,
                    "Install permission is still off. Tap Update now and allow installs from Harvest Family.");
        }
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstallPermissionSettings() {
        Activity activity = getActivity();
        if (activity == null) return;
        try {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            activity.startActivity(intent);
        } catch (Exception first) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
            } catch (Exception second) {
                Log.w(TAG, "No install-settings screen available", second);
                emitStatus("error", -1,
                        "Couldn’t open Android install settings. Allow installs from Harvest Family in Settings, then try again.");
            }
        }
    }

    private void startDownload(String url, String checksum) {
        if (downloading) return;
        downloading = true;
        emitStatus("downloading", 0, "Starting download…");

        new Thread(() -> {
            HttpURLConnection connection = null;
            File part = new File(getContext().getCacheDir(), PART_NAME);
            File apk = new File(getContext().getCacheDir(), APK_NAME);
            File meta = new File(getContext().getCacheDir(), META_NAME);
            try {
                preparePartial(url, checksum, part, meta);
                boolean retried = false;

                while (true) {
                    long existing = part.length();
                    connection = openFollowingRedirects(url, existing);
                    int code = connection.getResponseCode();

                    long done;
                    long total;
                    boolean append;
                    if (code == HttpURLConnection.HTTP_PARTIAL && existing > 0) {
                        done = existing;
                        long end = existing + connection.getContentLengthLong();
                        total = contentRangeTotal(connection.getHeaderField("Content-Range"), end);
                        if (total < done) total = end;
                        append = true;
                    } else if (code == HttpURLConnection.HTTP_OK) {
                        // The server ignored Range (or this is a fresh attempt).
                        done = 0;
                        total = connection.getContentLengthLong();
                        append = false;
                    } else if (code == 416 && existing > 0) {
                        // The cached fragment no longer fits the remote file.
                        connection.disconnect();
                        connection = null;
                        if (!part.delete()) throw new IOException("Could not reset partial update");
                        continue;
                    } else {
                        throw new IOException("Update download failed with HTTP " + code);
                    }

                    if (done > 0 && total > 0) {
                        int percent = (int) Math.min(99, (done * 100) / total);
                        emitStatus("downloading", percent,
                                String.format(Locale.US, "Resuming download… %d%%", percent));
                    }

                    int lastPercent = -1;
                    long lastEmit = 0;
                    byte[] buffer = new byte[64 * 1024];

                    try (InputStream in = connection.getInputStream();
                         FileOutputStream out = new FileOutputStream(part, append)) {
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                            done += read;

                            if (total > 0) {
                                int percent = (int) Math.min(100, (done * 100) / total);
                                long now = System.currentTimeMillis();
                                if (percent != lastPercent && (percent == 100 || now - lastEmit >= 250)) {
                                    lastPercent = percent;
                                    lastEmit = now;
                                    emitStatus("downloading", percent,
                                            String.format(Locale.US, "Downloading update… %d%%", percent));
                                }
                            }
                        }
                    }

                    connection.disconnect();
                    connection = null;

                    if (done == 0) throw new IOException("Downloaded update is empty");
                    // A server can end the body early without throwing. Keep the
                    // partial file so the next attempt resumes instead of
                    // presenting a truncated APK to the installer.
                    if (total > 0 && done < total) {
                        throw new IOException("Update download ended early");
                    }

                    if (!checksum.isEmpty() && !checksum.equals(sha256(part))) {
                        if (!part.delete()) throw new IOException("Could not reset failed update");
                        if (!retried) {
                            retried = true;
                            emitStatus("downloading", 0, "Update failed verification. Downloading again…");
                            continue;
                        }
                        throw new ChecksumException();
                    }

                    if (apk.exists() && !apk.delete()) throw new IOException("Could not replace old update file");
                    if (!part.renameTo(apk)) throw new IOException("Could not finish saving the update");
                    meta.delete();

                    downloading = false;
                    emitStatus("installing", 100, "Opening installer…");
                    installApk(apk);
                    return;
                }
            } catch (ChecksumException e) {
                downloading = false;
                part.delete();
                meta.delete();
                Log.w(TAG, "In-app update failed SHA-256 verification", e);
                emitStatus("error", -1,
                        "The update file failed its security check. Check your connection and try again.");
            } catch (Exception e) {
                downloading = false;
                Log.w(TAG, "In-app update download failed", e);
                emitStatus("error", -1,
                        "Couldn’t download the update. Check your connection and try again.");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "harvest-update-download").start();
    }

    private static class ChecksumException extends IOException {
        ChecksumException() {
            super("Update checksum did not match");
        }
    }

    /**
     * A .part file can only be resumed for the same release. Stamping the URL
     * and digest next to it prevents bytes from an older APK being appended to
     * the new download.
     */
    private void preparePartial(String url, String checksum, File part, File meta) throws IOException {
        String identity = url + "\n" + checksum;
        String saved = readText(meta);
        if (part.exists() && !identity.equals(saved)) {
            if (!part.delete()) throw new IOException("Could not reset stale partial update");
        }
        writeText(meta, identity);
    }

    private String readText(File file) {
        if (!file.isFile()) return null;
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[512];
            int read = in.read(buffer);
            return read <= 0 ? "" : new String(buffer, 0, read, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private void writeText(File file, String value) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file, false)) {
            out.write(value.getBytes(StandardCharsets.UTF_8));
        }
    }

    private HttpURLConnection openFollowingRedirects(String rawUrl, long rangeStart) throws IOException {
        String current = rawUrl;
        for (int hop = 0; hop < 5; hop++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "HarvestFamily-Android");
            if (rangeStart > 0) {
                connection.setRequestProperty("Range", "bytes=" + rangeStart + "-");
            }

            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new IOException("Update redirect had no destination");
                }
                current = new URL(new URL(current), location).toString();
                continue;
            }
            return connection;
        }
        throw new IOException("Too many update redirects");
    }

    private long contentRangeTotal(String header, long fallback) {
        if (header == null) return fallback;
        int slash = header.lastIndexOf('/');
        if (slash < 0 || slash == header.length() - 1) return fallback;
        String value = header.substring(slash + 1).trim();
        if ("*".equals(value)) return fallback;
        try {
            long total = Long.parseLong(value);
            return total > 0 ? total : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte b : digest.digest()) {
            hex.append(String.format(Locale.US, "%02x", b));
        }
        return hex.toString();
    }

    private void installApk(File apk) {
        Activity activity = getActivity();
        if (activity == null) {
            emitStatus("error", -1, "The app is no longer open. Reopen Harvest Family and try again.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                for (String installer : INSTALLER_PACKAGES) {
                    try {
                        Intent direct = new Intent(intent);
                        direct.setPackage(installer);
                        activity.startActivity(direct);
                        return;
                    } catch (Exception ignored) {
                        // Try the next known installer, then the implicit intent.
                    }
                }
                activity.startActivity(intent);
            } catch (Exception e) {
                Log.w(TAG, "Could not open the package installer", e);
                emitStatus("error", -1,
                        "The update downloaded but Android couldn’t open the installer. Try again.");
            }
        });
    }

    private void emitStatus(String status, int percent, String message) {
        JSObject data = new JSObject();
        data.put("status", status);
        data.put("percent", percent);
        data.put("message", message);
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> notifyListeners("status", data));
        } else {
            notifyListeners("status", data);
        }
    }
}
