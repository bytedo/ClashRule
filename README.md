# ClashRule

个人 Clash 分流规则配置：subconverter 订阅模板 + 自维护规则集。

## 使用方法

把订阅模板地址填入订阅转换服务（subconverter / sub-web / 机场自带转换）:

```
https://raw.githubusercontent.com/bytedo/ClashRule/main/DefaultConfig.ini
```

ruleset 顺序即规则匹配优先级：广告拦截 → AI → 媒体 → 游戏 → 大厂服务 → 国内媒体 → 全球直连 → 通用代理 → 漏网之鱼。

## 配置文件（按场景选一个）

| 文件 | 定位 | 说明 |
|---|---|---|
| DefaultConfig.ini | 日常全能 | 广告拦截 + AI + 媒体 + 游戏 + 大厂 + 国内媒体全量分流 |
| PureConfig.ini | 纯净版 | 同 Default 但无广告拦截/应用净化，避免规则误杀（游戏、办公场景） |
| MediaConfig.ini | 媒体解锁版 | 媒体规则前置，Netflix/油管/国外媒体默认香港/台湾节点，追剧首选 |
| MiniConfig.ini | 极简版 | 仅 Telegram/Netflix/国外媒体 + 直连 + GFW，规则最少，适合路由器/低配设备 |

全部配置共用同一套 Rule/ 规则文件，切换配置不影响规则维护。

## 目录结构

```
├── DefaultConfig.ini           # 日常全能配置（默认）
├── PureConfig.ini              # 纯净版（无广告拦截）
├── MediaConfig.ini             # 媒体解锁版（默认香港/台湾节点）
├── MiniConfig.ini              # 极简版（弱设备）
├── fix_rules.js                # 规则维护脚本
├── scripts/                    # GitHub Actions 自动化脚本
│   ├── sync-upstream.js        # 上游规则同步（自动 PR）
│   ├── check-subscription.js   # ruleset URL 健康巡检（自动 issue）
│   └── check-domains.js        # 规则域名 DNS 死链检测（自动 issue）
├── Rule/
│   ├── AI.list                 # AI 服务代理（按服务商分类，含 Gemini 全家桶）
│   ├── Direct.list             # 直连域名与 IP 段
│   ├── ProxyDomain.list        # 强制代理的社区/论坛
│   ├── ProxyMedia.list         # 国外流媒体（Netflix/Disney+/Spotify 等）
│   └── FakeLocation/
│       └── app.list            # 国内 App 反 IP 归属（Fake IP 直连）
```

## 自动化（GitHub Actions）

| Workflow | 触发 | 产出 |
|---|---|---|
| 规则检查 | push / PR | 校验规则合法性，坏规则直接拦截 |
| 上游规则同步 | 每周一 10:00 | 拉取 blackmatrix7 媒体分类，有新增自动开 PR（人工 review 后合并） |
| 订阅健康巡检 | 每天 14:00 | 巡检 ini 引用全部 ruleset URL，异常自动开 issue |
| 规则死域名检测 | 每周日 10:00 | 批量 DNS 解析规则域名，疑似失效自动开 issue |
| 自动发布 Release | 规则文件变更 | 自动打 tag + 中文 changelog |

自动化全部走 issue / PR 模式，不需要额外配置 token。

## 维护规则

添加/修改规则后，运行修复脚本（自动去重、清理被 SUFFIX 覆盖的冗余 DOMAIN、块内排序、更新规则数量）:

```bash
node fix_rules.js           # 修复并写回文件
node fix_rules.js --check   # 只检查不写回（CI 使用）
```

仓库已配置 pre-commit 钩子，提交时自动执行修复；GitHub Actions 会在 push 时校验规则合法性。

## 更新日志

- 2026-08-09: 工程化改造
  - fix_rules.js 支持 --check 模式、智能冗余删除（SUFFIX 覆盖 DOMAIN 域名级匹配）、稳定排序
  - AI.list 补 groq/together/fireworks/lmarena/v0.dev/bolt.new/civitai，移入 huggingface（直连不可达）
  - Direct.list 删除失效 HF 直连、华为云 IP 段加注释
  - ProxyMedia 清理已停服的 hbonow.com；删除空文件 ProxyIP.list
  - 新增 Netflix 专属分组与 GitHub 分流；README/.gitattributes/CI 补齐
- 2026-08-07: 规则大优化（清理冗余/误伤、补充缺失服务、修复分组正则）
- 2026-08-07: 新增国内媒体反 IP 归属规则与全球直连规则

## 致谢

- https://github.com/ACL4SSR/ACL4SSR
- https://github.com/blackmatrix7/ios_rule_script
- https://github.com/lwd-temp/anti-ip-attribution
