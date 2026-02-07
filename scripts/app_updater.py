import argparse
import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path


def _find_extract_root(extracted: Path) -> Path:
    entries = [p for p in extracted.iterdir() if p.name not in (".DS_Store",)]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return extracted


def _copy_tree(src: Path, dest: Path, preserve: set[str]) -> None:
    for root, dirs, files in os.walk(src):
        root_path = Path(root)
        rel = root_path.relative_to(src)
        if rel.parts and rel.parts[0] in preserve:
            dirs[:] = []
            continue
        target_root = dest / rel
        target_root.mkdir(parents=True, exist_ok=True)
        for fname in files:
            rel_file = rel / fname
            if rel_file.parts and rel_file.parts[0] in preserve:
                continue
            if rel_file.name in preserve:
                continue
            src_file = root_path / fname
            dst_file = target_root / fname
            try:
                shutil.copy2(src_file, dst_file)
            except PermissionError:
                # Retry once after a short delay
                time.sleep(0.5)
                shutil.copy2(src_file, dst_file)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", help="App root directory")
    parser.add_argument("zip_path", help="Update zip path")
    parser.add_argument("pid", nargs="?", default=None, help="Optional parent pid")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    zip_path = Path(args.zip_path).resolve()
    if not zip_path.exists():
        return 1

    # Give the parent process time to exit
    time.sleep(1.5)

    preserve = {
        ".git",
        ".venv",
        "venv",
        "uploads",
        "merged",
        "logs",
        "wheels",
        "settings.json",
        "update.zip",
    }

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_path)
        src_root = _find_extract_root(tmp_path)
        _copy_tree(src_root, root, preserve)

    # Relaunch app
    try:
        if os.name == "nt":
            creationflags = 0x08000000 | 0x00000008
            subprocess = __import__("subprocess")
            subprocess.Popen(
                [sys.executable, str(root / "server" / "app.py")],
                cwd=str(root),
                creationflags=creationflags,
            )
        else:
            subprocess = __import__("subprocess")
            subprocess.Popen(
                [sys.executable, str(root / "server" / "app.py")],
                cwd=str(root),
                start_new_session=True,
            )
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
