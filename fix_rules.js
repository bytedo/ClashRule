#!/usr/bin/env node
/**
 * fix_rules.js
 *
 * 功能：
 * - 递归扫描子目录的 .list 与 .ini 文件（异步并行）
 * - .list: 保留空行/注释、更新则数量、按区块排序（prefix 小区块 + 主域首字母）
 * - .ini: 检查 ruleset 与 custom_proxy_group 对应性（不修改）
 * - 输出清晰日志；若有修改或错误则 exit 1（pre-commit 阻止提交）
 *
 * 无外部依赖
 */

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

// --- 配置 ---
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

// 多级公共后缀常见列表
const MULTI_TLDS = new Set([
"com.cn","net.cn","org.cn","gov.cn","edu.cn","ac.cn","mil.cn","biz.cn","info.cn","name.cn","tv.cn","mobi.cn","tel.cn","travel.cn",
"com.hk","net.hk","org.hk","gov.hk","edu.hk","idv.hk","公司.hk","教育.hk","政府.hk","個人.hk","網絡.hk","網络.hk",
"com.tw","net.tw","org.tw","gov.tw","edu.tw","mil.tw","idv.tw","game.tw","ebiz.tw","club.tw","網路.tw","組織.tw","商業.tw",
"co.jp","ne.jp","or.jp","go.jp","ac.jp","ad.jp","ed.jp","gr.jp","lg.jp","geo.jp",
"com.kr","ne.kr","or.kr","go.kr","ac.kr","hs.kr","ms.kr","es.kr","sc.kr","kg.kr","seoul.kr","busan.kr","daegu.kr","incheon.kr","gwangju.kr","daejeon.kr","ulsan.kr",
"co.uk","org.uk","gov.uk","ac.uk","edu.uk","sch.uk","police.uk","mod.uk","nhs.uk","ltd.uk","plc.uk","net.uk","nic.uk",
"com.au","net.au","org.au","gov.au","edu.au","asn.au","id.au","csiro.au","act.au","nsw.au","nt.au","qld.au","sa.au","tas.au","vic.au","wa.au",
"co.nz","net.nz","org.nz","govt.nz","ac.nz","geek.nz","gen.nz","kiwi.nz","maori.nz","school.nz",
"com.de","net.de","org.de","gov.de","edu.de","de.com","de.net","de.org",
"com.fr","net.fr","org.fr","gov.fr","edu.fr","asso.fr","nom.fr","prd.fr","presse.fr","tm.fr","aeroport.fr","avocat.fr","gouv.fr",
"com.ca","net.ca","org.ca","gov.ca","edu.ca","ca.com","ca.net","ca.org","on.ca","bc.ca","qc.ca","ab.ca","sk.ca","mb.ca","nb.ca","ns.ca","pe.ca","nl.ca","nt.ca","yt.ca","nu.ca",
"ca.us","ny.us","tx.us","fl.us","il.us","pa.us","oh.us","mi.us","nc.us","ga.us","nj.us","va.us","wa.us","az.us","co.us","md.us","mn.us","sc.us","al.us","la.us","ky.us","wi.us","mo.us","ok.us","ar.us","ia.us","or.us","ks.us","ut.us","ct.us","me.us","nh.us","ri.us","wv.us","hi.us","ak.us","de.us","sd.us","nd.us","vt.us","wy.us","mt.us","id.us","ne.us","nv.us","nm.us","ms.us","tn.us","in.us",
"com.br","net.br","org.br","gov.br","edu.br","mil.br","blog.br","nom.br","vlog.br","wiki.br","adm.br","adv.br","arq.br","art.br","ato.br","bio.br","bmd.br","cim.br","cng.br","cnt.br","ecn.br","eco.br","emp.br","eng.br","esp.br","etc.br","eti.br","far.br","fm.br","fnd.br","fot.br","fst.br","g12.br","ggf.br","imb.br","ind.br","inf.br","jor.br","jus.br","leg.br","lel.br","mat.br","med.br","mus.br","not.br","ntr.br","odo.br","ppg.br","pro.br","psc.br","psi.br","qsl.br","radio.br","rec.br","slg.br","srv.br","taxi.br","teo.br","tmp.br","trd.br","tur.br","tv.br","vet.br","zlg.br",
"co.in","net.in","org.in","gov.in","edu.in","mil.in","ac.in","res.in","gen.in","firm.in","ind.in","nic.in","ernet.in","govt.in","inc.in",
"com.ru","net.ru","org.ru","gov.ru","edu.ru","mil.ru","int.ru","pp.ru","msk.ru","spb.ru","nov.ru","ekb.ru","nsk.ru","nng.ru","kaz.ru","rnd.ru","rov.ru","vladikavkaz.ru","yaroslavl.ru",
"com.se","net.se","org.se","gov.se","edu.se","mil.se","int.se","parti.se","press.se","tm.se","brand.se"

]);

const PREFIX_ORDER = {};
VALID_PREFIXES.forEach((p, i) => PREFIX_ORDER[p] = i);

// 并发数（可根据仓库大小调整）
const CONCURRENCY = 16;

// --- 工具函数 ---
function color(text, code = "") {
  const map = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m" };
  return (map[code] || "") + text + (map[code] ? "\x1b[0m" : "");
}

async function walk(root) {
  const files = [];
  async function _walk(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await _walk(full);
      else if (e.isFile() && (full.endsWith(".list") || full.endsWith(".ini"))) files.push(full);
    }
  }
  await _walk(root);
  return files;
}

function checkListLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const [prefix] = t.split(",", 1);
  if (!prefix || !VALID_PREFIXES.includes(prefix)) return `非法前缀或格式: ${line}`;
  return null;
}

// 提取 prefix, domain (value after first comma)
function parseRule(line) {
  const t = line.trim();
  const [prefix = "", rest = ""] = t.split(",", 2);
  return { prefix, value: (rest || "").trim() };
}

// 根据公共后缀提取主域（registrable domain 的前缀），用于排序的 key
function extractMainDomain(value) {
  if (!value) return "";
  // 对于带协议或路径的值，先取主域部分（如果有）
  let domain = value.split("/")[0];
  // 去掉可能的端口
  domain = domain.split(":")[0];
  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return domain.toLowerCase();
  // 从右向左尝试匹配最长公共后缀
  for (let i = 2; i <= Math.min(parts.length, 4); i++) { // 尝试长度为2到4的后缀片段
    const suffix = parts.slice(-i).join(".");
    if (MULTI_TLDS.has(suffix)) {
      const idx = parts.length - i - 1;
      return (parts[idx] || parts[0]).toLowerCase();
    }
  }
  // 默认使用倒数第二段
  return parts[parts.length - 2].toLowerCase();
}

// 对区块内规则按 prefix order -> 主域排序，保留注释与空行原位
function sortBlockRules(blockLines) {
  // 收集可排序的规则行
  const items = blockLines.map((raw, idx) => {
    const trimmed = raw.trim();
    const isRule = trimmed && !trimmed.startsWith("#");
    if (!isRule) return { raw, isRule, idx };
    const { prefix, value } = parseRule(raw);
    const prefixRank = (PREFIX_ORDER[prefix] !== undefined) ? PREFIX_ORDER[prefix] : 999;
    const mainKey = extractMainDomain(value);
    return { raw, isRule, idx, prefix, prefixRank, value, mainKey };
  });

  // 构建要排序的子数组（只规则部分）
  const rules = items.filter(i => i.isRule);

  // 排序规则：先 prefixRank，再 mainKey，再完整 value（次级）
  rules.sort((a, b) => {
    if (a.prefixRank !== b.prefixRank) return a.prefixRank - b.prefixRank;
    const cmpMain = a.mainKey.localeCompare(b.mainKey, undefined, { sensitivity: "base" });
    if (cmpMain !== 0) return cmpMain;
    return a.value.localeCompare(b.value, undefined, { sensitivity: "base" });
  });

  // 回填：把排序后的规则按遇到的规则位置依次替换
  const result = [];
  let ruleIdx = 0;
  for (const it of items) {
    if (!it.isRule) result.push(it.raw);
    else {
      result.push(rules[ruleIdx].raw);
      ruleIdx++;
    }
  }
  return result;
}

// 处理 .list 文件：统计、检测、更新第三行、按区块排序，写回（仅当内容变化时写）
async function processListFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const errors = [];
  let ruleCount = 0;

  // 统计并检查
  for (const line of lines) {
    const err = checkListLine(line);
    if (err) errors.push(err);
    else if (line.trim() && !line.trim().startsWith("#")) ruleCount++;
  }

  // 更新规则数量
  const newLines = [...lines];
  const countLine = `# 规则数量: ${ruleCount}`;
  if (newLines.length >= 3) newLines[2] = countLine;
  else {
    while (newLines.length < 2) newLines.push("");
    newLines.push(countLine);
  }

  // 区块分割：以 # 开头的注释行为区块分隔符
  const final = [];
  let block = [];

  const flush = () => {
    if (block.length === 0) return;
    const sorted = sortBlockRules(block);
    final.push(...sorted);
    block = [];
  };

  for (const line of newLines) {
    if (line.trim().startsWith("#")) {
      flush();
      final.push(line);
    } else {
      block.push(line);
    }
  }
  flush();

  const finalText = final.join("\n");
  if (finalText !== raw) {
    await fs.writeFile(filePath, finalText, "utf8");
    return { modified: true, errors };
  }
  return { modified: false, errors };
}

// 解析并检查 ini 文件（不修改）
async function checkIniFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const ruleSections = [];
  const groupSections = [];
  let current = null;
  let mode = null;

  for (const rawLine of lines) {
    const s = rawLine.trim();
    if (!s) continue;
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
    const [k, v] = s.split("=", 2).map(x => x.trim());
    if (mode === "rule" && k === "ruleset") {
      const m = v.match(/^([^,]+)/);
      if (m) current.push(m[1]);
    }
    if (mode === "group" && k === "custom_proxy_group") {
      const m = v.match(/^([^`]+)/);
      if (m) current.push(m[1]);
    }
  }
  if (mode === "rule") ruleSections.push(current || []);
  if (mode === "group") groupSections.push(current || []);

  const errors = [];
  for (let i = 0; i < ruleSections.length; i++) {
    const rules = ruleSections[i] || [];
    const groups = groupSections[i] || [];
    for (const r of rules) {
      if (!groups.includes(r)) errors.push(`ruleset '${r}' 未在对应分组中定义`);
    }
  }
  return errors;
}

// 并发执行工具（限制并发）
async function runWithConcurrency(tasks, concurrency = CONCURRENCY) {
  const results = [];
  const running = [];
  for (const t of tasks) {
    const p = t().then(r => { // swallow to continue
      return r;
    });
    results.push(p);
    running.push(p);
    if (running.length >= concurrency) {
      await Promise.race(running).catch(() => {});
      // 移除已完成的
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i].isFulfilled || running[i].isRejected) running.splice(i, 1);
      }
      // Note: Node promises lack isFulfilled flag; simple approach: await a short delay if race returns
    }
  }
  return Promise.all(results);
}

// 主流程
(async function main() {
  try {
    const root = process.cwd();
    console.log(color("🔍 开始递归扫描目录...", "cyan"));

    const allFiles = await walk(root);
    const listFiles = allFiles.filter(f => f.endsWith(".list"));
    const iniFiles = allFiles.filter(f => f.endsWith(".ini"));

    console.log(`  找到 ${listFiles.length} 个 .list，${iniFiles.length} 个 .ini\n`);

    // 处理 .list（并行，限制并发）
    const listTasks = listFiles.map(f => async () => {
      return processListFile(f).then(res => ({ file: f, ...res }));
    });

    // 使用 simple concurrency runner (sequential chunking)
    const chunked = [];
    for (let i = 0; i < listTasks.length; i += CONCURRENCY) {
      const chunk = listTasks.slice(i, i + CONCURRENCY).map(fn => fn());
      chunked.push(...(await Promise.all(chunk)));
    }

    const modifiedList = [];
    let listErrors = [];
    for (const r of chunked) {
      if (r.modified) modifiedList.push(r.file);
      if (r.errors && r.errors.length) listErrors.push({ file: r.file, errors: r.errors });
    }

    // 处理 .ini 并行（简单并发）
    const iniResults = [];
    for (let i = 0; i < iniFiles.length; i += CONCURRENCY) {
      const chunk = iniFiles.slice(i, i + CONCURRENCY).map(f => checkIniFile(f).then(errs => ({ file: f, errors: errs })));
      iniResults.push(...(await Promise.all(chunk)));
    }

    const iniErrors = iniResults.filter(x => x.errors && x.errors.length);

    // 输出日志
    if (modifiedList.length > 0) {
      console.log(color("📄 已修改的 .list 文件（请 git add 后重新提交）：", "yellow"));
      modifiedList.forEach(f => console.log("  -", path.relative(root, f)));
      console.log("");
    } else {
      console.log(color("✔ .list 文件无需修改", "green"));
    }

    if (listErrors.length > 0) {
      console.log(color("\n❌ .list 校验错误：", "red"));
      listErrors.forEach(item => {
        console.log(" -", path.relative(root, item.file));
        item.errors.forEach(e => console.log("    •", e));
      });
    }

    if (iniErrors.length > 0) {
      console.log(color("\n❌ .ini 校验错误：", "red"));
      iniErrors.forEach(item => {
        console.log(" -", path.relative(root, item.file));
        item.errors.forEach(e => console.log("    •", e));
      });
    } else {
      console.log(color("\n✔ .ini 检查通过（或无 .ini 文件）", "green"));
    }

    const totalErrors = listErrors.reduce((s, it) => s + it.errors.length, 0) + iniErrors.reduce((s, it) => s + it.errors.length, 0);
    console.log("\n" + color(`📊 完成：扫描 ${listFiles.length} 个 .list，${iniFiles.length} 个 .ini；修改 ${modifiedList.length} 个 .list；错误 ${totalErrors} 个`, "bold"));

    // pre-commit 行为：若有修改或错误则阻止提交（exit 1）
    if (modifiedList.length > 0 || totalErrors > 0) {
      if (modifiedList.length > 0) console.log(color("⚠️ 已自动写入 .list 文件，需 git add 后重新提交。", "yellow"));
      process.exit(1);
    } else {
      console.log(color("✅ 校验通过，可提交", "green"));
      process.exit(0);
    }
  } catch (e) {
    console.error(color("Fatal: " + e.message, "red"));
    process.exit(2);
  }
})();
