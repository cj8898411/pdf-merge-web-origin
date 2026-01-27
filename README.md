# PDF Merge Web (Python)

업무용 PDF 병합 웹 앱 (Python 서버 포함).

## 실행
```bash
python -m venv .venv
. .venv/Scripts/activate  # PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python server/app.py
```

브라우저에서 http://localhost:3000 접속.

## 기능
- 다중 PDF 업로드
- 수입신고번호 자동 분류(하이픈 형식)
- 접두어 기반 기본 병합 순서 설정
- 선택 폴더 병합 다운로드
- 전체 일괄 병합 ZIP 다운로드
