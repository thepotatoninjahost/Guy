package com.gunther.console;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Gunther · ANDROID PROJECT HOST.
 *
 * The console is a WebView: it cannot list a directory, cannot write a file, and
 * cannot execute a process. This plugin is the only part of Gunther that touches
 * the device, and it is deliberately narrow:
 *
 *   · projects live in app-private storage as ordinary files, so they survive
 *     restart and can be exported the same way they were imported;
 *   · every path is resolved inside the project root and re-checked through the
 *     canonical path, so no caller can walk out of a project;
 *   · commands run as argv vectors (never as interpreted shell text) and only
 *     from system binary directories.
 *
 * That last rule is Android's, not Gunther's: apps targeting API 29+ may not
 * execve() a file inside their own data directory (W^X), so a project's own
 * binary or `chmod +x` script cannot be run directly. Scripts still run when a
 * system interpreter reads them as data: ["sh", "verify.sh"]. Anything else is
 * refused with BINARY_NOT_ALLOWED instead of being faked.
 *
 * The contract is written up in docs/android-project-contract.md.
 */
@CapacitorPlugin(name = "GuntherProject")
public class GuntherProjectPlugin extends Plugin {

    private static final String PLUGIN_VERSION = "1.0.0";
    private static final long MAX_TEXT_BYTES = 2000000L;
    private static final int MAX_LIST_FILES = 5000;
    private static final int MAX_OUTPUT_BYTES = 200000;
    private static final long DEFAULT_TIMEOUT_MS = 120000L;
    private static final long MAX_TIMEOUT_MS = 600000L;
    private static final int MAX_IMPORT_FILES = 2000;
    private static final long MAX_IMPORT_BYTES = 40000000L;
    private static final int BINARY_PROBE_BYTES = 8192;

    /** The only directories a child process may be launched from. */
    private static final String[] SYSTEM_BIN_DIRS = {
        "/system/bin", "/system/xbin", "/vendor/bin", "/apex/com.android.runtime/bin", "/system/sbin"
    };

    /** Reported by probeToolchain, present or not — absence is the answer. */
    private static final String[] TOOL_CANDIDATES = {
        "sh", "toybox", "busybox", "cat", "ls", "cp", "mv", "rm", "mkdir", "touch", "ln", "find",
        "grep", "sed", "awk", "sort", "uniq", "wc", "head", "tail", "cut", "tr", "xargs", "expr",
        "test", "diff", "patch", "sha256sum", "timeout", "env", "printf", "tee", "date", "sleep",
        "zip", "unzip", "tar", "gzip", "curl", "git", "make", "node", "npm", "python3", "ruby", "bash"
    };

    /* ------------------------------------------------------------------
       roots and index
       ------------------------------------------------------------------ */

    private File rootDir() {
        File dir = new File(getContext().getFilesDir(), "projects");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private File indexFile() {
        return new File(rootDir(), "index.json");
    }

    private String newId() {
        return "p-" + Long.toString(System.currentTimeMillis(), 36) + "-" + Integer.toHexString((int) (Math.random() * 0xFFFF));
    }

    private JSONArray readIndex() {
        File f = indexFile();
        if (!f.exists()) return new JSONArray();
        try {
            String raw = new String(readAll(new FileInputStream(f), 4000000L), StandardCharsets.UTF_8);
            JSONObject obj = new JSONObject(raw);
            JSONArray arr = obj.optJSONArray("projects");
            return arr == null ? new JSONArray() : arr;
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private void writeIndex(JSONArray projects) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("projects", projects);
            FileOutputStream out = new FileOutputStream(indexFile());
            try {
                out.write(obj.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
            } finally {
                out.close();
            }
        } catch (Exception e) {
            /* a lost index is rebuilt from the directories by listProjects */
        }
    }

    private JSONObject findEntry(String id) {
        JSONArray arr = readIndex();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    private void upsertEntry(JSONObject entry) {
        JSONArray arr = readIndex();
        JSONArray next = new JSONArray();
        boolean replaced = false;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            if (o.optString("id").equals(entry.optString("id"))) {
                next.put(entry);
                replaced = true;
            } else {
                next.put(o);
            }
        }
        if (!replaced) next.put(entry);
        writeIndex(next);
    }

    private void removeEntry(String id) {
        JSONArray arr = readIndex();
        JSONArray next = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            if (!o.optString("id").equals(id)) next.put(o);
        }
        writeIndex(next);
    }

    /* ------------------------------------------------------------------
       paths
       ------------------------------------------------------------------ */

    private boolean safeId(String id) {
        if (id == null || id.length() == 0 || id.length() > 80) return false;
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.';
            if (!ok) return false;
        }
        return !id.startsWith(".");
    }

    private File projectDir(String id) throws IOException {
        if (!safeId(id)) throw new IOException("unsafe project id");
        File dir = new File(rootDir(), id);
        if (!dir.exists()) throw new IOException("project not found: " + id);
        return dir;
    }

    /**
     * Resolve a project-relative path inside the root. Two independent checks:
     * the textual one stops traversal, the canonical one stops a symlink that
     * points out of the project.
     */
    private File resolve(File root, String rel) throws IOException {
        if (rel == null) throw new IOException("missing path");
        String cleaned = rel.replace('\\', '/').trim();
        while (cleaned.startsWith("./")) cleaned = cleaned.substring(2);
        if (cleaned.length() == 0) throw new IOException("empty path");
        if (cleaned.startsWith("/")) throw new IOException("absolute paths are not allowed");
        String[] parts = cleaned.split("/");
        List<String> keep = new ArrayList<String>();
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i];
            if (p.length() == 0 || p.equals(".")) continue;
            if (p.equals("..")) throw new IOException("path escapes the project");
            keep.add(p);
        }
        if (keep.isEmpty()) throw new IOException("empty path");
        StringBuilder joined = new StringBuilder();
        for (int i = 0; i < keep.size(); i++) {
            if (i > 0) joined.append('/');
            joined.append(keep.get(i));
        }
        File target = new File(root, joined.toString());
        String rootCanon = root.getCanonicalPath();
        String targetCanon = target.getCanonicalPath();
        if (!targetCanon.equals(rootCanon) && !targetCanon.startsWith(rootCanon + File.separator)) {
            throw new IOException("path escapes the project");
        }
        return target;
    }

    private String relPath(File root, File file) throws IOException {
        String rootCanon = root.getCanonicalPath();
        String canon = file.getCanonicalPath();
        if (!canon.startsWith(rootCanon + File.separator)) throw new IOException("outside project");
        return canon.substring(rootCanon.length() + 1).replace(File.separatorChar, '/');
    }

    private boolean insideProject(File root, File file) {
        try {
            String rootCanon = root.getCanonicalPath();
            String canon = file.getCanonicalPath();
            return canon.equals(rootCanon) || canon.startsWith(rootCanon + File.separator);
        } catch (IOException e) {
            return false;
        }
    }

    /* ------------------------------------------------------------------
       io helpers
       ------------------------------------------------------------------ */

    private byte[] readAll(InputStream in, long cap) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > cap) throw new IOException("file exceeds the " + (cap / 1000) + " KB working limit");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private byte[] readFileCapped(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            return readAll(in, MAX_TEXT_BYTES);
        } finally {
            in.close();
        }
    }

    private boolean looksBinary(byte[] data) {
        int limit = Math.min(data.length, BINARY_PROBE_BYTES);
        for (int i = 0; i < limit; i++) {
            if (data[i] == 0) return true;
        }
        return false;
    }

    private void writeText(File target, String text) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        FileOutputStream out = new FileOutputStream(target);
        try {
            out.write((text == null ? "" : text).getBytes(StandardCharsets.UTF_8));
            out.flush();
        } finally {
            out.close();
        }
    }

    private int countFiles(File dir) {
        int n = 0;
        File[] kids = dir.listFiles();
        if (kids == null) return 0;
        for (int i = 0; i < kids.length; i++) {
            if (kids[i].isDirectory()) n += countFiles(kids[i]);
            else n += 1;
        }
        return n;
    }

    private long dirBytes(File dir) {
        long n = 0;
        File[] kids = dir.listFiles();
        if (kids == null) return 0;
        for (int i = 0; i < kids.length; i++) {
            if (kids[i].isDirectory()) n += dirBytes(kids[i]);
            else n += kids[i].length();
        }
        return n;
    }

    private void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) {
                for (int i = 0; i < kids.length; i++) deleteTree(kids[i]);
            }
        }
        f.delete();
    }

    private JSArray fileList(File root, boolean[] truncatedFlag) {
        JSArray out = new JSArray();
        List<File> stack = new ArrayList<File>();
        stack.add(root);
        int guard = 0;
        while (!stack.isEmpty()) {
            File dir = stack.remove(stack.size() - 1);
            File[] kids = dir.listFiles();
            if (kids == null) continue;
            Arrays.sort(kids, new Comparator<File>() {
                public int compare(File a, File b) {
                    return a.getName().compareToIgnoreCase(b.getName());
                }
            });
            for (int i = 0; i < kids.length; i++) {
                File k = kids[i];
                if (!insideProject(root, k)) continue;
                if (k.isDirectory()) {
                    stack.add(k);
                    continue;
                }
                if (out.length() >= MAX_LIST_FILES) {
                    truncatedFlag[0] = true;
                    return out;
                }
                guard += 1;
                if (guard > MAX_LIST_FILES * 4) {
                    truncatedFlag[0] = true;
                    return out;
                }
                try {
                    JSObject entry = new JSObject();
                    entry.put("path", relPath(root, k));
                    entry.put("bytes", k.length());
                    out.put(entry);
                } catch (IOException e) {
                    /* skip anything that cannot be named relative to the root */
                }
            }
        }
        return out;
    }

    /* ------------------------------------------------------------------
       toolchain
       ------------------------------------------------------------------ */

    private String locateTool(String name) {
        for (int i = 0; i < SYSTEM_BIN_DIRS.length; i++) {
            File candidate = new File(SYSTEM_BIN_DIRS[i], name);
            if (candidate.exists() && candidate.isFile()) return candidate.getAbsolutePath();
        }
        return null;
    }

    private String systemPath() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < SYSTEM_BIN_DIRS.length; i++) {
            File dir = new File(SYSTEM_BIN_DIRS[i]);
            if (!dir.isDirectory()) continue;
            if (sb.length() > 0) sb.append(':');
            sb.append(SYSTEM_BIN_DIRS[i]);
        }
        return sb.length() == 0 ? "/system/bin" : sb.toString();
    }

    private String humanBytes(long bytes) {
        if (bytes >= 1048576L) return (bytes / 1048576L) + " MB";
        if (bytes >= 1024L) return (bytes / 1024L) + " KB";
        return bytes + " B";
    }

    /* ==================================================================
       PLUGIN METHODS
       ================================================================== */

    @PluginMethod
    public void hostInfo(PluginCall call) {
        JSObject out = new JSObject();
        out.put("platform", "android");
        out.put("apiLevel", Build.VERSION.SDK_INT);
        out.put("release", Build.VERSION.RELEASE);
        out.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown");
        out.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        out.put("storageRoot", rootDir().getAbsolutePath());
        out.put("pluginVersion", PLUGIN_VERSION);
        boolean writable;
        try {
            File probe = new File(rootDir(), ".write-probe");
            writeText(probe, "ok");
            writable = probe.exists();
            probe.delete();
        } catch (IOException e) {
            writable = false;
        }
        out.put("writable", writable);
        call.resolve(out);
    }

    @PluginMethod
    public void probeToolchain(PluginCall call) {
        JSArray tools = new JSArray();
        for (int i = 0; i < TOOL_CANDIDATES.length; i++) {
            String name = TOOL_CANDIDATES[i];
            String path = locateTool(name);
            JSObject t = new JSObject();
            t.put("name", name);
            t.put("path", path == null ? "" : path);
            t.put("available", path != null);
            t.put("note", path == null ? "not present in the system binary directories" : "found");
            tools.put(t);
        }
        JSObject out = new JSObject();
        String shell = locateTool("sh");
        out.put("shell", shell == null ? "" : shell);
        out.put("path", systemPath());
        out.put("tools", tools);
        out.put("note", "Only system binaries can be executed on Android 10+. A project's own binary cannot be run from app storage.");
        call.resolve(out);
    }

    @PluginMethod
    public void listProjects(PluginCall call) {
        JSArray out = new JSArray();
        JSONArray index = readIndex();
        for (int i = 0; i < index.length(); i++) {
            JSONObject entry = index.optJSONObject(i);
            if (entry == null) continue;
            String id = entry.optString("id");
            if (!safeId(id)) continue;
            File dir = new File(rootDir(), id);
            if (!dir.isDirectory()) continue;
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", entry.optString("name", id));
            o.put("createdAt", entry.optLong("createdAt", dir.lastModified()));
            o.put("fileCount", countFiles(dir));
            o.put("bytes", dirBytes(dir));
            out.put(o);
        }
        // Directories that exist without an index entry are still the user's projects.
        File[] dirs = rootDir().listFiles();
        if (dirs != null) {
            Arrays.sort(dirs, new Comparator<File>() {
                public int compare(File a, File b) {
                    return a.getName().compareToIgnoreCase(b.getName());
                }
            });
            for (int i = 0; i < dirs.length; i++) {
                File d = dirs[i];
                if (!d.isDirectory() || !safeId(d.getName())) continue;
                if (findEntry(d.getName()) != null) continue;
                JSObject o = new JSObject();
                o.put("id", d.getName());
                o.put("name", d.getName());
                o.put("createdAt", d.lastModified());
                o.put("fileCount", countFiles(d));
                o.put("bytes", dirBytes(d));
                out.put(o);
            }
        }
        JSObject res = new JSObject();
        res.put("projects", out);
        call.resolve(res);
    }

    @PluginMethod
    public void createProject(PluginCall call) {
        String name = call.getString("name", "Untitled project");
        if (name == null || name.trim().length() == 0) name = "Untitled project";
        name = name.trim();
        if (name.length() > 120) name = name.substring(0, 120);
        String id = newId();
        File dir = new File(rootDir(), id);
        if (!dir.mkdirs()) {
            call.reject("could not create the project directory", "STORAGE");
            return;
        }
        JSONObject entry = new JSONObject();
        try {
            entry.put("id", id);
            entry.put("name", name);
            entry.put("createdAt", System.currentTimeMillis());
        } catch (JSONException e) {
            call.reject("could not record the project", "STORAGE");
            return;
        }
        upsertEntry(entry);
        JSObject project = new JSObject();
        project.put("id", id);
        project.put("name", name);
        project.put("createdAt", entry.optLong("createdAt"));
        JSObject res = new JSObject();
        res.put("project", project);
        call.resolve(res);
    }

    @PluginMethod
    public void deleteProject(PluginCall call) {
        String id = call.getString("id");
        if (!safeId(id)) {
            call.reject("unsafe project id", "BADREQUEST");
            return;
        }
        File dir = new File(rootDir(), id);
        deleteTree(dir);
        removeEntry(id);
        JSObject res = new JSObject();
        res.put("deleted", !dir.exists());
        res.put("id", id);
        call.resolve(res);
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String id = call.getString("id");
        File dir;
        try {
            dir = projectDir(id);
        } catch (IOException e) {
            call.reject(e.getMessage(), "NOTFOUND");
            return;
        }
        boolean[] truncated = { false };
        JSArray files = fileList(dir, truncated);
        JSObject res = new JSObject();
        res.put("files", files);
        res.put("truncated", truncated[0]);
        res.put("root", dir.getAbsolutePath());
        call.resolve(res);
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String id = call.getString("id");
        String path = call.getString("path");
        File root;
        File target;
        try {
            root = projectDir(id);
            target = resolve(root, path);
        } catch (IOException e) {
            call.reject(e.getMessage(), "BADREQUEST");
            return;
        }
        if (!target.exists() || target.isDirectory()) {
            call.reject("file not found: " + path, "NOTFOUND");
            return;
        }
        try {
            byte[] data = readFileCapped(target);
            boolean binary = looksBinary(data);
            JSObject res = new JSObject();
            res.put("path", relPath(root, target));
            res.put("bytes", data.length);
            res.put("binary", binary);
            res.put("text", binary ? "" : new String(data, StandardCharsets.UTF_8));
            if (binary) res.put("note", "binary file — not shown as text");
            call.resolve(res);
        } catch (IOException e) {
            call.reject(e.getMessage(), "READ");
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String id = call.getString("id");
        String path = call.getString("path");
        String text = call.getString("text", "");
        File root;
        File target;
        try {
            root = projectDir(id);
            target = resolve(root, path);
        } catch (IOException e) {
            call.reject(e.getMessage(), "BADREQUEST");
            return;
        }
        if (target.isDirectory()) {
            call.reject("path is a directory: " + path, "BADREQUEST");
            return;
        }
        if (text != null && text.length() > MAX_TEXT_BYTES) {
            call.reject("file exceeds the " + (MAX_TEXT_BYTES / 1000) + " KB working limit", "TOOLARGE");
            return;
        }
        try {
            writeText(target, text);
            JSObject res = new JSObject();
            res.put("path", relPath(root, target));
            res.put("bytes", target.length());
            call.resolve(res);
        } catch (IOException e) {
            call.reject("could not write " + path + ": " + e.getMessage(), "WRITE");
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String id = call.getString("id");
        String path = call.getString("path");
        File root;
        File target;
        try {
            root = projectDir(id);
            target = resolve(root, path);
        } catch (IOException e) {
            call.reject(e.getMessage(), "BADREQUEST");
            return;
        }
        boolean deleted = target.exists() && !target.isDirectory() && target.delete();
        JSObject res = new JSObject();
        res.put("deleted", deleted);
        res.put("path", path);
        call.resolve(res);
    }

    @PluginMethod
    public void runCommand(PluginCall call) {
        String id = call.getString("id");
        File root;
        try {
            root = projectDir(id);
        } catch (IOException e) {
            call.reject(e.getMessage(), "NOTFOUND");
            return;
        }
        JSArray argvIn = call.getArray("argv");
        if (argvIn == null || argvIn.length() == 0) {
            call.reject("argv is required", "BADREQUEST");
            return;
        }
        List<String> argv = new ArrayList<String>();
        try {
            for (int i = 0; i < argvIn.length(); i++) argv.add(String.valueOf(argvIn.get(i)));
        } catch (JSONException e) {
            call.reject("argv could not be read", "BADREQUEST");
            return;
        }
        String head = argv.get(0);
        if (head == null || head.trim().length() == 0) {
            call.reject("argv[0] is required", "BADREQUEST");
            return;
        }
        String binary = resolveExecutable(head);
        if (binary == null) {
            call.reject(
                "only system binaries can be executed on Android 10+; '" + head
                    + "' is not one of them. A project-local program cannot run from app storage — run it through sh instead.",
                "BINARY_NOT_ALLOWED"
            );
            return;
        }
        long timeout = call.getLong("timeoutMs", Long.valueOf(DEFAULT_TIMEOUT_MS)).longValue();
        if (timeout <= 0) timeout = DEFAULT_TIMEOUT_MS;
        if (timeout > MAX_TIMEOUT_MS) timeout = MAX_TIMEOUT_MS;

        List<String> full = new ArrayList<String>();
        full.add(binary);
        for (int i = 1; i < argv.size(); i++) full.add(argv.get(i));

        ProcessBuilder pb = new ProcessBuilder(full);
        pb.directory(root);
        Map<String, String> env = pb.environment();
        env.clear();
        env.put("PATH", systemPath());
        env.put("HOME", root.getAbsolutePath());
        env.put("TMPDIR", getContext().getCacheDir().getAbsolutePath());
        env.put("SHELL", locateTool("sh") == null ? "/system/bin/sh" : locateTool("sh"));
        env.put("GUNTHER_PROJECT", root.getAbsolutePath());
        env.put("LANG", "C.UTF-8");

        long started = System.currentTimeMillis();
        Process proc = null;
        try {
            proc = pb.start();
        } catch (IOException e) {
            call.reject("could not start '" + head + "': " + e.getMessage(), "SPAWN");
            return;
        }
        StreamPump outPump = new StreamPump(proc.getInputStream(), MAX_OUTPUT_BYTES);
        StreamPump errPump = new StreamPump(proc.getErrorStream(), MAX_OUTPUT_BYTES);
        Thread outThread = new Thread(outPump, "gunther-stdout");
        Thread errThread = new Thread(errPump, "gunther-stderr");
        outThread.start();
        errThread.start();

        boolean timedOut = false;
        long deadline = System.currentTimeMillis() + timeout;
        boolean finished = false;
        // Process.waitFor(timeout, unit) is API 26+; minSdk here is 24, so poll.
        while (System.currentTimeMillis() < deadline) {
            try {
                proc.exitValue();
                finished = true;
                break;
            } catch (IllegalThreadStateException stillRunning) {
                try {
                    Thread.sleep(40);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    proc.destroy();
                    call.reject("command interrupted", "INTERRUPTED");
                    return;
                }
            }
        }
        if (!finished) {
            timedOut = true;
            proc.destroy();
            if (Build.VERSION.SDK_INT >= 26) proc.destroyForcibly();
            long killDeadline = System.currentTimeMillis() + 3000;
            while (System.currentTimeMillis() < killDeadline) {
                try {
                    proc.exitValue();
                    break;
                } catch (IllegalThreadStateException stillRunning) {
                    try {
                        Thread.sleep(40);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        try {
            outThread.join(2000);
            errThread.join(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        int code;
        if (timedOut) {
            code = -1;
        } else {
            try {
                code = proc.exitValue();
            } catch (IllegalThreadStateException e) {
                code = -1;
            }
        }

        JSObject res = new JSObject();
        JSArray used = new JSArray();
        for (int i = 0; i < full.size(); i++) used.put(full.get(i));
        res.put("argv", used);
        res.put("cwd", root.getAbsolutePath());
        res.put("code", code);
        res.put("stdout", outPump.text());
        res.put("stderr", errPump.text());
        res.put("stdoutTruncated", outPump.truncated());
        res.put("stderrTruncated", errPump.truncated());
        res.put("durationMs", System.currentTimeMillis() - started);
        res.put("timedOut", timedOut);
        res.put("timeoutMs", timeout);
        res.put("runner", "android-processbuilder");
        res.put("binary", binary);
        if (timedOut) res.put("note", "killed after " + (timeout / 1000) + "s");
        call.resolve(res);
    }

    /** A project-local program is never executable; a system binary always is. */
    private String resolveExecutable(String head) {
        if (head.indexOf('/') >= 0) {
            File f = new File(head);
            String path = f.getAbsolutePath();
            for (int i = 0; i < SYSTEM_BIN_DIRS.length; i++) {
                if (path.startsWith(SYSTEM_BIN_DIRS[i] + "/") && new File(path).isFile()) return path;
            }
            return null;
        }
        return locateTool(head);
    }

    /* ------------------------------------------------------------------
       import / export through the Storage Access Framework
       ------------------------------------------------------------------ */

    @PluginMethod
    public void importFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject res = new JSObject();
            res.put("cancelled", true);
            call.resolve(res);
            return;
        }
        Uri tree = result.getData().getData();
        Context ctx = getContext();
        try {
            ctx.getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            /* not every provider grants persistence; the copy below still works */
        }
        String name = call.getString("name", "");
        if (name == null || name.trim().length() == 0) name = DocumentsContract.getTreeDocumentId(tree);
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        int colon = name.lastIndexOf(':');
        if (colon >= 0) name = name.substring(colon + 1);
        if (name.trim().length() == 0) name = "Imported project";
        try {
            File root = createProjectDir(name);
            int[] counters = { 0, 0, 0 };
            long[] bytes = { 0L };
            copyTree(ctx, tree, DocumentsContract.getTreeDocumentId(tree), root, "", counters, bytes);
            JSObject res = new JSObject();
            res.put("project", projectJson(root, name));
            res.put("imported", counters[0]);
            res.put("skipped", counters[1] + counters[2]);
            res.put("bytes", bytes[0]);
            res.put("cancelled", false);
            call.resolve(res);
        } catch (IOException e) {
            call.reject("import failed: " + e.getMessage(), "IMPORT");
        }
    }

    @PluginMethod
    public void importArchive(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "archivePicked");
    }

    @ActivityCallback
    private void archivePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject res = new JSObject();
            res.put("cancelled", true);
            call.resolve(res);
            return;
        }
        Uri uri = result.getData().getData();
        String name = call.getString("name", "");
        String display = uri.getLastPathSegment() == null ? "archive" : uri.getLastPathSegment();
        if (name == null || name.trim().length() == 0) name = display.replaceAll("\\.zip$", "");
        try {
            File root = createProjectDir(name);
            int[] counters = { 0, 0 };
            long[] bytes = { 0L };
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            if (in == null) {
                call.reject("could not open the archive", "IMPORT");
                return;
            }
            ZipInputStream zip = new ZipInputStream(in);
            try {
                ZipEntry entry;
                byte[] buf = new byte[16384];
                while ((entry = zip.getNextEntry()) != null) {
                    if (entry.isDirectory()) continue;
                    String entryName = entry.getName() == null ? "" : entry.getName().replace('\\', '/');
                    if (entryName.length() == 0 || entryName.endsWith("/")) continue;
                    if (counters[0] >= MAX_IMPORT_FILES || bytes[0] >= MAX_IMPORT_BYTES) {
                        counters[1] += 1;
                        continue;
                    }
                    File target;
                    try {
                        target = resolve(root, entryName);
                    } catch (IOException e) {
                        counters[1] += 1;
                        continue;
                    }
                    File parent = target.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    FileOutputStream fos = new FileOutputStream(target);
                    try {
                        int n;
                        while ((n = zip.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            bytes[0] += n;
                            if (bytes[0] > MAX_IMPORT_BYTES) break;
                        }
                    } finally {
                        fos.close();
                    }
                    counters[0] += 1;
                }
            } finally {
                zip.close();
                in.close();
            }
            JSObject res = new JSObject();
            res.put("project", projectJson(root, name));
            res.put("imported", counters[0]);
            res.put("skipped", counters[1]);
            res.put("bytes", bytes[0]);
            res.put("cancelled", false);
            call.resolve(res);
        } catch (IOException e) {
            call.reject("import failed: " + e.getMessage(), "IMPORT");
        }
    }

    @PluginMethod
    public void exportArchive(PluginCall call) {
        String id = call.getString("id");
        String name = call.getString("name", "");
        File dir;
        try {
            dir = projectDir(id);
        } catch (IOException e) {
            call.reject(e.getMessage(), "NOTFOUND");
            return;
        }
        if (name == null || name.trim().length() == 0) {
            JSONObject entry = findEntry(id);
            name = entry == null ? id : entry.optString("name", id);
        }
        String safe = name.replaceAll("[^A-Za-z0-9._-]+", "-");
        if (safe.length() == 0) safe = "project";
        call.setKeepAlive(true);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        intent.putExtra(Intent.EXTRA_TITLE, safe + ".zip");
        startActivityForResult(call, intent, "exportTargetPicked");
    }

    @ActivityCallback
    private void exportTargetPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.setKeepAlive(false);
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject res = new JSObject();
            res.put("cancelled", true);
            res.put("saved", false);
            call.resolve(res);
            return;
        }
        Uri target = result.getData().getData();
        String id = call.getString("id");
        File dir;
        try {
            dir = projectDir(id);
        } catch (IOException e) {
            call.reject(e.getMessage(), "NOTFOUND");
            return;
        }
        try {
            OutputStream os = getContext().getContentResolver().openOutputStream(target, "w");
            if (os == null) {
                call.reject("could not open the export target", "EXPORT");
                return;
            }
            int[] counters = { 0, 0 };
            long[] bytes = { 0L };
            writeZip(dir, os, counters, bytes);
            JSObject res = new JSObject();
            res.put("saved", true);
            res.put("cancelled", false);
            res.put("fileName", target.getLastPathSegment() == null ? "" : target.getLastPathSegment());
            res.put("files", counters[0]);
            res.put("bytes", bytes[0]);
            call.resolve(res);
        } catch (IOException e) {
            call.reject("export failed: " + e.getMessage(), "EXPORT");
        }
    }

    private File createProjectDir(String name) throws IOException {
        if (name == null || name.trim().length() == 0) name = "Imported project";
        name = name.trim();
        if (name.length() > 120) name = name.substring(0, 120);
        String id = newId();
        File dir = new File(rootDir(), id);
        if (!dir.mkdirs()) throw new IOException("could not create the project directory");
        JSONObject entry = new JSONObject();
        try {
            entry.put("id", id);
            entry.put("name", name);
            entry.put("createdAt", System.currentTimeMillis());
        } catch (JSONException e) {
            throw new IOException("could not record the project");
        }
        upsertEntry(entry);
        return dir;
    }

    private JSObject projectJson(File dir, String name) {
        JSObject project = new JSObject();
        project.put("id", dir.getName());
        project.put("name", name);
        project.put("createdAt", dir.lastModified());
        project.put("fileCount", countFiles(dir));
        project.put("bytes", dirBytes(dir));
        return project;
    }

    private void copyTree(Context ctx, Uri tree, String parentDocId, File root, String prefix, int[] counters, long[] bytes)
        throws IOException {
        ContentResolver resolver = ctx.getContentResolver();
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId);
        Cursor cursor = null;
        try {
            cursor = resolver.query(
                children,
                new String[] {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                },
                null,
                null,
                null
            );
            if (cursor == null) throw new IOException("the picked folder could not be read");
            while (cursor.moveToNext()) {
                String docId = cursor.getString(0);
                String display = cursor.getString(1);
                String mime = cursor.getString(2);
                if (display == null || display.length() == 0) continue;
                String rel = prefix.length() == 0 ? display : prefix + "/" + display;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    copyTree(ctx, tree, docId, root, rel, counters, bytes);
                    continue;
                }
                if (counters[0] >= MAX_IMPORT_FILES || bytes[0] >= MAX_IMPORT_BYTES) {
                    counters[2] += 1;
                    continue;
                }
                File target;
                try {
                    target = resolve(root, rel);
                } catch (IOException e) {
                    counters[1] += 1;
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                Uri docUri = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
                InputStream in = null;
                FileOutputStream fos = null;
                try {
                    in = resolver.openInputStream(docUri);
                    if (in == null) {
                        counters[1] += 1;
                        continue;
                    }
                    fos = new FileOutputStream(target);
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        bytes[0] += n;
                        if (bytes[0] > MAX_IMPORT_BYTES) break;
                    }
                    counters[0] += 1;
                } catch (IOException e) {
                    counters[1] += 1;
                } finally {
                    if (in != null) try { in.close(); } catch (IOException ignored) {}
                    if (fos != null) try { fos.close(); } catch (IOException ignored) {}
                }
            }
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void writeZip(File dir, OutputStream os, int[] counters, long[] bytes) throws IOException {
        ZipOutputStream zip = new ZipOutputStream(os);
        try {
            writeZipEntries(dir, dir, zip, counters, bytes);
            zip.finish();
        } finally {
            zip.close();
        }
    }

    private void writeZipEntries(File root, File dir, ZipOutputStream zip, int[] counters, long[] bytes) throws IOException {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        Arrays.sort(kids, new Comparator<File>() {
            public int compare(File a, File b) {
                return a.getName().compareToIgnoreCase(b.getName());
            }
        });
        for (int i = 0; i < kids.length; i++) {
            File k = kids[i];
            if (!insideProject(root, k)) continue;
            if (k.isDirectory()) {
                writeZipEntries(root, k, zip, counters, bytes);
                continue;
            }
            String rel = relPath(root, k);
            ZipEntry entry = new ZipEntry(rel);
            entry.setTime(k.lastModified());
            zip.putNextEntry(entry);
            FileInputStream in = new FileInputStream(k);
            try {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    zip.write(buf, 0, n);
                    bytes[0] += n;
                }
            } finally {
                in.close();
            }
            zip.closeEntry();
            counters[0] += 1;
        }
    }

    /* ------------------------------------------------------------------
       output capture
       ------------------------------------------------------------------ */

    private static final class StreamPump implements Runnable {
        private final InputStream in;
        private final int cap;
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        private boolean truncated = false;

        StreamPump(InputStream in, int cap) {
            this.in = in;
            this.cap = cap;
        }

        public void run() {
            byte[] buf = new byte[8192];
            try {
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (buffer.size() + n > cap) {
                        int room = cap - buffer.size();
                        if (room > 0) buffer.write(buf, 0, room);
                        truncated = true;
                        continue;
                    }
                    buffer.write(buf, 0, n);
                }
            } catch (IOException e) {
                /* the stream closed with the process — captured output is what we have */
            }
        }

        String text() {
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }

        boolean truncated() {
            return truncated;
        }
    }
}
