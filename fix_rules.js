#!/usr/bin/env node
/**
 * fix_rules.js
 *
 * 功能：
 * - 保留空行和注释
 * - 更新第三行规则数量
 * - 区块内排序规则行（前缀小区块 + 域名逐级排序 + IP-CIDR A段排序）
 * - 检查 .ini 文件 ruleset 与 custom_proxy_group
 * - 异步并行扫描子目录
 * - Pre-commit 友好
 */

import fs from "fs/promises";
import path from "path";

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

// 域名逐级排序键
function domainSortKey(domain) {
    const parts = domain.split(".").reverse(); // 从后往前逐级排序
    return parts.map(p => p.toLowerCase()).join("::");
}

// 提取排序键
function extractSortKey(line) {
    const t = line.trim();
    const [prefix, rest] = t.split(",", 2);
    if (!rest) return t.toLowerCase();

    if (prefix.startsWith("DOMAIN")) {
        return `${prefix}::${domainSortKey(rest.trim())}::${rest.toLowerCase()}`;
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
    let lines = text.split(/\r?\n/);
    const errors = [];
    const notes = [];

    // 1. 合法性校验
    lines.forEach(line => {
        const err = checkListLine(line);
        if (err) errors.push(err);
    });

    // 2. 自动去重（保留首次出现）
    const seen = new Set();
    const deduped = [];
    for (const line of lines) {
        const t = line.trim();
        if (t && !t.startsWith("#")) {
            if (seen.has(t)) {
                notes.push(`去重: ${t}`);
                continue;
            }
            seen.add(t);
        }
        deduped.push(line);
    }
    lines = deduped;

    // 3. 删除被 DOMAIN-SUFFIX 覆盖的 DOMAIN 冗余行
    const suffixSet = new Set(
        lines
            .filter(l => l.trim().startsWith("DOMAIN-SUFFIX,"))
            .map(l => l.trim().slice("DOMAIN-SUFFIX,".length).toLowerCase())
    );
    const noRedundant = [];
    for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("DOMAIN,")) {
            const d = t.slice("DOMAIN,".length).toLowerCase();
            if (suffixSet.has(d)) {
                notes.push(`冗余删除: ${t} (被 DOMAIN-SUFFIX 覆盖)`);
                continue;
            }
        }
        noRedundant.push(line);
    }
    lines = noRedundant;

    // 4. 更新规则数量行（定位 "# 规则数量:" 标记，找不到则在头部注释区末尾插入）
    const ruleCount = lines.filter(l => {
        const t = l.trim();
        return t && !t.startsWith("#");
    }).length;
    const countLine = `# 规则数量: ${ruleCount}`;
    const countIdx = lines.findIndex(l => l.trim().startsWith("# 规则数量:"));
    if (countIdx === -1) {
        let idx = 0;
        while (idx < lines.length && lines[idx].trim().startsWith("#")) idx++;
        lines.splice(idx, 0, countLine);
        notes.push(`插入数量行: ${countLine}`);
    } else if (lines[countIdx].trim() !== countLine) {
        lines[countIdx] = countLine;
        notes.push(`更新数量行: ${countLine}`);
    }

    // 5. 区块排序
    const finalLines = [];
    let block = [];

    const flushBlock = () => {
        if (!block.length) return;

        const ruleLines = block.filter(l => l.trim() && !l.trim().startsWith("#"));

        // 前缀分组
        const prefixGroups = {};
        for (const line of ruleLines) {
            const prefix = line.split(",",1)[0].trim();
            if (!prefixGroups[prefix]) prefixGroups[prefix] = [];
            prefixGroups[prefix].push(line);
        }

        // 排序每个前缀小块
        const sortedRules = [];
        Object.keys(prefixGroups).sort().forEach(prefix=>{
            const arr = prefixGroups[prefix];
            arr.sort((a,b)=>extractSortKey(a).localeCompare(extractSortKey(b)));
            sortedRules.push(...arr);
        });

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

    for (const line of lines) {
        if (line.trim().startsWith("#")) {
            flushBlock();
            block.push(line);
        } else {
            block.push(line);
        }
    }
    flushBlock();

    const output = finalLines.join("\n");
    const modified = output !== text;

    if (modified) await fs.writeFile(file, output, "utf8");
    return { errors, modified, notes };
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
    const root = process.cwd();
    const allFiles = await walk(root);
    const listFiles = allFiles.filter(f => f.endsWith(".list"));
    const iniFiles = allFiles.filter(f => f.endsWith(".ini"));
    let totalErrors = 0;
    let modifiedFiles = 0;

    await Promise.all(listFiles.map(async f => {
        const { errors, modified, notes } = await processListFile(f);
        if (errors.length > 0) {
            console.log(`\n❌ [LIST] ${f}`);
            errors.forEach(e => console.log("   •", e));
            totalErrors += errors.length;
        }
        if (notes.length > 0) {
            console.log(`\nℹ️ [LIST] ${f}`);
            notes.forEach(n => console.log("   •", n));
        }
        if (modified) modifiedFiles++;
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
