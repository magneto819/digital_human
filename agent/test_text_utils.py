import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from text_utils import strip_sensevoice_markers


def test_strip_sensevoice_markers_removes_prefix_tokens() -> None:
    assert (
        strip_sensevoice_markers("<|zh|><|NEUTRAL|><|Speech|><|withitn|>你好，是宝，听得见吗?")
        == "你好，是宝，听得见吗?"
    )


def test_strip_sensevoice_markers_keeps_normal_text() -> None:
    assert strip_sensevoice_markers("你好，我是势宝") == "你好，我是势宝"
