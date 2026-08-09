#!/usr/bin/env node
/**
 * sync-upstream.js
 *
 * 同步上游（blackmatrix7/ios_rule_script）媒体分类规则到本地 Rule/ProxyMedia.list。
 *
 * 模式：
 *   --write   实际修改本地文件（默认仅输出差异报告）
 *
 * 流程：
 *   1. 读取本地 ProxyMedia.list 已有域名
 *   2. 拉取各上游分类文件，提取 DOMAIN / DOMAIN-SUFFIX
 *   3. 过滤：本地已有 / 黑名单 / 纯数字 CDN 子域
 *   4. 按服务商注释块插入本地文件（无对应块则追加到文件末尾新块）
 *   5. 运行 fix_rules.js 整理（排序/去重/更新数量）
 *   6. 输出变更摘要（写入 sync-summary.md 供 workflow 生成 PR body）
 *
 * CI 环境变量（GitHub Actions）：
 *   GITHUB_OUTPUT  输出 changed / added 供 workflow 判断
 */

import fs from "fs/promises";
import { execFileSync } from "child_process";

const UPSTREAM_BASE = "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master";
const LOCAL_FILE = "Rule/ProxyMedia.list";

// 上游分类：服务商名 -> 上游规则文件路径
// 服务商名用于匹配本地 "# 注释块"，大小写不敏感
// 注意：ini 里已有独立 ruleset 的分类（Netflix/YouTube/YouTubeMusic）不在此同步，避免重复
const CATEGORIES = {
  "DisneyPlus": "rule/Clash/DisneyPlus/DisneyPlus.list",
  "Spotify": "rule/Clash/Spotify/Spotify.list",
  "Twitch": "rule/Clash/Twitch/Twitch.list",
  "HBOMax": "rule/Clash/HBOMax/HBOMax.list",
  "ParamountPlus": "rule/Clash/ParamountPlus/ParamountPlus.list",
  "Peacock": "rule/Clash/Peacock/Peacock.list",
  "Crunchyroll": "rule/Clash/Crunchyroll/Crunchyroll.list",
};

// 误伤黑名单：第三方共用域名/CDN（即使上游收录也不应整体代理）
// 匹配规则：域名等于黑名单项或以 ".黑名单项" 结尾
const BLOCKLIST = new Set([
  "onetrust.com",      // 通用 Cookie 弹窗服务
  "cookielaw.org",     // 通用 Cookie 合规服务
  "amazonaws.com",     // AWS 通用（误伤所有 AWS 客户）
  "akamaized.net",     // Akamai 流媒体 CDN 通用域
  "akamaiedge.net",    // Akamai CDN 通用域
  "cloudfront.net",    // AWS CloudFront 通用 CDN
]);

const WRITE = process.argv.includes("--write");

// 黑名单后缀匹配
function isBlocked(domain) {
  for (const b of BLOCKLIST) {
    if (domain === b || domain.endsWith("." + b)) return true;
  }
  return false;
}

// 纯数字 CDN 子域（如 d1v5ir2lpwr8os.cloudfront.net），跳过避免噪音
function isNumericCdn(domain) {
  return /^\d+[a-z0-9-]*\./.test(domain);
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// 从规则文本提取域名集合
function extractDomains(text) {
  const domains = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [prefix, rest] = t.split(",", 2);
    if ((prefix === "DOMAIN" || prefix === "DOMAIN-SUFFIX") && rest) {
      const d = rest.trim().toLowerCase();
      if (d && !d.includes("*") && d.includes(".")) domains.add(d);
    }
  }
  return domains;
}

// 解析本地文件为块结构：[{ header, lines: [] }]
function parseBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    const isHeader = t.startsWith("#") &&
      !t.startsWith("# 内容") && !t.startsWith("# 更新") &&
      !t.startsWith("# 规则数量") && t.length > 2;
    if (isHeader) {
      if (current) blocks.push(current);
      current = { header: line, lines: [] };
    } else {
      if (!current) current = { header: null, lines: [] };
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

// 块头名（"# Netflix" -> "netflix"）
function blockName(header) {
  if (!header) return "";
  return header.replace(/^#\s*/, "").trim().toLowerCase();
}

function appendToBlock(blocks, name, domains) {
  const key = name.toLowerCase();
  let target = blocks.find(b => blockName(b.header) === key);
  if (!target) {
    target = { header: `# ${name}`, lines: [] };
    blocks.push(target);
  }
  for (const d of domains) target.lines.push(`DOMAIN-SUFFIX,${d}`);
}

async function main() {
  const localText = await fs.readFile(LOCAL_FILE, "utf8");
  const localDomains = extractDomains(localText);

  const summary = [];
  const allNew = []; // { name, domains: [] }
  let totalNew = 0;

  for (const [name, upstreamPath] of Object.entries(CATEGORIES)) {
    const url = `${UPSTREAM_BASE}/${upstreamPath}`;
    let upDomains;
    try {
      upDomains = extractDomains(await fetchText(url));
    } catch (e) {
      summary.push(`⚠️ ${name}: 拉取失败 ${e.message}`);
      continue;
    }
    const fresh = [...upDomains].filter(d =>
      !localDomains.has(d) && !isBlocked(d) && !isNumericCdn(d)
    ).sort();
    if (fresh.length) {
      allNew.push({ name, domains: fresh });
      totalNew += fresh.length;
      summary.push(`➕ ${name}: 新增 ${fresh.length} 条`);
    } else {
      summary.push(`· ${name}: 无新增`);
    }
  }

  if (!totalNew) {
    console.log("✅ 上游无新增域名");
    process.exit(0);
  }

  console.log(`📋 上游发现 ${totalNew} 个本地缺失域名:`);
  for (const { name, domains } of allNew) {
    console.log(`  [${name}] ${domains.join(", ")}`);
  }

  if (!WRITE) {
    console.log("\n（--write 未指定，仅报告）");
    process.exit(0);
  }

  // 写回：按服务商块插入
  const blocks = parseBlocks(localText);
  for (const { name, domains } of allNew) {
    appendToBlock(blocks, name, domains);
  }
  const newText = blocks.map(b => {
    const lines = b.lines.join("\n");
    return b.header ? `${b.header}\n${lines}` : lines;
  }).join("\n") + "\n";

  await fs.writeFile(LOCAL_FILE, newText, "utf8");

  // 运行 fix_rules.js 整理（排序/去重/数量）
  execFileSync("node", ["fix_rules.js"], { stdio: "inherit", cwd: process.cwd() });

  // 摘要文件（workflow 用于 PR body）
  const summaryText = [
    `## 🤖 上游规则同步结果\n`,
    ...summary,
    `\n共新增 **${totalNew}** 条域名，已按服务商块并入 ProxyMedia.list 并运行 fix_rules.js 整理。`,
    `\n> 人工确认后合并；如某域名不应代理，可在合并前移除。`,
  ].join("\n");
  await fs.writeFile("sync-summary.md", summaryText, "utf8");

  console.log(`\n✅ 已写入 ${LOCAL_FILE}，新增 ${totalNew} 条（fix_rules.js 已整理）`);

  // CI 输出
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=true\nadded=${totalNew}\n`);
  }
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(2);
});
