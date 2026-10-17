#!/usr/bin/env node
/**
 * check-domains.js
 *
 * 批量 DNS 检查所有 .list 规则中的 DOMAIN / DOMAIN-SUFFIX 域名，
 * 找出疑似已失效的条目并报告。
 *
 * 判定规则（避免 DOMAIN-SUFFIX 基域误报）：
 * - DOMAIN        ：精确主机名，必须能解析出 A/AAAA 记录，否则视为失效
 * - DOMAIN-SUFFIX ：域名后缀基域（如 nflximg.net、tiktokcdn.com），其 apex
 *                   常常没有 A 记录但域名本身有效，故只要 A/AAAA 可解析，
 *                   或该域已注册（存在 SOA / NS 记录）即视为存活
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

// 带超时执行一次 DNS 查询，成功返回 true
async function resolves(fn) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// A/AAAA 任一解析成功即视为可解析
async function hasAddress(domain) {
  const [a, aaaa] = await Promise.all([
    resolves(() => dns.resolve4(domain)),
    resolves(() => dns.resolve6(domain)),
  ]);
  return a || aaaa;
}

// 域名是否已注册（存在 SOA 或 NS 记录）
async function isRegistered(domain) {
  const [soa, ns] = await Promise.all([
    resolves(() => dns.resolveSoa(domain)),
    resolves(() => dns.resolveNs(domain)),
  ]);
  return soa || ns;
}

async function isAlive(domain, isSuffix) {
  if (await hasAddress(domain)) return true;
  // DOMAIN-SUFFIX 基域：apex 无 A 记录属正常，已注册即视为有效
  if (isSuffix && (await isRegistered(domain))) return true;
  return false;
}

async function main() {
  const files = await walk(ROOT);
  const domainMeta = new Map(); // domain -> { kinds:Set, files:Set }

  for (const f of files) {
    const text = await fs.readFile(f, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [prefix, rest] = t.split(",", 2);
      if ((prefix === "DOMAIN" || prefix === "DOMAIN-SUFFIX") && rest) {
        const d = rest.split(",")[0].trim().toLowerCase();
        if (/^[a-z0-9.-]+$/.test(d) && d.includes(".")) {
          if (!domainMeta.has(d)) domainMeta.set(d, { kinds: new Set(), files: new Set() });
          domainMeta.get(d).kinds.add(prefix);
          domainMeta.get(d).files.add(f);
        }
      }
    }
  }

  const domains = [...domainMeta.keys()];
  console.log(`🔍 待检测域名: ${domains.length} 个（并发 ${CONCURRENCY}）`);

  const dead = [];
  let idx = 0;
  async function worker() {
    while (idx < domains.length) {
      const d = domains[idx++];
      const isSuffix = domainMeta.get(d).kinds.has("DOMAIN-SUFFIX");
      if (!(await isAlive(d, isSuffix))) dead.push(d);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (!dead.length) {
    console.log("✅ 全部域名解析正常");
    process.exit(0);
  }

  console.log(`\n❌ 发现 ${dead.length} 个疑似失效域名（建议人工核实后移除）:`);
  for (const d of dead.sort()) {
    const src = [...domainMeta.get(d).files].map(f => f.replace("Rule/", "")).join(", ");
    console.log(`  - ${d}  [来源: ${src}]`);
  }
  process.exit(1);
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(2);
});
