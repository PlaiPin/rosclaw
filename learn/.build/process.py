#!/usr/bin/env python3
"""把 learn/*.md 里的 ```dot 代码块渲染成 PNG 并替换为图片引用，
然后按两篇拼接成合并 markdown，供 pandoc 转 docx。"""
import os, re, subprocess, sys

LEARN = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILD = os.path.join(LEARN, ".build")
IMG = os.path.join(BUILD, "img")
os.makedirs(IMG, exist_ok=True)

DOT_RE = re.compile(r"```dot\n(.*?)\n```", re.DOTALL)

def process_md(src_path, key):
    """读取单个 md，渲染其中的 dot 图，返回处理后的文本。"""
    with open(src_path, encoding="utf-8") as f:
        text = f.read()
    counter = [0]
    def repl(m):
        counter[0] += 1
        dot_src = m.group(1)
        name = f"{key}-{counter[0]}.png"
        out = os.path.join(IMG, name)
        # 渲染（dpi 提高清晰度）
        subprocess.run(["dot", "-Tpng", "-Gdpi=150", "-o", out],
                       input=dot_src.encode("utf-8"), check=True)
        # 图片引用，pandoc 转 docx 时会内嵌
        return f"![]({os.path.join('img', name)})"
    new_text, n = DOT_RE.subn(repl, text)
    if n:
        print(f"  {os.path.basename(src_path)}: 渲染 {n} 张图")
    return new_text

def build_doc(out_name, title, files):
    parts = [f"# {title}\n"]
    for f in files:
        key = os.path.splitext(os.path.basename(f))[0]
        # 用文件名生成稳定 key（去掉非字母数字）
        key = re.sub(r"[^0-9A-Za-z]", "", key) or "x"
        parts.append(process_md(os.path.join(LEARN, f), key))
        parts.append("\n\n---\n\n")  # 章节分隔
    out = os.path.join(BUILD, out_name)
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    print(f"已生成 {out_name}")
    return out

# 第一篇：教程
tutorial_files = ["README.md", "01-项目概览.md", "02-技术前置知识.md",
                  "03-架构深度解析.md", "04-核心代码导读.md", "05-完整实战教程.md"]

# 第二篇：代码导读（code 目录，README + 00..32 数字顺序）
code_dir = os.path.join(LEARN, "code")
code_md = [f for f in os.listdir(code_dir) if f.endswith(".md")]
def code_sort_key(fn):
    if fn == "README.md":
        return (-1, "")
    m = re.match(r"(\d+)", fn)
    return (int(m.group(1)) if m else 999, fn)
code_files = ["code/" + f for f in sorted(code_md, key=code_sort_key)]

print("== 教程篇 ==")
build_doc("RosClaw-学习教程.md", "RosClaw 学习教程", tutorial_files)
print("== 代码导读篇 ==")
build_doc("RosClaw-核心代码导读.md", "RosClaw 核心代码导读", code_files)
print("\n代码篇文件顺序：")
for f in code_files:
    print("  ", f)
