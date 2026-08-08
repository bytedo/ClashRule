# ClashRule

个人 Clash 分流规则配置：subconverter 订阅模板 + 自维护规则集。

## 使用方法

把订阅模板地址填入订阅转换服务（subconverter / sub-web / 机场自带转换）:

```
https://raw.githubusercontent.com/bytedo/ClashRule/main/DefaultConfig.ini
```

ruleset 顺序即规则匹配优先级：广告拦截 → AI → 媒体 → 游戏 → 大厂服务 → 国内媒体 → 全球直连 → 通用代理 → 漏网之鱼。

## 目录结构

```
├── DefaultConfig.ini           # subconverter 模板（ruleset + 分组策略）
├── fix_rules.js                # 规则维护脚本
├── Rule/
│   ├── AI.list                 # AI 服务代理（OpenAI/Claude/Gemini 等之外的长尾 AI 站）
│   ├── Direct.list             # 直连域名与 IP 段
│   ├── ProxyDomain.list        # 强制代理的社区/论坛
│   ├── ProxyMedia.list         # 国外流媒体（Netflix/Disney+/Spotify 等）
│   ├── FakeLocation/
│   │   └── app.list            # 国内 App 反 IP 归属（Fake IP 直连）
│   └── Gemini/
│       └── Gemini.list         # Gemini 全家桶（Google 官方清单）
```

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
