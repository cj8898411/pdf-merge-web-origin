import os
import subprocess
import sys
import socket
import tkinter as tk
import webbrowser
from tkinter import messagebox
from collections import deque
import shutil

def _relaunch_with_pythonw():
    if os.name != "nt":
        return
    exe = os.path.basename(sys.executable).lower()
    if exe == "pythonw.exe":
        return
    pythonw = None
    if exe == "python.exe":
        cand = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        if os.path.exists(cand):
            pythonw = cand
    if not pythonw:
        pythonw = shutil.which("pythonw")
    if not pythonw:
        return
    try:
        creationflags = 0x08000000 | 0x00000008
        subprocess.Popen(
            [pythonw, os.path.abspath(__file__), *sys.argv[1:]],
            cwd=os.getcwd(),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        sys.exit(0)
    except Exception:
        pass

def _hide_console_window():
    if os.name != "nt":
        return
    try:
        import ctypes
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        pass

def _find_project_root(start_dir):
    cur = start_dir
    for _ in range(8):
        if os.path.exists(os.path.join(cur, "server", "app.py")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return start_dir


def _find_python_cmd(root):
    # Allow override via env var (absolute or relative to project root)
    override = os.environ.get("SERVER_PYTHON")
    if override:
        cand = override if os.path.isabs(override) else os.path.join(root, override)
        if os.path.exists(cand):
            base = os.path.basename(cand).lower()
            if os.name == "nt":
                if base == "py.exe":
                    cand = None
                elif base == "python.exe":
                    pyw = os.path.join(os.path.dirname(cand), "pythonw.exe")
                    if os.path.exists(pyw):
                        return pyw
            if cand:
                return cand

    if os.name == "nt":
        # Windows: only use Windows executables
        win_pyw = os.path.join(root, ".venv", "Scripts", "pythonw.exe")
        win_py = os.path.join(root, ".venv", "Scripts", "python.exe")
        if os.path.exists(win_pyw):
            return win_pyw
        if os.path.exists(win_py):
            return win_py
        # Try PATH pythonw first
        path_pyw = shutil.which("pythonw")
        if path_pyw:
            return path_pyw
        path_py = shutil.which("python")
        if path_py and os.path.basename(path_py).lower() != "py.exe":
            return path_py
    else:
        # Linux/WSL: use venv python
        nix_py = os.path.join(root, ".venv", "bin", "python")
        if os.path.exists(nix_py):
            return nix_py

    # Fallback to current interpreter, but avoid py.exe launcher
    exe = sys.executable
    if exe and os.path.exists(exe):
        base = os.path.basename(exe).lower()
        if os.name == "nt":
            if base == "py.exe":
                pyw = os.path.join(os.path.dirname(exe), "pyw.exe")
                exe = pyw if os.path.exists(pyw) else None
            else:
                # Prefer pythonw.exe when available to avoid console windows
                if base == "python.exe":
                    cand = os.path.join(os.path.dirname(exe), "pythonw.exe")
                    if os.path.exists(cand):
                        exe = cand
        if exe:
            return exe

    return None


_relaunch_with_pythonw()
_hide_console_window()

ROOT = _find_project_root(os.path.dirname(os.path.abspath(__file__)))
SERVER_APP = os.path.join(ROOT, "server", "app.py")
LOG_DIR = os.path.join(ROOT, "logs")
LOG_FILE = os.path.join(LOG_DIR, "server.log")
PID_FILE = os.path.join(LOG_DIR, "server.pid")
CMD_FILE = os.path.join(LOG_DIR, "server.cmdline.txt")
SERVER_URL = os.environ.get("SERVER_URL", "http://127.0.0.1:3100")

proc = None
log_handle = None
log_file_handle = None
log_buffer = None
log_following = False
log_text = None
log_status_label = None


def _ensure_log_dir():
    os.makedirs(LOG_DIR, exist_ok=True)


def _write_pid(pid):
    try:
        with open(PID_FILE, "w", encoding="utf-8") as f:
            f.write(str(pid))
    except OSError:
        pass


def _write_cmdline(cmd):
    try:
        with open(CMD_FILE, "w", encoding="utf-8") as f:
            f.write(cmd)
    except OSError:
        pass


def _read_pid():
    try:
        with open(PID_FILE, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def _clear_pid():
    try:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        if os.path.exists(CMD_FILE):
            os.remove(CMD_FILE)
    except OSError:
        pass


def _kill_pid(pid):
    if not pid:
        return False
    if os.name == "nt":
        # taskkill is the most reliable way on Windows
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            return True
        except OSError:
            return False
    try:
        os.kill(pid, 15)
        return True
    except OSError:
        return False


def _is_port_listening(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            return s.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return False


def _find_listening_pid(port):
    if os.name != "nt":
        return None
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return None
        for line in result.stdout.splitlines():
            if f":{port} " not in line:
                continue
            if "LISTENING" not in line.upper():
                continue
            parts = [p for p in line.split() if p]
            if len(parts) < 5:
                continue
            pid = parts[-1]
            if pid.isdigit():
                return int(pid)
    except OSError:
        return None
    return None


def _get_cmdline_for_pid(pid):
    if os.name != "nt" or not pid:
        return None
    try:
        result = subprocess.run(
            [
                "wmic",
                "process",
                "where",
                f"ProcessId={pid}",
                "get",
                "CommandLine",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return None
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if len(lines) >= 2:
            return lines[1]
    except OSError:
        return None
    return None


def _stop_port_process(port):
    pid = _find_listening_pid(port)
    if pid:
        _kill_pid(pid)
        return pid
    return None


def _find_server_pids():
    if os.name != "nt":
        return []
    try:
        result = subprocess.run(
            [
                "wmic",
                "process",
                "where",
                "CommandLine like '%\\\\server\\\\app.py%'",
                "get",
                "ProcessId",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return []
        pids = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line or line.lower() == "processid":
                continue
            if line.isdigit():
                pids.append(int(line))
        return pids
    except OSError:
        return []


def _kill_server_processes():
    pids = _find_server_pids()
    killed = False
    for pid in pids:
        killed = _kill_pid(pid) or killed
    if killed:
        _clear_pid()
    return killed


def _open_log():
    if not os.path.exists(LOG_FILE):
        return ""
    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _update_status():
    if proc and proc.poll() is None:
        status_var.set("Status: Running")
    else:
        status_var.set("Status: Stopped")


def start_server():
    global proc, log_handle, log_following
    if proc and proc.poll() is None:
        messagebox.showinfo("Server", "이미 실행 중입니다.")
        return
    existing_pid = _read_pid()
    if existing_pid:
        _kill_pid(existing_pid)
        _clear_pid()
    else:
        _kill_server_processes()
        stopped_pid = _stop_port_process(3100)
        if stopped_pid:
            _clear_pid()

    if not os.path.exists(SERVER_APP):
        messagebox.showerror("Error", "server/app.py를 찾을 수 없습니다.")
        return

    python_cmd = _find_python_cmd(ROOT)
    if not python_cmd or not os.path.exists(python_cmd):
        messagebox.showerror(
            "Error",
            "python 실행 파일을 찾을 수 없습니다. "
            ".venv 경로를 확인하거나 SERVER_PYTHON 환경변수를 지정하세요."
        )
        return

    _ensure_log_dir()
    log_handle = open(LOG_FILE, "a", encoding="utf-8")

    CREATE_NO_WINDOW = 0x08000000
    DETACHED_PROCESS = 0x00000008
    STARTF_USESHOWWINDOW = 0x00000001
    SW_HIDE = 0
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = SW_HIDE
    proc = subprocess.Popen(
        [python_cmd, SERVER_APP],
        cwd=ROOT,
        stdout=log_handle,
        stderr=log_handle,
        creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS,
        startupinfo=startupinfo
    )
    _write_pid(proc.pid)
    _write_cmdline(" ".join([python_cmd, SERVER_APP]))
    _update_status()
    if not log_following:
        _load_log_initial()
        _follow_log()
    messagebox.showinfo("Server", "서버가 실행되었습니다.")


def stop_server():
    global proc, log_handle, log_file_handle, log_following
    if not proc or proc.poll() is not None:
        if _kill_server_processes():
            messagebox.showinfo("Server", "실행 중인 서버를 중지했습니다.")
            _update_status()
            return
        pid = _read_pid()
        if pid:
            _kill_pid(pid)
            _clear_pid()
            messagebox.showinfo("Server", "PID 파일로 서버를 중지했습니다.")
            _update_status()
            return
        messagebox.showinfo("Server", "실행 중인 서버가 없습니다.")
        _update_status()
        return

    proc.terminate()
    proc = None
    if log_handle:
        log_handle.close()
        log_handle = None
    if log_file_handle:
        log_file_handle.close()
        log_file_handle = None
    log_following = False
    _clear_pid()
    _update_status()
    messagebox.showinfo("Server", "서버를 중지했습니다.")


def restart_server():
    stop_server()
    start_server()


def view_log():
    if log_text:
        log_text.see(tk.END)


def open_site():
    webbrowser.open(SERVER_URL)


def _init_log_ui(parent):
    global log_text, log_status_label, log_buffer
    log_frame = tk.Frame(parent)
    log_frame.pack(fill="both", expand=True, padx=8, pady=(6, 8))

    text = tk.Text(log_frame, wrap="none")
    y_scroll = tk.Scrollbar(log_frame, orient="vertical", command=text.yview)
    x_scroll = tk.Scrollbar(log_frame, orient="horizontal", command=text.xview)
    text.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

    text.grid(row=0, column=0, sticky="nsew")
    y_scroll.grid(row=0, column=1, sticky="ns")
    x_scroll.grid(row=1, column=0, sticky="ew")
    log_frame.rowconfigure(0, weight=1)
    log_frame.columnconfigure(0, weight=1)

    controls = tk.Frame(parent)
    controls.pack(fill="x")
    status = tk.Label(controls, text="Following log...", anchor="w")
    status.pack(side="left", padx=8, pady=6)
    live_status = tk.Label(controls, textvariable=status_var, anchor="e")
    live_status.pack(side="right", padx=8, pady=6)

    log_text = text
    log_status_label = status
    log_buffer = deque(maxlen=500)


def _load_log_initial():
    if not log_text or not log_status_label:
        return
    if not os.path.exists(LOG_FILE):
        log_status_label.config(text=f"Log file not found: {LOG_FILE}")
        return
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            log_buffer.extend(f.read().splitlines())
    except OSError:
        log_status_label.config(text="Log file open error.")
        return
    log_text.delete("1.0", tk.END)
    if log_buffer:
        log_text.insert(tk.END, "\n".join(log_buffer) + "\n")
        log_text.see(tk.END)


def _follow_log():
    global log_file_handle, log_following
    if not log_text or not log_status_label:
        log_following = False
        return
    log_following = True
    if not os.path.exists(LOG_FILE):
        log_status_label.config(text=f"Log file not found: {LOG_FILE}")
        root.after(500, _follow_log)
        return
    if log_file_handle is None:
        try:
            log_file_handle = open(LOG_FILE, "r", encoding="utf-8", errors="replace")
            log_file_handle.seek(0, os.SEEK_END)
        except OSError:
            log_status_label.config(text="Log file open error.")
            root.after(500, _follow_log)
            return
    chunk = log_file_handle.read()
    if chunk:
        lines = chunk.splitlines()
        log_buffer.extend(lines)
        log_text.insert(tk.END, "\n".join(lines) + ("\n" if chunk.endswith("\n") else ""))
        total_lines = int(log_text.index("end-1c").split(".")[0])
        if total_lines > log_buffer.maxlen:
            delete_to = total_lines - log_buffer.maxlen
            log_text.delete("1.0", f"{delete_to + 1}.0")
        log_text.see(tk.END)
    root.after(500, _follow_log)


root = tk.Tk()
root.title("Server Manager")
root.geometry("640x520")

status_var = tk.StringVar(value="Status: Stopped")

lbl = tk.Label(root, textvariable=status_var)
lbl.pack(pady=8)

tk.Button(root, text="Start Server", width=22, command=start_server).pack(pady=6)
tk.Button(root, text="Stop Server", width=22, command=stop_server).pack(pady=4)
tk.Button(root, text="Restart Server", width=22, command=restart_server).pack(pady=4)
tk.Button(root, text="View Log", width=22, command=view_log).pack(pady=4)
tk.Button(root, text="Open Site", width=22, command=open_site).pack(pady=4)
def _on_close():
    if proc and proc.poll() is None:
        stop_server()
    root.destroy()

tk.Button(root, text="Exit", width=22, command=_on_close).pack(pady=6)
root.protocol("WM_DELETE_WINDOW", _on_close)

_init_log_ui(root)
_load_log_initial()
_follow_log()

_update_status()
root.mainloop()
