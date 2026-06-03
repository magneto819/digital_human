import re


SENSEVOICE_MARKER_PATTERN = re.compile(r"^(?:<\|[^|<>]+\|>\s*)+")


def strip_sensevoice_markers(text: str) -> str:
    return SENSEVOICE_MARKER_PATTERN.sub("", str(text or "")).strip()
