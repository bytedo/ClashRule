#!/usr/bin/env node
/**
 * fix_rules.js
 *
 * 功能：
 * - 保留空行和注释
 * - 更新第三行规则数量
 * - 区块内排序规则行（不动注释和空行）
 * - 检查 .ini 文件 ruleset 与 custom_proxy_group
 * - 异步并行扫描子目录
 * - pre-commit 友好
 */

const fs = require("fs").promises;
const path = require("path");

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

// 检查规则行合法性
function checkListLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const [prefix] = t.split(",", 1);
  if (!prefix || !VALID_PREFIXES.includes(prefix)) return `非法前缀或格式: ${line}`;
  return null;
}

// 处理 .list 文件
async function processListFile(file) {
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  const errors = [];
  let ruleCount = 0;

  // 统计规则数量
  lines.forEach((line) => {
    const err = checkListLine(line);
    if (err) errors.push(err);
    else if (line.trim() && !line.startsWith("#")) ruleCount++;
  });

  // 更新第三行规则数量
  const newLines = [...lines];
  const countLine = `# 规则数量: ${ruleCount}`;
  if (lines.length >= 3) newLines[2] = countLine;
  else {
    while (newLines.length < 2) newLines.push("");
    newLines.push(countLine);
  }

  // 区块内排序规则行（保留注释和空行）
  const finalLines = [];
  let block = [];
  let blockHeader = null;

  const flushBlock = () => {
    if (block.length === 0) return;
    const rules = block.filter(l => l.trim() && !l.trim().startsWith("#"));
    const sortedRules = [...rules].sort((a, b) => {
      const aKey = a.trim().split(",")[1] || a.trim();
      const bKey = b.trim().split(",")[1] || b.trim();
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });

    let idx = 0;
    for (let line of block) {
      if (line.trim() && !line.trim().startsWith("#")) {
        finalLines.push(sortedRules[idx]);
        idx++;
      } else {
        finalLines.push(line);
      }
    }

    block = [];
    blockHeader = null;
  };

  for (const line of newLines) {
    if (line.trim().startsWith("#")) {
      flushBlock();
      blockHeader = line;
      block.push(line);
    } else if (line.trim() || line === "") {
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
