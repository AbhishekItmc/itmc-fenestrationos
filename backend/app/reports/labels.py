"""QR part labels (ARCHITECTURE §8.1) drawn directly on a reportlab canvas.

Layouts:
  a4-24        A4 portrait, 3 x 8 grid of 70 x 37 mm labels (common sticker sheet; 0.5 mm top/bottom margin)
  a4-8         A4 portrait, 2 x 4 grid of 105 x 74.25 mm labels
  roll-62x29   one 62 x 29 mm label per page (label printer roll)
Each label: QR code (payload `{PUBLIC_BASE_URL}/p/{code}`, error correction M), the part code in large monospace,
mark/seq, description, size (L=… or W×H), project code and work order number; "DEMO/PROVISIONAL" when the
work order was built from provisional (demo-rule) calc runs. Uses reportlab's built-in QrCodeWidget only.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


@dataclass(frozen=True)
class Layout:
    id: str
    page_w: float
    page_h: float
    cols: int
    rows: int
    label_w: float
    label_h: float
    margin_x: float
    margin_y: float
    pad: float


LAYOUTS: Dict[str, Layout] = {
    "a4-24": Layout("a4-24", A4[0], A4[1], 3, 8, 70 * mm, 37 * mm, 0.0, (A4[1] - 8 * 37 * mm) / 2, 2.5 * mm),
    "a4-8": Layout("a4-8", A4[0], A4[1], 2, 4, 105 * mm, A4[1] / 4, 0.0, 0.0, 5 * mm),
    "roll-62x29": Layout("roll-62x29", 62 * mm, 29 * mm, 1, 1, 62 * mm, 29 * mm, 0.0, 0.0, 1.5 * mm),
}


def qr_payload(base_url: str, code: str) -> str:
    return f"{base_url.rstrip('/')}/p/{code}"


def qr_widget(payload: str) -> QrCodeWidget:
    return QrCodeWidget(payload, barLevel="M")


def _qr_drawing(widget: QrCodeWidget, size: float) -> Drawing:
    x0, y0, x1, y1 = widget.getBounds()
    d = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    d.add(widget)
    return d


def _fit(text: str, font: str, size: float, width: float) -> str:
    if stringWidth(text, font, size) <= width:
        return text
    while text and stringWidth(text + "…", font, size) > width:
        text = text[:-1]
    return text + "…"


def _fit_size(text: str, font: str, size: float, width: float, min_size: float = 5.0) -> float:
    while size > min_size and stringWidth(text, font, size) > width:
        size -= 0.25
    return size


def size_text(part: Dict[str, Any]) -> str:
    if part.get("kind") == "profile" and part.get("length") is not None:
        s = f"L={part['length']:g} mm"
        a, b = part.get("angle_start"), part.get("angle_end")
        if a is not None and b is not None and (abs(a - 90) > 1e-9 or abs(b - 90) > 1e-9):
            s += f"  {a:g}°/{b:g}°"
        return s
    if part.get("width") is not None and part.get("height") is not None:
        return f"{part['width']:g} × {part['height']:g} mm"
    return "-"


def _draw_label(c: canvas.Canvas, x: float, y: float, lay: Layout, part: Dict[str, Any], ctx: Dict[str, Any],
                base_url: str, widgets: Optional[List[QrCodeWidget]]) -> None:
    p = lay.pad
    w, h = lay.label_w, lay.label_h
    qr = min(h - 2 * p, w * 0.46)
    widget = qr_widget(qr_payload(base_url, part["code"]))
    if widgets is not None:
        widgets.append(widget)
    renderPDF.draw(_qr_drawing(widget, qr), c, x + p, y + (h - qr) / 2)
    tx = x + p + qr + 1.5 * mm
    tw = x + w - p - tx
    top = y + h - p
    small = lay.id == "roll-62x29"
    # code: large monospace
    code_size = _fit_size(part["code"], "Courier-Bold", h * (0.20 if not small else 0.24), tw, 6)
    yy = top - code_size * 0.85
    c.setFont("Courier-Bold", code_size)
    c.drawString(tx, yy, part["code"])
    lines = [
        ("Helvetica-Bold", f"{part.get('mark', '')} #{part.get('seq', 1)}" +
         (f"  {part.get('elevation_name')}" if part.get("elevation_name") and not small else "")),
        ("Helvetica", part.get("description") or ""),
        ("Helvetica-Bold", size_text(part)),
        ("Helvetica", str(ctx.get("project_code", ""))),
        ("Helvetica-Bold", str(ctx.get("order_number", ""))),
    ]
    if ctx.get("provisional"):
        lines.append(("Helvetica-Oblique", "DEMO / PROVISIONAL"))
    avail = yy - (y + p)
    fs = min(9.0 if not small else 6.0, max(4.0, avail / (len(lines) * 1.15)))
    for font, text in lines:
        yy -= fs * 1.15
        size = _fit_size(text, font, fs, tw, min_size=max(4.0, fs * 0.75))   # shrink a little, then truncate
        c.setFont(font, size)
        c.drawString(tx, yy, _fit(text, font, size, tw))


def labels_pdf(parts: Sequence[Dict[str, Any]], ctx: Dict[str, Any], layout: str, base_url: str,
               widgets: Optional[List[QrCodeWidget]] = None) -> bytes:
    """`parts`: dicts with code, kind, mark, seq, description, length/width/height; `ctx`: project_code,
    order_number, provisional, title. `widgets` (optional) collects the QR widgets for verification."""
    lay = LAYOUTS.get(layout)
    if lay is None:
        raise ValueError(f"unknown label layout {layout!r}")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(lay.page_w, lay.page_h))
    c.setTitle(f"Part labels {ctx.get('order_number', '')} ({layout})")
    c.setAuthor("ITMC FenestrationOS")
    c.setSubject("PROVISIONAL — DEMO RULES/DATA" if ctx.get("provisional") else "Part labels")
    per_page = lay.cols * lay.rows
    if not parts:
        c.setFont("Helvetica", 9)
        c.drawString(5 * mm, lay.page_h / 2, "No parts match the selection.")
        c.showPage()
    for i, part in enumerate(parts):
        k = i % per_page
        if i and k == 0:
            c.showPage()
        col, row = k % lay.cols, k // lay.cols
        x = lay.margin_x + col * lay.label_w
        y = lay.page_h - lay.margin_y - (row + 1) * lay.label_h
        _draw_label(c, x, y, lay, part, ctx, base_url, widgets)
    if parts:
        c.showPage()
    c.save()
    return buf.getvalue()
