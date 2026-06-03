import re


SENSEVOICE_MARKER_PATTERN = re.compile(r"^(?:<\|[^|<>]+\|>\s*)+")
STAGE_DIRECTION_PATTERN = re.compile(r"\s*(?:（[^（）]{1,40}）|\([^()]{1,40}\))\s*")


def strip_sensevoice_markers(text: str) -> str:
    return SENSEVOICE_MARKER_PATTERN.sub("", str(text or "")).strip()


def strip_stage_directions(text: str) -> str:
    return STAGE_DIRECTION_PATTERN.sub("", str(text or "")).strip()
