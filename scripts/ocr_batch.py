#!/usr/bin/env python
"""批量 OCR 脚本 - 使用 RapidOCR 提取超时空辉夜姬设定集全部文字"""
from pathlib import Path
from rapidocr_onnxruntime import RapidOCR

INPUT_DIR = Path(r"C:\Users\Administrator\Desktop\png_output")
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
COMBINED_FILE = OUTPUT_DIR / "_all_text.txt"


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("加载 OCR 模型...")
    ocr = RapidOCR()
    print("模型加载完成\n")

    image_files = sorted(INPUT_DIR.glob("*.png"))
    total = len(image_files)
    print(f"共找到 {total} 张图片\n")

    all_lines = []
    failed = []

    for idx, img_path in enumerate(image_files, 1):
        fname = img_path.name
        print(f"[{idx}/{total}] {fname} ...", end=" ", flush=True)

        try:
            result, _ = ocr(str(img_path))
            texts = _extract_text(result)
            print(f"OK ({len(texts)} 条)")

            # 写入单文件
            txt_path = OUTPUT_DIR / f"{img_path.stem}.txt"
            txt_path.write_text("\n".join(texts), encoding="utf-8")

            # 追加到汇总
            all_lines.append(f"=== {fname} ===")
            all_lines.extend(texts)
            all_lines.append("")

        except Exception as e:
            print(f"FAIL: {e}")
            failed.append(fname)

    # 写入汇总文件
    all_lines.append(f"总计: 成功 {total - len(failed)}, 失败 {len(failed)}")
    COMBINED_FILE.write_text("\n".join(all_lines), encoding="utf-8")
    print(f"\n完成！汇总文件: {COMBINED_FILE}")
    print(f"成功: {total - len(failed)}/{total}, 失败: {len(failed)}")
    if failed:
        print(f"失败文件: {failed}")


def _extract_text(ocr_result):
    if not ocr_result:
        return []
    lines = []
    for item in ocr_result:
        if item is None:
            continue
        text = item[1].strip() if len(item) >= 2 else ""
        if text:
            lines.append(text)
    return lines


if __name__ == "__main__":
    main()
