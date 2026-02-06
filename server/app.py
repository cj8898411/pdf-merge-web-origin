from flask import Flask, request, send_file, jsonify, after_this_request
from pypdf import PdfReader, PdfWriter
from zipfile import ZipFile, ZIP_DEFLATED
from datetime import datetime
from pathlib import Path
import json
import re
import tempfile

app = Flask(__name__, static_folder="../public", static_url_path="")
app.config["MAX_FORM_MEMORY_SIZE"] = 4 * 1024 * 1024

ROOT_DIR = Path(__file__).resolve().parents[1]
UPLOAD_DIR = ROOT_DIR / "uploads"
MERGED_DIR = ROOT_DIR / "merged"
SETTINGS_FILE = ROOT_DIR / "settings.json"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MERGED_DIR.mkdir(parents=True, exist_ok=True)

CUSTOMS_WITH_HYPHEN = re.compile(r"(\d{5})-(\d{2})-(\d{6})M(?!\d)", re.I)
CUSTOMS_PLAIN = re.compile(r"(\d{13})M(?!\d)", re.I)
BL_PREFIX = re.compile(r"(?:^|[ _-])BL[ _-]?([A-Z0-9]{6,20})(?=$|[ _-])", re.I)
FEE_SECTION_START = re.compile(r"통\s*관\s*수\s*수\s*료|통관수수료")
FEE_SECTION_END = re.compile(r"예\s*상\s*비\s*용|예상비용")
IMPORTER_LINE = re.compile(r"(.+?)\s*귀하")

DEFAULT_SETTINGS = {
    "prefixOrder": [
        {"prefix": "JS", "documentName": "정산서"},
        {"prefix": "NB", "documentName": "납부영수증"},
        {"prefix": "VT", "documentName": "수입세금계산서"},
        {"prefix": "IMP", "documentName": "수입신고필증"},
    ],
    "customsOnlyFirst": True,
    "completedGroups": {},
}


@app.route("/")
def index():
    return app.send_static_file("index.html")


def _load_settings() -> dict:
    if not SETTINGS_FILE.exists():
        return dict(DEFAULT_SETTINGS)
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_SETTINGS)
    settings = dict(DEFAULT_SETTINGS)
    if isinstance(data, dict):
        if isinstance(data.get("prefixOrder"), list):
            settings["prefixOrder"] = data["prefixOrder"]
        if isinstance(data.get("customsOnlyFirst"), bool):
            settings["customsOnlyFirst"] = data["customsOnlyFirst"]
        if isinstance(data.get("completedGroups"), dict):
            settings["completedGroups"] = data["completedGroups"]
    return settings


def _save_settings(settings: dict) -> None:
    tmp_path = SETTINGS_FILE.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(settings, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(SETTINGS_FILE)


@app.get("/settings")
def get_settings():
    return jsonify(_load_settings())


@app.post("/settings")
def update_settings():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "요청 형식이 올바르지 않습니다."}), 400
    settings = _load_settings()
    if isinstance(data.get("prefixOrder"), list):
        settings["prefixOrder"] = data["prefixOrder"]
    if isinstance(data.get("customsOnlyFirst"), bool):
        settings["customsOnlyFirst"] = data["customsOnlyFirst"]
    if isinstance(data.get("completedGroups"), dict):
        settings["completedGroups"] = data["completedGroups"]
    _save_settings(settings)
    return jsonify(settings)


@app.get("/uploads")
def list_uploads():
    candidates = [
        path
        for path in UPLOAD_DIR.iterdir()
        if path.is_file() and path.suffix.lower() == ".pdf"
    ]
    uploads = [path.name for path in sorted(candidates, key=lambda p: p.stat().st_mtime)]
    return jsonify({"uploads": uploads})


@app.post("/upload")
def upload_files():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "PDF 파일을 선택해주세요."}), 400
    saved = []
    for file in files:
        saved.append(_save_upload(file))
    return jsonify({"saved": saved})


@app.get("/uploads/<path:filename>")
def get_upload(filename):
    target = (UPLOAD_DIR / filename).resolve()
    if UPLOAD_DIR not in target.parents or not target.exists() or not target.is_file():
        return jsonify({"error": "파일을 찾을 수 없습니다."}), 404
    return send_file(target, mimetype="application/pdf")


@app.get("/pc-info/<path:filename>")
def get_pc_info(filename):
    target = (UPLOAD_DIR / filename).resolve()
    if UPLOAD_DIR not in target.parents or not target.exists() or not target.is_file():
        return jsonify({"error": "파일을 찾을 수 없습니다."}), 404
    try:
        info = _extract_pc_info(target)
    except Exception:
        return jsonify({"error": "PDF 정보를 읽지 못했습니다."}), 500
    return jsonify(info)


@app.get("/merged")
def list_merged():
    candidates = [
        path
        for path in MERGED_DIR.iterdir()
        if path.is_file() and path.suffix.lower() == ".pdf"
    ]
    merged = [path.name for path in sorted(candidates, key=lambda p: p.stat().st_mtime)]
    return jsonify({"merged": merged})


@app.get("/merged/<path:filename>")
def get_merged(filename):
    target = (MERGED_DIR / filename).resolve()
    if MERGED_DIR not in target.parents or not target.exists() or not target.is_file():
        return jsonify({"error": "파일을 찾을 수 없습니다."}), 404
    return send_file(target, mimetype="application/pdf")


@app.post("/merged/download")
def download_merged_selection():
    data = request.get_json(silent=True) or {}
    names = data.get("names", [])
    if not isinstance(names, list) or not names:
        return jsonify({"error": "다운로드할 파일이 없습니다."}), 400
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_path = Path(tmp.name)
    tmp.close()
    with ZipFile(tmp_path, "w", ZIP_DEFLATED) as zip_file:
        for name in names:
            target = (MERGED_DIR / name).resolve()
            if MERGED_DIR not in target.parents or not target.exists() or not target.is_file():
                continue
            zip_file.write(target, arcname=target.name)

    @after_this_request
    def cleanup(response):
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        return response

    return send_file(
        tmp_path,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"merged_search_{_timestamp()}.zip",
    )


@app.post("/uploads/clear")
def clear_uploads():
    removed = 0
    for path in UPLOAD_DIR.iterdir():
        if path.is_file() and path.suffix.lower() == ".pdf":
            path.unlink()
            removed += 1
    return jsonify({"removed": removed})


@app.post("/uploads/delete")
def delete_uploads():
    data = request.get_json(silent=True) or {}
    names = data.get("names", [])
    if not isinstance(names, list) or not names:
        return jsonify({"error": "삭제할 파일이 없습니다."}), 400
    removed = 0
    for name in names:
        target = (UPLOAD_DIR / name).resolve()
        if UPLOAD_DIR in target.parents and target.exists() and target.is_file():
            target.unlink()
            removed += 1
    return jsonify({"removed": removed})


@app.post("/merge")
def merge_pdfs():
    files = request.files.getlist("files")

    if len(files) < 2:
        return jsonify({"error": "PDF 파일을 2개 이상 선택해주세요."}), 400

    writer = PdfWriter()
    group_customs = None
    customs_mismatch = False
    group_bl = None
    bl_mismatch = False
    timestamp = _timestamp()

    try:
        for file in files:
            customs = _extract_customs(file.filename or "")
            bl = _extract_bl(file.filename or "")
            if customs:
                if group_customs is None:
                    group_customs = customs
                elif customs != group_customs:
                    customs_mismatch = True
            if bl:
                if group_bl is None:
                    group_bl = bl
                elif bl != group_bl:
                    bl_mismatch = True
            file.stream.seek(0)
            reader = PdfReader(file.stream)
            for page in reader.pages:
                writer.add_page(page)

        merged_customs = "미분류" if customs_mismatch or not group_customs else group_customs
        merged_bl = "미확인" if bl_mismatch or not group_bl else group_bl
        target = _save_merged_writer(writer, merged_customs, merged_bl, timestamp)
        download_name = target.name

        return send_file(
            target,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=download_name,
        )
    except Exception:
        return jsonify({"error": "병합 중 오류가 발생했습니다."}), 500


def _safe_filename(name: str) -> str:
    if not name:
        return "merged"
    cleaned = re.sub(r"[\\\\/:*?\"<>|]", "_", name)
    return cleaned.strip() or "merged"

def _timestamp() -> str:
    return datetime.now().strftime("%y%m%d_%H%M%S")

def _normalize_customs(digits: str) -> str:
    return f"{digits[:5]}-{digits[5:7]}-{digits[7:13]}M"

def _extract_customs(name: str) -> str | None:
    match_hyphen = CUSTOMS_WITH_HYPHEN.search(name)
    if match_hyphen:
        return f"{match_hyphen[1]}-{match_hyphen[2]}-{match_hyphen[3]}M"
    match_plain = CUSTOMS_PLAIN.search(name)
    if match_plain:
        return _normalize_customs(match_plain[1])
    return None

def _extract_bl(name: str) -> str | None:
    trimmed = re.sub(r"\.[^.]+$", "", name)
    match = BL_PREFIX.search(trimmed)
    if match:
        return match.group(1).upper()
    cleaned = CUSTOMS_WITH_HYPHEN.sub("", trimmed)
    cleaned = CUSTOMS_PLAIN.sub("", cleaned)
    tokens = [token for token in re.split(r"[ _-]+", cleaned) if token]
    alnum = [
        token
        for token in tokens
        if 6 <= len(token) <= 20
        and re.search(r"[A-Z]", token, re.I)
        and re.search(r"\d", token)
    ]
    if alnum:
        alnum.sort(key=len, reverse=True)
        return alnum[0].upper()
    numeric = [token for token in tokens if re.fullmatch(r"\d{6,20}", token)]
    if numeric:
        numeric.sort(key=len, reverse=True)
        return numeric[0]
    return None

def _build_merged_name(customs: str, bl: str, timestamp: str) -> str:
    safe_customs = _safe_filename(customs).replace("-", "_")
    return f"{safe_customs}_{timestamp}.pdf"

def _save_upload(file_storage) -> str:
    original = Path(file_storage.filename or "upload.pdf").name
    target = UPLOAD_DIR / original
    if target.exists():
        stem = target.stem
        suffix = target.suffix
        counter = 1
        while True:
            candidate = UPLOAD_DIR / f"{stem} ({counter}){suffix}"
            if not candidate.exists():
                target = candidate
                break
            counter += 1
    file_storage.save(target)
    return target.name

def _save_merged_writer(writer: PdfWriter, customs: str, bl: str, timestamp: str) -> Path:
    filename = _build_merged_name(customs, bl, timestamp)
    target = MERGED_DIR / filename
    with target.open("wb") as f:
        writer.write(f)
    return target

def _resolve_group_bl(ids, id_map) -> str:
    bl_values = []
    for file_id in ids:
        file = id_map.get(file_id)
        if not file:
            continue
        bl = _extract_bl(file.filename or "")
        if bl:
            bl_values.append(bl)
    unique = set(bl_values)
    if len(unique) == 1:
        return list(unique)[0]
    return "미확인"

def _normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()

def _normalize_fee_name(name: str) -> str:
    if not name:
        return name
    name = re.sub(r"\s+", " ", name).strip()
    # Collapse spaces between Hangul syllables: "검 역 료" -> "검역료"
    name = re.sub(r"(?<=[가-힣])\s+(?=[가-힣])", "", name)
    return name

def _extract_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    parts = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)

def _extract_importer(lines: list[str]) -> str | None:
    for line in lines:
        match = IMPORTER_LINE.search(line)
        if match:
            return match.group(1).strip()
    return None

def _extract_fee_items(lines: list[str]) -> list[dict]:
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if start_idx is None and FEE_SECTION_START.search(line):
            start_idx = i + 1
            continue
        if start_idx is not None and FEE_SECTION_END.search(line):
            end_idx = i
            break
    if start_idx is None:
        return []
    if end_idx is None:
        end_idx = len(lines)

    items = []
    for raw in lines[start_idx:end_idx]:
        line = _normalize_line(raw)
        if not line:
            continue
        if re.search(r"미\s*수\s*금", line):
            continue
        match = re.match(r"(.+?)\s+([0-9,]+)(.*)$", line)
        if match:
            name = _normalize_fee_name(match.group(1))
            amount = match.group(2).strip()
            vendor = match.group(3).strip()
            items.append({"name": name, "amount": amount, "vendor": vendor})
        else:
            items.append({"raw": line})
    return items

def _extract_pc_info(path: Path) -> dict:
    text = _extract_pdf_text(path)
    lines = []
    for raw in text.splitlines():
        cleaned = _normalize_line(raw)
        if cleaned:
            lines.append(cleaned)
    return {
        "importer": _extract_importer(lines),
        "fees": _extract_fee_items(lines),
    }


@app.post("/merge-batch")
def merge_batch():
    files = request.files.getlist("files")
    manifest_raw = request.form.get("manifest", "")
    batch_timestamp = _timestamp()

    if not files:
        return jsonify({"error": "PDF 파일을 선택해주세요."}), 400

    try:
        manifest = json.loads(manifest_raw) if manifest_raw else {}
    except json.JSONDecodeError:
        return jsonify({"error": "요청 형식이 올바르지 않습니다."}), 400

    file_ids = manifest.get("fileIds", [])
    groups = manifest.get("groups", [])
    if not file_ids or len(file_ids) != len(files) or not groups:
        return jsonify({"error": "요청 데이터가 부족합니다."}), 400

    id_map = {file_ids[i]: files[i] for i in range(len(files))}
    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_path = Path(tmp.name)
        tmp.close()
        with ZipFile(tmp_path, "w", ZIP_DEFLATED) as zip_file:
            for group in groups:
                group_name = group.get("name", "merged")
                ids = group.get("fileIds", [])
                if not ids:
                    continue

                writer = PdfWriter()
                for file_id in ids:
                    file = id_map.get(file_id)
                    if not file:
                        continue
                    file.stream.seek(0)
                    reader = PdfReader(file.stream)
                    for page in reader.pages:
                        writer.add_page(page)

                group_bl = _resolve_group_bl(ids, id_map)
                timestamp = _timestamp()
                target = _save_merged_writer(writer, group_name, group_bl, timestamp)
                zip_file.write(target, arcname=target.name)

        @after_this_request
        def cleanup(response):
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            return response

        return send_file(
            tmp_path,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"{batch_timestamp}.zip",
        )
    except Exception:
        return jsonify({"error": "일괄 병합 중 오류가 발생했습니다."}), 500


if __name__ == "__main__":
    # Use 0.0.0.0 for LAN testing, adjust as needed.
    app.run(host="0.0.0.0", port=3100, debug=False)
