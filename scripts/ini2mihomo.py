#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ClashRule ini → mihomo 原生配置生成器
=====================================
将 ClashRule 的 subconverter 模板（DefaultConfig.ini 等）转换为 mihomo 原生
配置片段（proxy-groups / rule-providers / rules），使 Clash/Mihomo 客户端可以
原生挂载 ClashRule 分流规则，同时完整保留 vless/tuic 等 subconverter 不支持的节点。

用法:
    python3 ini2mihomo.py DefaultConfig.ini > mihomo-clashrule.yaml
    输出片段可直接合并进 mihomo config.yaml（或 Clash Verge Merge 脚本）

规则集 URL 默认走 jsdelivr CDN（国内可达），可用 --cdn raw 切换 raw.githubusercontent
"""
import re
import sys
import argparse
from urllib.parse import urljoin

# rule-provider 名映射（中文 label -> ascii slug）
SLUGS = {
    '🛑 广告拦截': 'banad', '🍃 应用净化': 'banapp', '🤖 AI': 'ai', '📹 油管视频': 'youtube',
    '📺 哔哩哔哩': 'bilibili', '📲 电报消息': 'telegram', '🎬 Netflix': 'netflix',
    '🌍 国外媒体': 'media', '🎮 游戏平台': 'game', '📢 谷歌FCM': 'fcm',
    'Ⓜ️ 微软云盘': 'onedrive', 'Ⓜ️ 微软服务': 'microsoft', '🍎 苹果服务': 'apple',
    '🌏 国内媒体': 'cnmedia', '🎯 全球直连': 'direct', '🚀 节点选择': 'proxy',
    '🐟 漏网之鱼': 'final',
}

LOCAL_BASE = 'https://sub.wdao.de/ruleset'

CDN_MAP = {
    'raw': 'https://raw.githubusercontent.com/bytedo/ClashRule/main',
    'jsdelivr': 'https://cdn.jsdelivr.net/gh/bytedo/ClashRule@main',
    'local': LOCAL_BASE,
}

# 规则集 URL 文件名 → sub.wdao.de 静态快照文件名（对应 scripts/sync-rulesets.sh）
RULESET_MAP = {
    'BanAD.list': 'banad.list', 'AdvertisingLite.list': 'adl.list',
    'BanProgramAD.list': 'banprogramad.list', 'BanEasyPrivacy.list': 'baneasyprivacy.list',
    'OpenAI.list': 'openai.list', 'Claude.list': 'claude.list', 'Copilot.list': 'copilot.list',
    'YouTube.list': 'youtube.list', 'YouTubeMusic.list': 'youtubemusic.list',
    'BiliBili.list': 'bilibili.list', 'BiliBiliIntl.list': 'bilibiliintl.list',
    'Telegram.list': 'telegram.list', 'Netflix.list': 'netflix.list',
    'Epic.list': 'epic.list', 'Origin.list': 'origin.list', 'Sony.list': 'sony.list',
    'Steam.list': 'steam.list', 'GoogleFCM.list': 'googlefcm.list',
    'OneDrive.list': 'onedrive.list', 'Microsoft.list': 'microsoft.list', 'Apple.list': 'apple.list',
    'Direct.list': 'direct-bm7.list', 'ChinaDomain.list': 'chinadomain.list',
    'ChinaCompanyIp.list': 'chinacompanyip.list', 'Download.list': 'download.list',
    'LocalAreaNetwork.list': 'lan.list', 'UnBan.list': 'unban.list',
    'ProxyGFWlist.list': 'proxygfw.list', 'rule-provider.yaml': 'antiip.yaml',
    'AI.list': 'ai.list', 'ProxyMedia.list': 'proxymedia.list',
    'ProxyDomain.list': 'proxydomain.list', 'app.list': 'fakeapp.list',
}


def parse_ini(path):
    """解析 [custom] 段的 ruleset= 与 custom_proxy_group= 行"""
    rulesets = []      # (label, rule_spec)
    proxy_groups = []  # (name, type, selector, url, interval, tolerance)
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line.startswith('ruleset='):
            _, spec = line.split('=', 1)
            label, _, rest = spec.partition(',')
            rulesets.append((label.strip(), rest.strip()))
        elif line.startswith('custom_proxy_group='):
            _, spec = line.split('=', 1)
            parts = spec.split('`')
            if len(parts) >= 3:
                name, gtype, selector = parts[0].strip(), parts[1].strip(), parts[2].strip()
                url = parts[3] if len(parts) > 3 else ''
                interval = parts[4] if len(parts) > 4 else '300'
                tolerance = parts[5] if len(parts) > 5 else ''
                proxy_groups.append((name, gtype, selector, url, interval, tolerance))
    return rulesets, proxy_groups


def to_rule_providers(rulesets, cdn):
    """ruleset URL 列表 → mihomo rule-providers 片段
    cdn: 'local' | 'raw' | 'jsdelivr'"""
    providers, rules, slug_used = [], [], set()
    cdn_url = CDN_MAP.get(cdn, cdn)
    for label, spec in rulesets:
        slug = SLUGS.get(label, re.sub(r'\W+', '', label) or 'rs')
        if slug in slug_used:
            slug = slug + str(len(slug_used))
        slug_used.add(slug)
        if spec.startswith('[]GEOIP'):
            rules.append(f'  - GEOIP,{spec.split(",")[1]},{label},no-resolve')
        elif spec.startswith('[]FINAL') or spec == '[]FINAL':
            rules.append(f'  - MATCH,{label}')
        else:
            # http(s) URL / clash-classic: / surge: 前缀
            url = spec
            for p in ('clash-classic:', 'surge:'):
                if url.startswith(p):
                    url = url[len(p):]
            if cdn == 'local':
                # 本地静态快照：sub.wdao.de/ruleset/<sync 文件名>（国内直连，格式为 raw classical 行）
                base = re.search(r'/?([^/]+\.(?:list|yaml))$', url)
                fname = RULESET_MAP.get(base.group(1), base.group(1).lower()) if base else None
                url = f'{cdn_url}/{fname}' if fname else url
            else:
                # 统一转 jsdelivr CDN（国内可达），raw.githubusercontent 被墙时规则集拉不到
                m = re.match(r'https?://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)', url)
                if m:
                    owner, repo, branch, path = m.groups()
                    url = f'https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}'
                elif 'bytedo/ClashRule' in url:
                    rel = re.search(r'ClashRule[^/]*/(Rule/.+)', url)
                    if rel:
                        url = cdn_url + '/' + rel.group(1)
            providers.append(
                f'  {slug}:\n'
                f'    type: http\n'
                f'    behavior: classical\n'
                f'    url: "{url}"\n'
                f'    path: ./ruleset/{slug}.yaml\n'
                f'    interval: 86400'
            )
            rules.append(f'  - RULE-SET,{slug},{label}')
    return '\n'.join(providers), '\n'.join(rules)


def to_proxy_groups(proxy_groups, provider_name='airport'):
    """custom_proxy_group → mihomo proxy-groups 片段（select/url-test）
    provider_name: url-test 组 use 的 proxy-provider 名（多源聚合时的主 provider）"""
    out, n = [], 0
    for name, gtype, selector, url, interval, tolerance in proxy_groups:
        n += 1
        if gtype == 'select':
            # .* 表示全节点 → use provider（mihomo select 组可用 use）
            if selector.strip() == '.*':
                grp = (
                    f'- name: {name}\n'
                    f'  type: select\n'
                    f'  use:\n'
                    f'    - {provider_name}'
                )
            else:
                proxies = []
                for item in selector.split('[]'):
                    item = item.strip()
                    if not item:
                        continue
                    proxies.append(f'    - {item}')
                grp = (
                    f'- name: {name}\n'
                    f'  type: select\n'
                    f'  proxies:\n' + '\n'.join(proxies)
                )
        elif gtype == 'url-test':
            # ClashRule 格式: url`interval,,tolerance
            seg = (interval or '300,,50').split(',')
            ival = seg[0] or '300'
            tol = seg[2] if len(seg) > 2 else '50'
            use = f'\n  use:\n    - {provider_name}'
            grp = (
                f'- name: {name}\n'
                f'  type: url-test\n'
                f'  url: {url or "http://www.gstatic.com/generate_204"}\n'
                f'  interval: {ival}\n'
                f'  tolerance: {tol}{use}'
            )
        else:
            continue
        out.append(grp)
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ini', help='ClashRule ini 模板路径')
    ap.add_argument('--cdn', choices=['raw', 'jsdelivr', 'local'], default='local',
                    help='规则集 URL 模式: raw=GitHub 直连 / jsdelivr=CDN / local=sub.wdao.de 静态快照(默认)')
    args = ap.parse_args()

    cdn = args.cdn
    rulesets, groups = parse_ini(args.ini)
    providers, rules = to_rule_providers(rulesets, cdn)
    group_yaml = to_proxy_groups(groups)

    print('# ============================================================')
    print('# ClashRule → mihomo 原生配置（由 ini2mihomo.py 生成）')
    print(f'# 来源: {args.ini} | CDN: {cdn}')
    print('# 合并方式: 将下段分别并入 mihomo config.yaml 的对应顶层键')
    print('# ============================================================')
    print('# --- 1) rule-providers：挂载 ClashRule 规则集 ---')
    print('rule-providers:')
    print(providers)
    print()
    print('# --- 2) rules：按 ClashRule 优先级引用（广告→AI→媒体→直连→代理→FINAL）---')
    print('rules:')
    print(rules)
    print()
    print('# --- 3) proxy-groups：ClashRule 分组（需在 config 中定义 airport provider）---')
    print('proxy-groups:')
    print(group_yaml)


if __name__ == '__main__':
    main()