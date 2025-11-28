#!/usr/bin/env node
/**
 * fix_rules.js
 *
 * 功能：
 *  - 检查 .list 非法前缀/格式
 *  - 检查 .ini 的 ruleset / custom_proxy_group 是否一致
 *  - 异步并行扫描
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

// 建 prefix 排序映射
const PREFIX_ORDER = {};
VALID_PREFIXES.forEach((p, i) => (PREFIX_ORDER[p] = i));

/** ------------------------------
 *  递归扫描目录
 * ------------------------------*/
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

/** ------------------------------
 *  检查规则格式合法性
 * ------------------------------*/
function checkListLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const [prefix] = t.split(",", 1);
  if (!prefix || !VALID_PREFIXES.includes(prefix)) return `非法前缀或格式: ${line}`;
  return null;
}

/** ------------------------------
 *  从规则行中提取 prefix 与 key
 * ------------------------------*/
function parseRule(line) {
  const t = line.trim();
  const [prefix, value] = t.split(",", 2);
  return {
    prefix,
    domain: value || "",
    prefixRank: PREFIX_ORDER[prefix] ?? 999
  };
}

/** ------------------------------
 *  区块排序：按 prefix → domain
 * ------------------------------*/
function sortBlockRules(blockLines) {
  // 提取规则
  const rules = blockLines.filter(l => l.trim() && !l.trim().startsWith("#"));

  // 转换成结构数据
  const ruleObjs = rules.map(r => ({
    raw: r,
    ...parseRule(r)
  }));

  // 排序
  ruleObjs.sort((a, b) => {
    if (a.prefixRank !== b.prefixRank) return a.prefixRank - b.prefixRank;
    return a.domain.localeCompare(b.domain, "en", { sensitivity: "base" });
  });

  // 将排序后的规则按原位置写回
  const result = [];
  let idx = 0;
  for (const line of blockLines) {
    if (line.trim() && !line.trim().startsWith("#")) {
      result.push(ruleObjs[idx].raw);
      idx++;
    } else {
      result.push(line);
    }
  }
  return result;
}

/** ------------------------------
 *  处理 .list 文件
 * ------------------------------*/
async function processListFile(file) {
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/);

  const errors = [];
  let ruleCount = 0;

  // ---------------- 统计规则数 + 检查格式 ----------------
  for (const line of lines) {
    const err = checkListLine(line);
    if (err) errors.push(err);
    else if (line.trim() && !line.trim().startsWith("#")) ruleCount++;
  }

  // ---------------- 更新规则数量行 ----------------
  const updatedLines = [...lines];
  const countLine = `# 规则数量: ${ruleCount}`;
  if (updatedLines.length >= 3) updatedLines[2] = countLine;
  else {
    while (updatedLines.length < 2) updatedLines.push("");
    updatedLines.push(countLine);
  }

  // ---------------- 区块排序 ----------------
  const final = [];
  let block = [];
  let lastWasHeader = false;

  const flush = () => {
    if (block.length === 0) return;
    const sorted = sortBlockRules(block);
    final.push(...sorted);
    block = [];
  };

  for (const line of updatedLines) {
    if (line.trim().startsWith("#")) {
      flush();
      final.push(line);
      lastWasHeader = true;
    } else {
      block.push(line);
      lastWasHeader = false;
    }
  }
  flush();

  await fs.writeFile(file, final.join("\n"), "utf8");
  return errors;
}

/** ------------------------------
 *  检查 .ini ruleset/group
 * ------------------------------*/
async function checkIniFile(file) {
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/);

  const ruleSections = [];
  const groupSections = [];
  let mode = null;
  let current = [];

  for (const raw of lines) {
    const s = raw.trim();
    if (!s) continue;
    if (s === ";规则label") {
      if (mode === "rule") ruleSections.push(current);
      mode = "rule";
      current = [];
      continue;
    }
    if (s === ";分组label") {
      if (mode === "group") groupSections.push(current);
      mode = "group";
      current = [];
      continue;
    }
    if (!s.includes("=")) continue;

    const [key, val] = s.split("=", 2).map(x => x.trim());
    if (mode === "rule" && key === "ruleset") {
      const m = val.match(/^([^,]+)/);
      if (m) current.push(m[1]);
    }
    if (mode === "group" && key === "custom_proxy_group") {
      const m = val.match(/^([^`]+)/);
      if (m) current.push(m[1]);
    }
  }

  if (mode === "rule") ruleSections.push(current);
  if (mode === "group") groupSections.push(current);

  // 校验
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

/** ------------------------------
 *  主流程
 * ------------------------------*/
async function main() {
  const root = process.cwd();
  const allFiles = await walk(root);

  const listFiles = allFiles.filter(f => f.endsWith(".list"));
  const iniFiles = allFiles.filter(f => f.endsWith(".ini"));

  let totalErrors = 0;

  // ----------- 处理 .list -----------
  await Promise.all(
    listFiles.map(async file => {
      const errors = await processListFile(file);
      if (errors.length) {
        console.log(`\n❌ [LIST] ${file}`);
        errors.forEach(e => console.log("   •", e));
        totalErrors += errors.length;
      }
    })
  );

  // ----------- 处理 .ini -----------
  await Promise.all(
    iniFiles.map(async file => {
      const errors = await checkIniFile(file);
      if (errors.length) {
        console.log(`\n❌ [INI] ${file}`);
        errors.forEach(e => console.log("   •", e));
        totalErrors += errors.length;
      }
    })
  );

  console.log(`\n🔍 扫描完成: ${listFiles.length} 个 .list, ${iniFiles.length} 个 .ini, 错误共 ${totalErrors} 个`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
