from flask import Flask, request, send_file, jsonify
from io import BytesIO
from pypdf import PdfReader, PdfWriter
from zipfile import ZipFile, ZIP_DEFLATED
import json
import re

app = Flask(__name__, static_folder="../public", static_url_path="")


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.post("/merge")
def merge_pdfs():
    files = request.files.getlist("files")

    if len(files) < 2:
        return jsonify({"error": "PDF 파일을 2개 이상 선택해주세요."}), 400

    writer = PdfWriter()

    try:
        for file in files:
            file.stream.seek(0)
            reader = PdfReader(file.stream)
            for page in reader.pages:
                writer.add_page(page)

        output = BytesIO()
        writer.write(output)
        output.seek(0)

        return send_file(
            output,
            mimetype="application/pdf",
            as_attachment=True,
            download_name="merged.pdf",
        )
    except Exception:
        return jsonify({"error": "병합 중 오류가 발생했습니다."}), 500


def _safe_filename(name: str) -> str:
    if not name:
        return "merged"
    cleaned = re.sub(r"[\\\\/:*?\"<>|]", "_", name)
    return cleaned.strip() or "merged"


@app.post("/merge-batch")
def merge_batch():
    files = request.files.getlist("files")
    manifest_raw = request.form.get("manifest", "")

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
    output = BytesIO()

    try:
        with ZipFile(output, "w", ZIP_DEFLATED) as zip_file:
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

                group_pdf = BytesIO()
                writer.write(group_pdf)
                group_pdf.seek(0)
                safe_name = _safe_filename(group_name)
                zip_file.writestr(f"{safe_name}.pdf", group_pdf.read())

        output.seek(0)
        return send_file(
            output,
            mimetype="application/zip",
            as_attachment=True,
            download_name="merged_batch.zip",
        )
    except Exception:
        return jsonify({"error": "일괄 병합 중 오류가 발생했습니다."}), 500


if __name__ == "__main__":
    # Use 0.0.0.0 for LAN testing, adjust as needed.
    app.run(host="0.0.0.0", port=3000, debug=False)
