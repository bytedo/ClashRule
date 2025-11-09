import os
import re

def check_ini_file(path):
    errors = []

    rule_sections = []
    group_sections = []

    current_section = None
    section_type = None  # 'rule' 或 'group'

    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # 跳过 [section] 块
        if stripped.startswith("[") and stripped.endswith("]"):
            continue

        # 标签识别
        if stripped == ";规则label":
            if section_type == "rule":
                rule_sections.append(current_section or [])
                current_section = None
                section_type = None
            else:
                section_type = "rule"
                current_section = []
            continue

        if stripped == ";分组label":
            if section_type == "group":
                group_sections.append(current_section or [])
                current_section = None
                section_type = None
            else:
                section_type = "group"
                current_section = []
            continue

        # 区块内提取名称
        if "=" not in stripped:
            continue  # 区块内格式错误可忽略或自行处理

        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()

        if section_type == "rule" and key == "ruleset":
            match = re.match(r'^([^,]+)', value)
            if match:
                current_section.append(match.group(1).strip())
        elif section_type == "group" and key == "custom_proxy_group":
            match = re.match(r'^([^`]+)', value)
            if match:
                current_section.append(match.group(1).strip())

    # 收尾
    if section_type == "rule":
        rule_sections.append(current_section or [])
    elif section_type == "group":
        group_sections.append(current_section or [])

    # 校验区块匹配
    for idx, rule_block in enumerate(rule_sections):
        if idx >= len(group_sections):
            errors.append(f"⚠️ 第 {idx+1} 个规则区块未找到对应分组区块")
            break
        group_block = group_sections[idx]
        for rule in rule_block:
            if rule not in group_block:
                errors.append(f"⚠️ 第 {idx+1} 个标签区块: ruleset '{rule}' 未在对应分组中定义")

    return errors

def main():
    ini_files = [f for f in os.listdir('.') if f.endswith('.ini')]
    if not ini_files:
        print("未找到任何 .ini 文件。")
        return

    for file in ini_files:
        print(f"\n🔍 正在检查文件: {file}")
        errors = check_ini_file(file)

        if not errors:
            print("✅ 未发现问题。")
        else:
            print("\n❌ 错误:")
            for e in errors:
                print("   ", e)

if __name__ == "__main__":
    main()
