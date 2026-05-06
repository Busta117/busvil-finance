#!/usr/bin/env python3
"""Servidor local para el dashboard BustasFinance.

Endpoints:
  GET  /                              -> sirve archivos estáticos
  GET  /data/list                     -> JSON con los datasets disponibles
  POST /data/<filename>.json          -> sobrescribe (autosave de categorías)
  POST /data/upload                   -> multipart con un XLS: lo procesa
                                         con build_transactions.build() y
                                         escribe el JSON correspondiente
  POST /transactions.json             -> legacy, redirige al primer dataset
                                         de data/ si existe
"""

import json
import re
import shutil
import sys
from email.parser import BytesParser
from email.policy import default as email_default_policy
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
DATA_DIR = SCRIPT_DIR / "data"
PORT = 8000


def list_datasets():
    if not DATA_DIR.exists():
        return []
    files = sorted(DATA_DIR.glob("*.json"))
    out = []
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                d = json.load(fh)
            tx = d.get("transactions", [])
            first = min((t["d"] for t in tx), default="")
            last = max((t["d"] for t in tx), default="")
            acct = d.get("account") or {}
            out.append({
                "name": f.name,
                "count": len(tx),
                "from": first,
                "to": last,
                "alias": acct.get("alias", ""),
                "bank": acct.get("bank", ""),
                "iban": acct.get("iban", ""),
                "kind": acct.get("kind", "account"),
                "last4": acct.get("last4", ""),
                "card_type": acct.get("card_type", ""),
                "holder": acct.get("holder", ""),
                "size": f.stat().st_size,
                "mtime": f.stat().st_mtime,
            })
        except Exception as e:
            out.append({"name": f.name, "error": str(e)})
    return out


def parse_multipart(content_type, body):
    """Parsea multipart/form-data. Devuelve dict {field_name: value}.
    Los campos de archivo se devuelven como {"_filename": str, "_bytes": bytes},
    los texto como str.
    """
    header_blob = (f"Content-Type: {content_type}\r\n\r\n").encode("utf-8")
    msg = BytesParser(policy=email_default_policy).parsebytes(header_blob + body)
    if not msg.is_multipart():
        return {}
    out = {}
    for part in msg.iter_parts():
        cd = part.get("Content-Disposition", "")
        if not cd:
            continue
        m = re.search(r'name="([^"]*)"', cd)
        if not m:
            continue
        name = m.group(1)
        fn = re.search(r'filename="([^"]*)"', cd)
        if fn:
            out[name] = {"_filename": fn.group(1), "_bytes": part.get_payload(decode=True) or b""}
        else:
            payload = part.get_payload(decode=True) or b""
            out[name] = payload.decode("utf-8", "replace") if isinstance(payload, (bytes, bytearray)) else str(payload)
    return out


def parse_multipart_file(content_type, body, field_name="file"):
    """Compat: devuelve (filename, bytes) del primer field_name."""
    fields = parse_multipart(content_type, body)
    f = fields.get(field_name)
    if not isinstance(f, dict):
        return None, None
    return f.get("_filename", "upload.bin"), f.get("_bytes")


def dispatch_parser(xls_path, last4=None):
    """Intenta cada parser disponible en orden. Devuelve (payload, out_path)
    o lanza RuntimeError si ninguno reconoce el formato."""
    errors = []

    # 1) Tarjeta de crédito (requiere last4)
    try:
        import build_credit_card as bcc
        if bcc.is_credit_card_xls(xls_path):
            if not last4:
                raise RuntimeError("El archivo parece un extracto de tarjeta de crédito: "
                                   "falta el campo 'last4' (últimos 4 dígitos).")
            return bcc.build(xls_path, last4=last4, interactive=False)
    except RuntimeError:
        raise
    except Exception as e:
        errors.append(f"credit_card: {e}")

    # 2) Cuenta corriente CaixaBank (parser original)
    try:
        import build_transactions as bt
        return bt.build(xls_path, interactive=False)
    except Exception as e:
        errors.append(f"caixa_account: {e}")

    raise RuntimeError("Ningún parser reconoce el archivo. Intentos:\n  - " +
                       "\n  - ".join(errors))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Evita caché del HTML y de los JSON (cambian con frecuencia).
        p = self.path.split("?", 1)[0]
        if p.endswith((".html", ".json")) or p in ("/", "/data/list"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/data/list":
            return self._json(200, {"datasets": list_datasets()})
        # Para que SimpleHTTPRequestHandler no intente servir el query string
        # como parte del nombre de archivo, reseteamos a solo la ruta.
        self.path = path
        return super().do_GET()

    def do_POST(self):
        if self.path == "/data/upload":
            return self._handle_upload()
        if self.path.startswith("/data/") and self.path.endswith(".json"):
            return self._handle_save_json(self.path[len("/data/"):])
        if self.path == "/transactions.json":
            # legacy fallback: guarda sobre el primer dataset
            datasets = list_datasets()
            if not datasets:
                return self.send_error(404, "No hay datasets en data/")
            return self._handle_save_json(datasets[0]["name"])
        return self.send_error(404, "Not found")

    def _handle_save_json(self, filename):
        target = DATA_DIR / filename
        if not target.parent.resolve() == DATA_DIR.resolve():
            return self.send_error(400, "Nombre de archivo inválido")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
            if "transactions" not in payload or "taxonomy" not in payload:
                raise ValueError("Falta 'transactions' o 'taxonomy'")
        except (ValueError, json.JSONDecodeError) as e:
            return self.send_error(400, f"JSON inválido: {e}")
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if target.exists():
            shutil.copy2(target, target.with_suffix(target.suffix + ".bak"))
        with open(target, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        return self._json(200, {"ok": True, "name": filename})

    def _handle_upload(self):
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return self.send_error(400, "Se esperaba multipart/form-data")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        fields = parse_multipart(ctype, body)
        file_field = fields.get("file")
        if not isinstance(file_field, dict) or not file_field.get("_bytes"):
            return self.send_error(400, "Falta el campo 'file' o archivo vacío")
        filename = file_field.get("_filename", "upload.xls")
        filedata = file_field["_bytes"]
        last4 = (fields.get("last4") or "").strip() or None

        tmp = SCRIPT_DIR / f".upload_{filename}"
        with open(tmp, "wb") as f:
            f.write(filedata)

        try:
            payload, out_path = dispatch_parser(tmp, last4=last4)
            # merge_and_write dentro del parser ya guarda + backup
            return self._json(200, {
                "ok": True,
                "name": out_path.name,
                "transactions": len(payload["transactions"]),
            })
        except RuntimeError as e:
            return self.send_error(400, str(e))
        except Exception as e:
            return self.send_error(500, f"Error procesando archivo: {e}")
        finally:
            try:
                tmp.unlink()
            except Exception:
                pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving {SCRIPT_DIR} on http://localhost:{port}", file=sys.stderr)
    print(f"Open: http://localhost:{port}/transaction_dashboard.html", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)


if __name__ == "__main__":
    main()
