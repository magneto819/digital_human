import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from text_utils import strip_sensevoice_markers, strip_stage_directions


def test_strip_sensevoice_markers_removes_prefix_tokens() -> None:
    assert (
        strip_sensevoice_markers("<|zh|><|NEUTRAL|><|Speech|><|withitn|>你好，是宝，听得见吗?")
        == "你好，是宝，听得见吗?"
    )


def test_strip_sensevoice_markers_keeps_normal_text() -> None:
    assert strip_sensevoice_markers("你好，我是势宝") == "你好，我是势宝"


def test_strip_stage_directions_removes_parenthesized_actions() -> None:
    assert (
        strip_stage_directions("（挺直身子）我目前的响应延迟在8毫秒至1.3秒之间。")
        == "我目前的响应延迟在8毫秒至1.3秒之间。"
    )


def test_strip_stage_directions_removes_ascii_parenthesized_actions() -> None:
    assert strip_stage_directions("(微笑)听见啦，我是势宝。") == "听见啦，我是势宝。"
