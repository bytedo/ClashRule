import os
import ipaddress
from datetime import datetime
import hashlib

RULE_TYPES = ["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "GEOIP"]

# 常见错误前缀映射
PREFIX_FIX_MAP = {
    "DOMAIN-SUFIX": "DOMAIN-SUFFIX",
    "IP-CID": "IP-CIDR",
    "DOMIAN": "DOMAIN",
    "DOMIAN-SUFFIX": "DOMAIN-SUFFIX",
    "GEO-IP": "GEOIP",
}

def correct_prefix(prefix):
    prefix_upper = prefix.upper()
    if prefix_upper in RULE_TYPES:
        return prefix_upper
    if prefix_upper in PREFIX_FIX_MAP:
        return PREFIX_FIX_MAP[prefix_upper]
    return None

def needs_prefix(stripped_line):
    stripped = stripped_line.strip()
    if not stripped or stripped.startswith("#"):
        return False
    for prefix in RULE_TYPES:
        if stripped.upper().startswith(prefix + ","):
            return False
    return True

def process_line(line):
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return line.rstrip("\n"), False

    parts = stripped.split(",", 1)
    if len(parts) == 1:
        try:
            ipaddress.ip_network(stripped, strict=False)
            fixed_line = f"IP-CIDR,{stripped}"
        except ValueError:
            fixed_line = f"DOMAIN-SUFFIX,{stripped}"
        return fixed_line, True
    else:
        prefix, rest = parts[0].strip(), parts[1].strip()
        corrected_prefix = correct_prefix(prefix)
        if corrected_prefix is None:
            try:
                ipaddress.ip_network(prefix + "," + rest, strict=False)
                fixed_line = f"IP-CIDR,{prefix},{rest}"
            except ValueError:
                fixed_line = f"DOMAIN-SUFFIX,{prefix},{rest}"
            return fixed_line, True
        elif corrected_prefix != prefix:
            return f"{corrected_prefix},{rest}", True
        else:
            return line.rstrip("\n"), False

def update_header(lines):
    """更新第二行（更新时间）和第三行（规则数量）"""
    rule_count = sum(1 for l in lines if l.strip() and not l.strip().startswith("#"))
    now = datetime.now().strftime("%Y-%m-%d")
    first_line = lines[0] if len(lines) >= 1 else "# 规则列表\n"
    second_line = f"# 更新时间: {now}\n"
    third_line = f"# 规则数量: {rule_count}\n"
    rest_lines = lines[3:] if len(lines) > 3 else []
    return [first_line, second_line, third_line] + rest_lines

def file_hash(lines):
    """计算文件内容 hash，用于判断是否修改"""
    m = hashlib.sha256()
    for line in lines:
        m.update(line.encode("utf-8"))
    return m.hexdigest()

def fix_list_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    fixed_lines = []
    changed = False

    for line in lines:
        fixed_line, line_changed = process_line(line)
        fixed_lines.append(fixed_line + "\n")
        if line_changed:
            changed = True

    # 计算修改前 hash
    old_hash = file_hash(lines)

    # 更新页首信息
    fixed_lines = update_header(fixed_lines)

    # 计算修改后 hash
    new_hash = file_hash(fixed_lines)

    # 仅在内容变化时写入文件
    if old_hash != new_hash:
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(fixed_lines)
        print(f"✅ 文件已更新: {path}")

def find_list_files(root_dir):
    list_files = []
    for dirpath, _, filenames in os.walk(root_dir):
        for file in filenames:
            if file.endswith(".list"):
                list_files.append(os.path.join(dirpath, file))
    return list_files

def main():
    list_files = find_list_files(".")
    if not list_files:
        return
    for file in list_files:
        fix_list_file(file)

if __name__ == "__main__":
    main()
