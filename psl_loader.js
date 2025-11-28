// psl_loader.js
import fs from "fs/promises";
import os from "os";
import path from "path";
import psl from "psl";

const CACHE_DIR = path.join(os.platform() === "win32" ? process.env.LOCALAPPDATA : process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "psl");
const CACHE_PATH = path.join(CACHE_DIR, "cache.dat");
const PSL_URL = "https://publicsuffix.org/list/public_suffix_list.dat";

export async function ensurePSL() {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.access(CACHE_PATH);
        return;
    } catch (_) {
        console.log("📥 下载 Public Suffix List…");
        const res = await fetch(PSL_URL);
        if (!res.ok) throw new Error("无法下载 Public Suffix List");
        const text = await res.text();
        await fs.writeFile(CACHE_PATH, text, "utf8");
        console.log("✅ PSL 下载完成并缓存");
    }
}

export async function loadPSL() {
    await ensurePSL();
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    return raw
        .split("\n")
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("//"));
}

// 获取主域名（base domain）
export function getBaseDomain(domain) {
    if (!domain) return domain;
    domain = domain.replace(/\*/g, ""); // 去掉通配符
    const parsed = psl.parse(domain);
    if (parsed.error) return domain.toLowerCase();
    return parsed.domain || domain.toLowerCase();
}
