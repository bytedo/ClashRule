#!/usr/bin/env node
/**
 * check-subscription.js
 *
 * 巡检 DefaultConfig.ini 引用的全部 ruleset 上游 URL：
 * - HTTP 状态 2xx 且响应体非空视为正常
 * - 输出 OK/FAIL 报告
 * - 有异常时退出码为 1（workflow 据此告警）
 */

import fs from "fs/promises";

const INI = "DefaultConfig.ini";

async function checkUrl(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
      headers: { "User-Agent": "ClashRule-HealthCheck/1.0" },
    });
    const statusOk = res.ok && res.status >= 200 && res.status < 300;
    let nonEmpty = false;
    if (statusOk) {
      const reader = res.body.getReader();
      const { value } = await reader.read();
      nonEmpty = !!value && value.length > 0;
      await reader.cancel();
    }
    return { ok: statusOk && nonEmpty, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: "ERR", ms: Date.now() - t0, error: e.message };
  }
}

async function main() {
  const text = await fs.readFile(INI, "utf8");
  const targets = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("ruleset=")) continue;
    const url = t.split(",").slice(1).join(",").trim().replace(/^clash-classic:/, "");
    if (/^https?:\/\//.test(url)) {
      const label = t.split(",")[0].slice("ruleset=".length).trim();
      targets.push({ label, url });
    }
  }

  console.log(`🔍 巡检 ${targets.length} 个 ruleset URL (${new Date().toISOString().slice(0, 16)})\n`);
  const results = await Promise.all(targets.map(t => checkUrl(t.url)));

  let fail = 0;
  results.forEach((r, i) => {
    const t = targets[i];
    const mark = r.ok ? "✅" : "❌";
    if (!r.ok) fail++;
    const err = r.error ? ` ${r.error}` : "";
    console.log(`${mark} [${t.label}] ${r.status} ${r.ms}ms ${t.url}${err}`);
  });

  console.log(`\n📊 结果: ${results.length - fail}/${results.length} 正常, ${fail} 个异常`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(2);
});
