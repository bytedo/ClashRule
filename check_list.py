import os
import re

# 合法前缀
VALID_PREFIXES = [
    "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD",
    "IP-CIDR", "IP-CIDR6", "PROCESS-NAME", "USER-AGENT"
]

# 常见拼写错误自动纠正
PREFIX_CORRECTIONS = {
    "DOMAN": "DOMAIN",
    "DOMIAN": "DOMAIN",
    "DOMIAN-SUFFIX": "DOMAIN-SUFFIX",
    "DOMAIN-SUFIX": "DOMAIN-SUFFIX",
    "IPCIDR": "IP-CIDR",
    "IPCIDR6": "IP-CIDR6",
}

def correct_line(line):
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return line, False, None

    updated = False
    log_detail = None

    # 修正前缀拼写
    prefix = stripped.split(",")[0]
    for wrong, correct in PREFIX_CORRECTIONS.items():
        if prefix == wrong:
            new_line = stripped.replace(wrong, correct, 1)
            log_detail = (stripped, new_line)
            stripped = new_line
            updated = True

    # 检查前缀是否有效
    if not any(stripped.startswith(p) for p in VALID_PREFIXES):
        old_line = stripped
        if re.match(r"^\d{1,3}(\.\d{1,3}){3}", stripped):
            stripped = "IP-CIDR," + stripped
        elif re.match(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", stripped):
            stripped = "DOMAIN-SUFFIX," + stripped
        log_detail = (old_line, stripped)
        updated = True

    return stripped + "\n", updated, log_detail

def fix_list_file(path):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    modified = False
    new_lines = []
    file_log = []

    for i, line in enumerate(lines):
        corrected_line, updated, log_detail = correct_line(line)
        if updated:
            modified = True
            if log_detail:
                file_log.append(f"  [行 {i+1}] {log_detail[0]!r} -> {log_detail[1]!r}")
        new_lines.append(corrected_line)

    if modified:
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
        print(f"\n✅ 修改补全: {path}")
        for log in file_log:
            print(log)

    return modified

def main():
    total_files = 0
    modified_files = 0

    for root, _, files in os.walk("."):
        for file in files:
            if file.endswith(".list"):
                total_files += 1
                file_path = os.path.join(root, file)
                if fix_list_file(file_path):
                    modified_files += 1

    if modified_files == 0:
        print("✅ 校验完成")

    # 总结
    print(f"\n🎯 扫描完成: 共 {total_files} 个 .list 文件, 修改 {modified_files} 个文件.")

if __name__ == "__main__":
    main()
