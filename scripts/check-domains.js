#!/usr/bin/env node
/**
 * check-domains.js
 *
 * 批量 DNS 解析所有 .list 规则中的 DOMAIN / DOMAIN-SUFFIX 域名，
 * 找出已失效（解析失败）的条目并报告。
 *
 * 注意：
 * - 使用 GitHub 海外 runner 的干净 DNS，避免国内污染误报
 * - 仅报告不修改，域名疑似失效需人工核实后再移除
 * - 有失效域名时退出码为 1（workflow 据此开 issue）
 */

import fs from "fs/promises";
import path from "path";
import dns from "dns/promises";

const ROOT = "Rule";
const CONCURRENCY = 30;
const TIMEOUT_MS = 6000;

async function walk(dir) {
  const files = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...await walk(full));
    else if (e.name.endsWith(".list")) files.push(full);
  }
  return files;
}

// A/AAAA 任一解析成功即视为存活
async function isAlive(domain) {
  const results = await Promise.allSettled([
    dns.resolve4(domain),
    dns.resolve6(domain),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
  ]);
  return results.some(r => r.status === "fulfilled");
}

async function main() {
  const files = await walk(ROOT);
  const domainSources = new Map(); // domain -> Set(file)

  for (const f of files) {
    const text = await fs.readFile(f, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [prefix, rest] = t.split(",", 2);
      if ((prefix === "DOMAIN" || prefix === "DOMAIN-SUFFIX") && rest) {
        const d = rest.split(",")[0].trim().toLowerCase();
        if (/^[a-z0-9.-]+$/.test(d) && d.includes(".")) {
          if (!domainSources.has(d)) domainSources.set(d, new Set());
          domainSources.get(d).add(f);
        }
      }
    }
  }

  const domains = [...domainSources.keys()];
  console.log(`🔍 待检测域名: ${domains.length} 个（并发 ${CONCURRENCY}）`);

  const dead = [];
  let idx = 0;
  async function worker() {
    while (idx < domains.length) {
      const d = domains[idx++];
      if (!(await isAlive(d))) dead.push(d);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (!dead.length) {
    console.log("✅ 全部域名解析正常");
    process.exit(0);
  }

  console.log(`\n❌ 发现 ${dead.length} 个解析失败域名（建议人工核实后移除）:`);
  for (const d of dead.sort()) {
    const src = [...domainSources.get(d)].map(f => f.replace("Rule/", "")).join(", ");
    console.log(`  - ${d}  [来源: ${src}]`);
  }
  process.exit(1);
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(2);
});
