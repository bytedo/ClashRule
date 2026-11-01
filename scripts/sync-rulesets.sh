#!/usr/bin/env bash
# ============================================================
# 规则集 / 订阅快照同步脚本（sg 服务器）
# 将 ClashRule 规则集 + 外部规则集 + 直连不可达的机场订阅
# 抓取到 sub.wdao.de 静态目录，供国内 mihomo 原生挂载
#
# 用法: bash /opt/subweb/sync-rulesets.sh
# 建议 cron 每日 02:00 执行（机场订阅每日刷新）
# ============================================================
set -euo pipefail

SITE_DIR=/opt/1panel/www/sites/sub.wdao.de/index/ruleset
CLASHRULE_GIT=https://raw.githubusercontent.com/bytedo/ClashRule/main
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

mkdir -p "$SITE_DIR"

fetch() { # $1=name  $2=url
  local name="$1" url="$2"
  if curl -s -m 60 -A "$UA" -L "$url" -o "$SITE_DIR/$name" -w "%{http_code}" | grep -q 200; then
    local lines=$(wc -l < "$SITE_DIR/$name")
    echo "✅ $name ($lines 行)"
  else
    echo "❌ $name 抓取失败"
    rm -f "$SITE_DIR/$name"
  fi
}

echo "== 1. ClashRule 自有规则集 =="
fetch ai.list            "$CLASHRULE_GIT/Rule/AI.list"
fetch direct.list        "$CLASHRULE_GIT/Rule/Direct.list"
fetch proxymedia.list    "$CLASHRULE_GIT/Rule/ProxyMedia.list"
fetch proxydomain.list   "$CLASHRULE_GIT/Rule/ProxyDomain.list"
fetch fakeapp.list       "$CLASHRULE_GIT/Rule/FakeLocation/app.list"

echo "== 2. 外部规则集（ACL4SSR / blackmatrix7 / lwd-temp）=="
fetch banad.list         "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanAD.list"
fetch banprogramad.list  "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanProgramAD.list"
fetch baneasyprivacy.list "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/BanEasyPrivacy.list"
fetch adl.list           "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/AdvertisingLite/AdvertisingLite.list"
fetch openai.list        "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/OpenAI/OpenAI.list"
fetch claude.list        "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Claude/Claude.list"
fetch copilot.list       "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Copilot/Copilot.list"
fetch youtube.list       "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/YouTube/YouTube.list"
fetch youtubemusic.list  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/YouTubeMusic/YouTubeMusic.list"
fetch bilibili.list      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/BiliBili/BiliBili.list"
fetch bilibiliintl.list  "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/BiliBiliIntl/BiliBiliIntl.list"
fetch telegram.list      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Telegram/Telegram.list"
fetch netflix.list       "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Netflix/Netflix.list"
fetch epic.list          "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Epic/Epic.list"
fetch origin.list        "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Origin/Origin.list"
fetch sony.list          "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Sony/Sony.list"
fetch steam.list         "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Steam/Steam.list"
fetch googlefcm.list     "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/GoogleFCM/GoogleFCM.list"
fetch onedrive.list      "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/OneDrive/OneDrive.list"
fetch microsoft.list     "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Microsoft/Microsoft.list"
fetch apple.list         "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Apple.list"
fetch direct-bm7.list    "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Direct/Direct.list"
fetch chinadomain.list   "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list"
fetch chinacompanyip.list "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list"
fetch download.list      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Download.list"
fetch lan.list           "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list"
fetch unban.list         "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/UnBan.list"
fetch proxygfw.list      "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ProxyGFWlist.list"
fetch antiip.yaml        "https://raw.githubusercontent.com/lwd-temp/anti-ip-attribution/main/generated/rule-provider.yaml"

echo "== 3. 机场订阅快照（直连不可达 → 中转）=="
if [ -n "${MITCE_TOKEN:-}" ]; then
  fetch mitce.yaml        "https://app.mitce.net/?sid=874927&token=$MITCE_TOKEN"
else
  echo "⚠️ 未设置 MITCE_TOKEN，跳过 MITCE 快照"
fi

echo ""
echo "== 站点规则集目录 =="
ls -la "$SITE_DIR" | tail -5
echo "总计: $(ls "$SITE_DIR" | wc -l) 个文件"