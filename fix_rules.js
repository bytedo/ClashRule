#!/usr/bin/env node
/**
 * fix_rules.js
 *
 * 功能：
 * - 保留空行和注释
 * - 更新规则数量
 * - 区块内排序规则行（前缀小区块 + 主域排序 + IP-CIDR排序）
 * - 检查 .ini 文件 ruleset 与 custom_proxy_group
 * - 异步并行扫描子目录
 * - pre-commit 友好
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { getBaseDomain, loadPSL } from "./psl_loader.js";

const VALID_PREFIXES = [
    "DOMAIN",
    "DOMAIN-SUFFIX",
    "DOMAIN-KEYWORD",
    "IP-CIDR",
    "IP-CIDR6",
    "URL-REGEX",
    "USER-AGENT",
    "PROCESS-NAME"
];

// 递归扫描子目录
async function walk(root) {
    const files = [];
    async function _walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) await _walk(full);
            else if (e.isFile() && (full.endsWith(".list") || full.endsWith(".ini"))) files.push(full);
        }
    }
    await _walk(root);
    return files;
}

// 校验规则行合法性
function checkListLine(line) {
    const t = line.trim();
    if (!t || t.startsWith("#")) return null;
    const [prefix] = t.split(",", 1);
    if (!prefix || !VALID_PREFIXES.includes(prefix)) return `非法前缀或格式: ${line}`;
    return null;
}

// 将 IP 转数字用于排序
function ipToNumber(ip) {
    try {
        const parts = ip.split(".").map(n => parseInt(n, 10));
        if (parts.length !== 4) return 0;
        return parts[0]*2**24 + parts[1]*2**16 + parts[2]*2**8 + parts[3];
    } catch {
        return 0;
    }
}

// 提取排序键
function extractSortKey(line) {
    const t = line.trim();
    const [prefix, rest] = t.split(",", 2);
    if (!rest) return t.toLowerCase();

    if (prefix.startsWith("DOMAIN")) {
        const base = getBaseDomain(rest.trim());
        return `${prefix}::${base}::${rest.toLowerCase()}`;
    } else if (prefix === "IP-CIDR") {
        const ip = rest.split("/")[0].trim();
        const num = ipToNumber(ip);
        return `${prefix}::${num.toString().padStart(10,"0")}::${rest}`;
    } else {
        return t.toLowerCase();
    }
}

// 处理 .list 文件
async function processListFile(file) {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    const errors = [];
    let ruleCount = 0;

    // 检查规则并统计数量
    lines.forEach(line => {
        const err = checkListLine(line);
        if (err) errors.push(err);
        else if (line.trim() && !line.startsWith("#")) ruleCount++;
    });

    // 更新规则数量
    const newLines = [...lines];
    const countLine = `# 规则数量: ${ruleCount}`;
    if (newLines.length >= 3) newLines[2] = countLine;
    else {
        while (newLines.length < 2) newLines.push("");
        newLines.push(countLine);
    }

    // 区块排序（#块分割 + 前缀小块 + 主域/IP排序）
    const finalLines = [];
    let block = [];

    const flushBlock = () => {
        if (!block.length) return;

        // 收集规则行和非规则行
        const ruleLines = block.filter(l => l.trim() && !l.trim().startsWith("#"));
        const sortedRules = ruleLines.sort((a,b)=>extractSortKey(a).localeCompare(extractSortKey(b)));

        let idx = 0;
        for (const line of block) {
            if (line.trim() && !line.trim().startsWith("#")) {
                finalLines.push(sortedRules[idx]);
                idx++;
            } else {
                finalLines.push(line);
            }
        }

        block = [];
    };

    for (const line of newLines) {
        if (line.trim().startsWith("#")) {
            flushBlock();
            block.push(line);
        } else {
            block.push(line);
        }
    }
    flushBlock();

    await fs.writeFile(file, finalLines.join("\n"), "utf8");
    return errors;
}

// 检查 .ini 文件
async function checkIniFile(file) {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    const ruleSections = [];
    const groupSections = [];
    let current = null;
    let mode = null;

    for (const raw of lines) {
        const s = raw.trim();
        if (!s) continue;
        if (s.startsWith("[") && s.endsWith("]")) continue;

        if (s === ";规则label") {
            if (mode === "rule") ruleSections.push(current || []);
            mode = "rule";
            current = [];
            continue;
        }
        if (s === ";分组label") {
            if (mode === "group") groupSections.push(current || []);
            mode = "group";
            current = [];
            continue;
        }
        if (!s.includes("=")) continue;

        const [key, val] = s.split("=", 2).map(x => x.trim());
        if (mode === "rule" && key === "ruleset") {
            const match = val.match(/^([^,]+)/);
            if (match) current.push(match[1]);
        }
        if (mode === "group" && key === "custom_proxy_group") {
            const match = val.match(/^([^`]+)/);
            if (match) current.push(match[1]);
        }
    }
    if (mode === "rule") ruleSections.push(current || []);
    if (mode === "group") groupSections.push(current || []);

    const errors = [];
    for (let i = 0; i < ruleSections.length; i++) {
        const rules = ruleSections[i];
        const groups = groupSections[i] || [];
        for (const r of rules) {
            if (!groups.includes(r)) errors.push(`ruleset '${r}' 未在对应分组中定义`);
        }
    }
    return errors;
}

// 主函数
async function main() {
    await loadPSL(); // 确保 PSL 缓存
    const root = process.cwd();
    const allFiles = await walk(root);
    const listFiles = allFiles.filter(f => f.endsWith(".list"));
    const iniFiles = allFiles.filter(f => f.endsWith(".ini"));
    let totalErrors = 0;
    let modifiedFiles = 0;

    await Promise.all(listFiles.map(async f => {
        const errors = await processListFile(f);
        if (errors.length > 0) {
            console.log(`\n❌ [LIST] ${f}`);
            errors.forEach(e => console.log("   •", e));
            totalErrors += errors.length;
        }
        modifiedFiles++;
    }));

    await Promise.all(iniFiles.map(async f => {
        const errors = await checkIniFile(f);
        if (errors.length > 0) {
            console.log(`\n❌ [INI] ${f}`);
            errors.forEach(e => console.log("   •", e));
            totalErrors += errors.length;
        }
    }));

    console.log(`\n🔍 扫描完成: 共 ${listFiles.length} 个 .list 文件, ${iniFiles.length} 个 .ini 文件, 修改 ${modifiedFiles} 个文件, 错误 ${totalErrors} 个`);
    process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("Fatal error:", e);
    process.exit(2);
});
