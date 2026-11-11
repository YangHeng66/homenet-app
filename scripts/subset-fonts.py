"""把 Google Fonts 的拉丁子集 woff2 再裁到界面实际用到的字符。

用法: python scripts/subset-fonts.py <源字体目录>
源目录里要有 bricolage-latin.woff2 和 geistmono-latin.woff2，输出到 src/fonts/。
中文走系统字体，这里只保留 ASCII 和界面里出现的几个符号。
"""
import sys
from pathlib import Path

from fontTools import subset

UNICODES = "U+0020-007E,U+00B0,U+00B7,U+00D7,U+2026,U+2190-2193,U+21BA,U+2212"
FONTS = {
    "bricolage-latin.woff2": "bricolage.woff2",
    "geistmono-latin.woff2": "geistmono.woff2",
}


def main() -> None:
    src = Path(sys.argv[1])
    out = Path(__file__).resolve().parent.parent / "src" / "fonts"
    out.mkdir(parents=True, exist_ok=True)
    for name, dest in FONTS.items():
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["kern", "liga", "calt", "tnum", "case"]
        opts.name_IDs = [1, 2]
        opts.notdef_outline = True
        opts.hinting = False
        font = subset.load_font(str(src / name), opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=subset.parse_unicodes(UNICODES))
        sub.subset(font)
        subset.save_font(font, str(out / dest), opts)
        print(dest, (out / dest).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
