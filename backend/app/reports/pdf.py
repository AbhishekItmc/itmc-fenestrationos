"""PDF reports (reportlab platypus). Drawings are proportional and labelled; every page carries the
metadata footer and, when provisional, a red banner plus a diagonal watermark."""
from __future__ import annotations

import io
from typing import Any, Dict, List
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Line, Rect
from reportlab.graphics.shapes import String as _String


def String(x, y, text, **kw):  # Helvetica everywhere in drawings
    kw.setdefault("fontName", "Helvetica")
    return _String(x, y, text, **kw)
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (CondPageBreak, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

from ..engines.models import CalcResult, Cutting1DResult, Nesting2DResult
from .common import WATERMARK, ReportMeta

_ss = getSampleStyleSheet()
H1 = ParagraphStyle("h1", parent=_ss["Heading1"], fontSize=15, spaceAfter=4)
H2 = ParagraphStyle("h2", parent=_ss["Heading2"], fontSize=11.5, spaceBefore=8, spaceAfter=3)
H3 = ParagraphStyle("h3", parent=_ss["Heading3"], fontSize=9.5, spaceBefore=5, spaceAfter=2)
BODY = ParagraphStyle("b", parent=_ss["BodyText"], fontSize=8, leading=10)
SMALL = ParagraphStyle("s", parent=BODY, fontSize=7, leading=8.5)
CELL = ParagraphStyle("c", parent=BODY, fontSize=7, leading=8.5)

PIECE_FILL = colors.HexColor("#BFD7EA")
PIECE_ALT = colors.HexColor("#D9E8C4")
OFFCUT_FILL = colors.HexColor("#9FD8A5")
WASTE_FILL = colors.HexColor("#F2B8B5")
TRIM_FILL = colors.HexColor("#BDBDBD")
RED = colors.HexColor("#B71C1C")


def P(text: Any, style=CELL) -> Paragraph:
    return Paragraph(escape(str(text)), style)


def table(rows: List[List[Any]], widths=None, header: bool = True, repeat: int = 1, align_right_from: int = 99):
    data = [[c if hasattr(c, "wrap") else P(c) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=repeat if header else 0, hAlign="LEFT")
    st = [("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]
    if header:
        st.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E3E7EC")))
    t.setStyle(TableStyle(st))
    return t


def kv_table(rows, width) -> Table:
    return table([[k, v] for k, v in rows], widths=[45 * mm, width - 45 * mm], header=False)


def issues_block(issues: List[Dict[str, Any]], title: str = "Issues") -> List[Any]:
    out = [Paragraph(title, H2)]
    if not issues:
        return out + [P("None.", BODY)]
    rows = [["Severity", "Code", "Message", "Ref"]]
    for i in issues:
        rows.append([i.get("severity", ""), i.get("code", ""), i.get("message", ""), i.get("ref") or ""])
    return out + [table(rows, widths=[18 * mm, 45 * mm, 120 * mm, 40 * mm])]


class _Doc:
    def __init__(self, meta: ReportMeta, landscape_mode: bool = False):
        self.meta = meta
        self.buf = io.BytesIO()
        self.pagesize = landscape(A4) if landscape_mode else A4
        top = (22 + 8 * len(meta.banners)) * mm if meta.banners else 18 * mm
        self.doc = SimpleDocTemplate(self.buf, pagesize=self.pagesize, leftMargin=12 * mm, rightMargin=12 * mm,
                                     topMargin=top, bottomMargin=20 * mm, title=meta.title,
                                     author="ITMC FenestrationOS", subject=meta.validation_status,
                                     keywords=" | ".join(meta.banners))
        self.width = self.pagesize[0] - 24 * mm

    def _on_page(self, c, doc) -> None:
        m = self.meta
        W, H = self.pagesize
        c.saveState()
        if m.provisional or m.invalid:
            c.setFont("Helvetica-Bold", 54)
            c.setFillColor(colors.Color(0.85, 0.1, 0.1, alpha=0.08))
            c.translate(W / 2, H / 2)
            c.rotate(32)
            c.drawCentredString(0, 0, "INVALID — DO NOT RELEASE" if m.invalid else WATERMARK)
            c.rotate(-32)
            c.translate(-W / 2, -H / 2)
        y = H - 10 * mm
        for b in m.banners:
            c.setFillColor(RED)
            c.rect(12 * mm, y - 6.5 * mm, W - 24 * mm, 7 * mm, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont("Helvetica-Bold", 10)
            c.drawCentredString(W / 2, y - 4.5 * mm, b)
            y -= 8 * mm
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(12 * mm, y - 4 * mm, f"ITMC FenestrationOS — {m.title}")
        c.setFont("Helvetica", 8)
        c.drawRightString(W - 12 * mm, y - 4 * mm, m.reference + (f" — {m.project}" if m.project else ""))
        c.setStrokeColor(colors.grey)
        c.line(12 * mm, 15 * mm, W - 12 * mm, 15 * mm)
        c.setFont("Helvetica", 6.5)
        c.drawString(12 * mm, 11.5 * mm, f"Units: {m.units} | Status: {m.validation_status} | Engine: {m.engine_version} | "
                                         f"Catalogue: {m.catalogue_version} | Rules: {m.rule_set}")
        c.drawString(12 * mm, 8 * mm, f"Generated {m.generated_at} by {m.generated_by or '-'}"
                                      + (" | PROVISIONAL — DEMO RULES/DATA — NOT FOR PRODUCTION" if m.provisional else ""))
        c.drawRightString(W - 12 * mm, 8 * mm, f"Page {doc.page}")
        c.restoreState()

    def build(self, story: List[Any]) -> bytes:
        head = [Paragraph(escape(self.meta.title), H1)]
        for b in self.meta.banners:
            head.append(Paragraph(f'<font color="#B71C1C"><b>{escape(b)}</b></font>', BODY))
        head += [Spacer(1, 2 * mm), kv_table(self.meta.rows(), self.width), Spacer(1, 3 * mm)]
        self.doc.build(head + story, onFirstPage=self._on_page, onLaterPages=self._on_page)
        return self.buf.getvalue()


# --------------------------------------------------------------------------- 1D cutting
def bar_drawing(pattern: Dict[str, Any], kerf: float, trim_start: float, trim_end: float, width: float) -> Drawing:
    L = pattern["stock_length"]
    h, pad = 22, 2
    d = Drawing(width, h + 22)
    s = (width - 2 * pad) / L
    y = 12
    d.add(Rect(pad, y, L * s, h, fillColor=colors.white, strokeColor=colors.black, strokeWidth=0.6))
    if trim_start > 0:
        d.add(Rect(pad, y, trim_start * s, h, fillColor=TRIM_FILL, strokeColor=None))
    for i, cut in enumerate(pattern["cuts"]):
        x = pad + cut["offset"] * s
        w = cut["length"] * s
        d.add(Rect(x, y, w, h, fillColor=PIECE_FILL if i % 2 == 0 else PIECE_ALT, strokeColor=colors.black,
                   strokeWidth=0.4))
        label = f"{cut['piece_id']} {cut['length']:g}"
        fs = 7
        if len(label) * fs * 0.5 > w - 2:
            label = cut["piece_id"]
        if len(label) * fs * 0.5 <= w - 1:
            d.add(String(x + w / 2, y + h / 2 - 2, label, fontSize=fs, textAnchor="middle"))
        d.add(String(x, y - 7, f"{cut['offset']:g}", fontSize=4.8, textAnchor="start", fillColor=colors.grey))
        if abs(cut.get("angle_start", 90) - 90) > 1e-6 or abs(cut.get("angle_end", 90) - 90) > 1e-6:
            d.add(String(x + w / 2, y + h + 2, f"{cut.get('angle_start', 90):g}°/{cut.get('angle_end', 90):g}°",
                         fontSize=5, textAnchor="middle", fillColor=RED))
    rem = pattern["remainder"]
    if rem > 0:
        x0 = pad + (L - trim_end - rem) * s
        d.add(Rect(x0, y, rem * s, h, fillColor=OFFCUT_FILL if pattern["offcut_reusable"] else WASTE_FILL,
                   strokeColor=colors.black, strokeWidth=0.4))
        lab = f"{'offcut' if pattern['offcut_reusable'] else 'waste'} {rem:g}"
        if len(lab) * 3 <= rem * s:
            d.add(String(x0 + rem * s / 2, y + h / 2 - 2, lab, fontSize=6, textAnchor="middle"))
    if trim_end > 0:
        d.add(Rect(pad + (L - trim_end) * s, y, trim_end * s, h, fillColor=TRIM_FILL, strokeColor=None))
    d.add(String(pad, y + h + 2, "0", fontSize=5))
    d.add(String(pad + L * s, y + h + 2, f"{L:g} mm", fontSize=5.5, textAnchor="end"))
    return d


def cutting_pdf(result: Dict[str, Any], meta: ReportMeta, name: str) -> bytes:
    r = Cutting1DResult.model_validate(result)
    doc = _Doc(meta, landscape_mode=True)
    W = doc.width
    rq = r.request
    s = r.summary
    story: List[Any] = [Paragraph("Summary", H2)]
    summ = [("Job", name), ("Material / profile", rq.material or "-"), ("Optimiser status", r.status),
            ("Method", r.method), ("Bars used", s.bars_used), ("Total stock length", f"{s.total_stock_length:,.1f} mm"),
            ("Total piece length", f"{s.total_piece_length:,.1f} mm"),
            ("Kerf loss", f"{s.total_kerf_loss:,.1f} mm"), ("Trim loss", f"{s.total_trim_loss:,.1f} mm"),
            ("Reusable offcuts", f"{s.reusable_offcut_length:,.1f} mm"), ("Waste", f"{s.waste_length:,.1f} mm"),
            ("Utilisation", f"{s.utilization * 100:.2f} %"),
            ("Settings", f"kerf {rq.kerf:g} mm, trim start {rq.trim_start:g} mm, trim end {rq.trim_end:g} mm, "
                         f"min reusable offcut {rq.min_reusable_offcut:g} mm")]
    if r.proof:
        summ.append(("Optimality proof", f"lower bound {r.proof.lower_bound_bars} bars, used {r.proof.bars_used}, "
                                         f"gap {r.proof.gap_bars}, optimal={r.proof.is_optimal}. {r.proof.note}"))
    summ.append(("Independent validation", f"{r.validation.validator}: {'PASSED' if r.validation.passed else 'FAILED'}"
                                           f" ({r.validation.checked_items} items checked)"))
    story.append(kv_table(summ, W))
    story.append(Paragraph("Legend: grey = trim, blue/green = pieces (label: mark length), light green = reusable "
                           "offcut, red = waste. Small grey numbers = cut start offset from bar start (mm). "
                           "Kerf is the gap after each piece.", SMALL))
    story.append(Paragraph("Cutting patterns", H2))
    for p in r.patterns:
        pd = p.model_dump()
        head = Paragraph(f"<b>{escape(p.pattern_id)}</b> — stock {escape(p.stock_id)} ({p.stock_length:g} mm"
                         f"{', OFFCUT' if p.is_offcut_stock else ''}) × <b>{p.count}</b> bar(s); used "
                         f"{p.used_length:g} mm, remainder {p.remainder:g} mm "
                         f"({'reusable offcut' if p.offcut_reusable else 'waste'})", BODY)
        rows = [["Cut #", "Piece", "Label", "Length", "Offset", "End", "Angle start", "Angle end"]]
        for i, c in enumerate(p.cuts, 1):
            rows.append([i, c.piece_id, c.label or "", f"{c.length:g}", f"{c.offset:g}", f"{c.offset + c.length:g}",
                         f"{c.angle_start:g}", f"{c.angle_end:g}"])
        story.append(CondPageBreak(45 * mm))
        story.append(KeepTogether([head, bar_drawing(pd, rq.kerf, rq.trim_start, rq.trim_end, W)]))
        story.append(table(rows, widths=[12 * mm, 28 * mm, 80 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm]))
        story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("Cut list", H2))
    placed: Dict[str, int] = {}
    for p in r.patterns:
        for c in p.cuts:
            placed[c.piece_id] = placed.get(c.piece_id, 0) + p.count
    rows = [["Piece", "Label", "Length (mm)", "Angles", "Qty required", "Qty placed"]]
    for pc in rq.pieces:
        rows.append([pc.id, pc.label or "", f"{pc.length:g}", f"{pc.angle_start:g}/{pc.angle_end:g}", pc.quantity,
                     placed.get(pc.id, 0)])
    story.append(table(rows, widths=[30 * mm, 100 * mm, 28 * mm, 25 * mm, 25 * mm, 25 * mm]))
    story.append(Paragraph("Offcuts and waste", H2))
    rows = [["Pattern", "Bars", "Remainder (mm)", "Reusable", "Total reusable (mm)"]]
    for p in r.patterns:
        rows.append([p.pattern_id, p.count, f"{p.remainder:g}", "yes" if p.offcut_reusable else "no (waste)",
                     f"{p.remainder * p.count:g}" if p.offcut_reusable else "0"])
    story.append(table(rows, widths=[30 * mm, 20 * mm, 35 * mm, 30 * mm, 40 * mm]))
    if r.unplaced:
        story.append(Paragraph("Unplaced pieces", H2))
        story.append(table([["Piece", "Length", "Qty"]] + [[u.id, f"{u.length:g}", u.quantity] for u in r.unplaced]))
    story += issues_block([i.model_dump() for i in r.issues])
    story += issues_block([e.model_dump() for e in r.validation.errors], "Validation errors")
    return doc.build(story)


# --------------------------------------------------------------------------- 2D nesting
def sheet_drawing(layout: Dict[str, Any], max_w: float, max_h: float) -> Drawing:
    W, H = layout["width"], layout["height"]
    s = min(max_w / W, max_h / H)
    d = Drawing(W * s + 4, H * s + 14)
    ox, oy = 2, 10
    d.add(Rect(ox, oy, W * s, H * s, fillColor=colors.HexColor("#F7F7F7"), strokeColor=colors.black,
               strokeWidth=0.8))
    for r in layout["residuals"]:
        d.add(Rect(ox + r["x"] * s, oy + r["y"] * s, r["width"] * s, r["height"] * s,
                   fillColor=OFFCUT_FILL if r["reusable"] else colors.HexColor("#F7F7F7"),
                   strokeColor=colors.HexColor("#2E7D32") if r["reusable"] else colors.lightgrey,
                   strokeWidth=0.5, strokeDashArray=[2, 2]))
        if r["reusable"] and r["width"] * s > 40 and r["height"] * s > 10:
            d.add(String(ox + (r["x"] + r["width"] / 2) * s, oy + (r["y"] + r["height"] / 2) * s - 2,
                         f"residual {r['width']:g}×{r['height']:g}", fontSize=7, textAnchor="middle",
                         fillColor=colors.HexColor("#1B5E20")))
    for i, p in enumerate(layout["placements"]):
        x, y, w, h = ox + p["x"] * s, oy + p["y"] * s, p["width"] * s, p["height"] * s
        d.add(Rect(x, y, w, h, fillColor=PIECE_FILL if i % 2 == 0 else PIECE_ALT, strokeColor=colors.black,
                   strokeWidth=0.5))
        lab = f"{p['piece_id']}{' R' if p['rotated'] else ''}"
        dim = f"{p['width']:g}×{p['height']:g}"
        fs = max(4.5, min(10.0, min(w, h) / 5.0))
        if w > len(lab) * fs * 0.5 and h > fs + 1:
            d.add(String(x + w / 2, y + h / 2 + (1 if h > 2 * fs + 2 else -fs / 2), lab, fontSize=fs,
                         textAnchor="middle"))
            if h > 2 * fs + 2 and w > len(dim) * fs * 0.45:
                d.add(String(x + w / 2, y + h / 2 - fs, dim, fontSize=fs * 0.85, textAnchor="middle"))
    d.add(String(ox, 2, f"Sheet {W:g} × {H:g} mm (origin bottom-left; R = rotated 90°)", fontSize=6))
    return d


def nesting_pdf(result: Dict[str, Any], meta: ReportMeta, name: str) -> bytes:
    r = Nesting2DResult.model_validate(result)
    doc = _Doc(meta, landscape_mode=True)
    W = doc.width
    rq, s = r.request, r.summary
    story: List[Any] = [Paragraph("Summary", H2)]
    t = rq.edge_trim
    story.append(kv_table([
        ("Job", name), ("Optimiser status", r.status), ("Method", r.method), ("Sheets used", s.sheets_used),
        ("Total sheet area", f"{s.total_sheet_area_m2:.3f} m²"), ("Total piece area", f"{s.total_piece_area_m2:.3f} m²"),
        ("Waste area", f"{s.waste_area_m2:.3f} m²"), ("Reusable residual area", f"{s.reusable_residual_area_m2:.3f} m²"),
        ("Utilisation", f"{s.utilization * 100:.2f} %"),
        ("Lower bound (sheets)", r.lower_bound_sheets if r.lower_bound_sheets is not None else "-"),
        ("Settings", f"kerf {rq.kerf:g} mm, edge trim L{t.left:g}/R{t.right:g}/T{t.top:g}/B{t.bottom:g} mm, "
                     f"guillotine={rq.guillotine}, min residual {rq.min_residual_width:g}×{rq.min_residual_height:g} mm"),
        ("Independent validation", f"{r.validation.validator}: {'PASSED' if r.validation.passed else 'FAILED'}"
                                   f" ({r.validation.checked_items} items checked)")], W))
    story.append(Paragraph("Sheet layouts", H2))
    for lay in r.layouts:
        ld = lay.model_dump()
        story.append(CondPageBreak(120 * mm))
        story.append(Paragraph(f"<b>{escape(lay.layout_id)}</b> — sheet {escape(lay.sheet_id)} "
                               f"({lay.width:g}×{lay.height:g} mm{', RESIDUAL' if lay.is_residual_sheet else ''}) × "
                               f"<b>{lay.count}</b>; utilisation {lay.utilization * 100:.1f} %", BODY))
        story.append(sheet_drawing(ld, W - 10, 120 * mm))
        rows = [["Piece", "Label", "x", "y", "w", "h", "Rotated"]]
        for p in lay.placements:
            rows.append([p.piece_id, p.label or "", f"{p.x:g}", f"{p.y:g}", f"{p.width:g}", f"{p.height:g}",
                         "yes" if p.rotated else "no"])
        story.append(table(rows, widths=[28 * mm, 70 * mm, 22 * mm, 22 * mm, 22 * mm, 22 * mm, 18 * mm]))
    story.append(Paragraph("Piece list", H2))
    placed: Dict[str, int] = {}
    for lay in r.layouts:
        for p in lay.placements:
            placed[p.piece_id] = placed.get(p.piece_id, 0) + lay.count
    rows = [["Piece", "Label", "Width", "Height", "Qty", "Placed", "Material", "Thk", "Rotate allowed"]]
    for p in rq.pieces:
        rows.append([p.id, p.label or "", f"{p.width:g}", f"{p.height:g}", p.quantity, placed.get(p.id, 0),
                     p.material or "", f"{p.thickness:g}" if p.thickness else "", "yes" if p.can_rotate else "no"])
    story.append(table(rows))
    if r.unplaced:
        story.append(Paragraph("Unplaced pieces", H2))
        story.append(table([["Piece", "W", "H", "Qty"]] + [[u.id, f"{u.width:g}", f"{u.height:g}", u.quantity]
                                                          for u in r.unplaced]))
    story += issues_block([i.model_dump() for i in r.issues])
    story += issues_block([e.model_dump() for e in r.validation.errors], "Validation errors")
    return doc.build(story)


# --------------------------------------------------------------------------- calc
def elevation_drawing(elev: Dict[str, Any], max_w: float, max_h: float) -> Drawing:
    W, H = elev["width"], elev["height"]
    s = min(max_w / W, max_h / H)
    d = Drawing(W * s + 40, H * s + 24)
    ox, oy = 30, 14
    d.add(Rect(ox, oy, W * s, H * s, fillColor=colors.HexColor("#EAF2FA"), strokeColor=colors.black, strokeWidth=1))
    m = elev["mullions"]
    for x in m:
        d.add(Line(ox + x * s, oy, ox + x * s, oy + H * s, strokeWidth=1.2))
    for b, bay in enumerate(elev["bays"]):
        for y in bay.get("transoms", []):
            d.add(Line(ox + m[b] * s, oy + y * s, ox + m[b + 1] * s, oy + y * s, strokeWidth=0.9))
            if b == 0:
                d.add(String(ox - 3, oy + y * s - 2, f"{y:g}", fontSize=5.5, textAnchor="end"))
    for i in range(len(m) - 1):
        d.add(String(ox + (m[i] + m[i + 1]) / 2 * s, oy - 9, f"{m[i + 1] - m[i]:g}", fontSize=5.5,
                     textAnchor="middle"))
    d.add(String(ox + W * s / 2, oy + H * s + 4, f"W {W:g} × H {H:g} mm", fontSize=6.5, textAnchor="middle"))
    return d


def calc_pdf(result: Dict[str, Any], meta: ReportMeta, name: str) -> bytes:
    r = CalcResult.model_validate(result)
    doc = _Doc(meta)
    W = doc.width
    e = r.elevation
    story: List[Any] = [Paragraph("Elevation", H2),
                        kv_table([("Name", name), ("Size", f"{e.width:g} × {e.height:g} mm"),
                                  ("Bays", len(e.bays)), ("System", e.system_id or "-"),
                                  ("Colour", e.colour_id or "-"), ("Default glass", e.default_glass_type_id or "-"),
                                  ("Quantity (identical elevations)", e.quantity),
                                  ("Inputs hash", r.inputs_hash[:16] + "…")], W),
                        Spacer(1, 2 * mm), elevation_drawing(e.model_dump(mode="json"), W - 50, 85 * mm)]
    story.append(Paragraph("Profile cut list", H2))
    rows = [["Mark", "Role", "Profile", "Length (mm)", "Angles", "Qty", "Position", "Formula"]]
    for c in r.profile_cuts:
        rows.append([c.mark, c.role, c.profile_code, f"{c.length:g}", f"{c.angle_start:g}/{c.angle_end:g}",
                     c.quantity, c.position or "", c.formula])
    story.append(table(rows, widths=[12 * mm, 20 * mm, 28 * mm, 18 * mm, 14 * mm, 9 * mm, 30 * mm, 55 * mm]))
    story.append(Paragraph("Glass / infill list", H2))
    rows = [["Mark", "Field", "Type", "Description", "W (mm)", "H (mm)", "Area m²", "Qty", "Formula"]]
    for g in r.glass_items:
        rows.append([g.mark, g.field_key, g.fill_type, g.description, f"{g.width:g}", f"{g.height:g}",
                     f"{g.area_m2:.3f}", g.quantity, g.formula])
    story.append(table(rows, widths=[12 * mm, 13 * mm, 14 * mm, 40 * mm, 15 * mm, 15 * mm, 15 * mm, 9 * mm, 53 * mm]))
    story.append(Paragraph("Bill of materials", H2))
    rows = [["Type", "Code", "Description", "Unit", "Quantity", "Rule"]]
    for b in r.bom:
        rows.append([b.item_type, b.code, b.description, b.unit, f"{b.quantity:,.3f}", "; ".join(b.rule_ids)])
    story.append(table(rows, widths=[18 * mm, 30 * mm, 48 * mm, 10 * mm, 22 * mm, 58 * mm]))
    story.append(Paragraph("Totals", H2))
    story.append(table([["Key", "Value"]] + [[k, f"{v:,.3f}"] for k, v in r.totals.items()],
                       widths=[80 * mm, 40 * mm]))
    story += issues_block([i.model_dump() for i in r.issues])
    story += issues_block([x.model_dump() for x in r.validation.errors], "Validation errors")
    return doc.build(story)


# --------------------------------------------------------------------------- quote
def quote_pdf(q: Dict[str, Any], meta: ReportMeta, project: Dict[str, Any]) -> bytes:
    doc = _Doc(meta)
    W = doc.width
    cur = q["currency"]
    story: List[Any] = [
        Paragraph(f"Quotation {escape(q['number'])}", H2),
        kv_table([("Project", f"{project.get('code')} — {project.get('name')}"),
                  ("Customer", project.get("customer_name") or "-"), ("Site", project.get("site") or "-"),
                  ("Status", q["status"]), ("Currency", cur),
                  ("Based on calc runs", ", ".join(str(i) for i in q["calc_run_ids"])),
                  ("Note", "Demo prices — not a commercial offer")], W),
        Paragraph("Lines", H2)]
    rows = [["#", "Type", "Code", "Description", "Unit", "Qty", f"Unit price ({cur})", f"Amount ({cur})"]]
    for ln in q["lines"]:
        rows.append([ln["line_no"], ln["item_type"], ln["code"], ln["description"], ln["unit"],
                     f"{ln['quantity']:,.3f}", f"{ln['unit_price']:,.2f}", f"{ln['amount']:,.2f}"])
    story.append(table(rows, widths=[7 * mm, 20 * mm, 27 * mm, 52 * mm, 10 * mm, 20 * mm, 24 * mm, 26 * mm]))
    story.append(Spacer(1, 3 * mm))
    story.append(table([["Subtotal", f"{q['subtotal']:,.2f} {cur}"],
                        [f"Margin ({q['margin_pct']:g} %)", f"{q['margin_amount']:,.2f} {cur}"],
                        ["TOTAL (excl. taxes)", f"{q['total']:,.2f} {cur}"]], widths=[60 * mm, 50 * mm],
                       header=False))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph("<b>Demo prices — not a commercial offer.</b> All prices and quantities derive from "
                           "DEMO catalogue data and PROVISIONAL demo calculation rules; they are illustrative only "
                           "and must not be used for tendering, ordering or fabrication.", BODY))
    if q.get("notes"):
        story.append(Paragraph("Notes", H2))
        story.append(P(q["notes"], BODY))
    story += issues_block(q.get("issues") or [])
    return doc.build(story)


# --------------------------------------------------------------------------- production work order sheet
def work_order_pdf(order: Dict[str, Any], parts: List[Dict[str, Any]], board: Dict[str, Any], meta: ReportMeta,
                   project: Dict[str, Any], station_labels: Dict[str, str]) -> bytes:
    from .labels import size_text
    doc = _Doc(meta, landscape_mode=True)
    W = doc.width
    c = board["counts"]
    story: List[Any] = [
        Paragraph(f"Work order {escape(order['number'])} — {escape(order['name'])}", H2),
        kv_table([("Project", f"{project.get('code')} — {project.get('name')}"), ("Status", order["status"]),
                  ("Due date", str(order.get("due_date") or "-")),
                  ("Based on calc runs", ", ".join(str(i) for i in order["calc_run_ids"])),
                  ("Parts", f"{c['total']} total — {c['pending']} pending, {c['in_progress']} in progress, "
                            f"{c['blocked']} blocked, {c['done']} done"),
                  ("Notes", order.get("notes") or "-")], W),
        Paragraph("Stations", H2)]
    rows = [["Station", "Pending", "In progress", "Blocked", "Done here"]]
    for s in board["stations"]:
        rows.append([s["label"], s["pending"], s["in_progress"], s["blocked"], s["done_here"]])
    story.append(table(rows, widths=[50 * mm, 25 * mm, 25 * mm, 25 * mm, 25 * mm]))
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for p in parts:
        groups.setdefault(p["current_station"] or "__done", []).append(p)
    order_keys = [s["id"] for s in board["stations"] if s["id"] in groups] + \
        [k for k in groups if k not in [s["id"] for s in board["stations"]] and k != "__done"] + \
        (["__done"] if "__done" in groups else [])
    for key in order_keys:
        ps = groups[key]
        title = "Done (all stations complete)" if key == "__done" else f"At station: {station_labels.get(key, key)}"
        story.append(CondPageBreak(30 * mm))
        story.append(Paragraph(f"{escape(title)} — {len(ps)} part(s)", H2))
        rows = [["Code", "Mark", "Kind", "Description", "Item", "Size", "Elevation", "Status", "Route step"]]
        for p in ps:
            step = f"{min(p['station_index'] + 1, len(p['route']))}/{len(p['route'])}"
            rows.append([p["code"], f"{p['mark']} #{p['seq']}", p["kind"], p["description"], p.get("item_code") or "",
                         size_text(p), p.get("elevation_name") or "", p["status"], step])
        story.append(table(rows, widths=[20 * mm, 18 * mm, 14 * mm, 72 * mm, 34 * mm, 34 * mm, 34 * mm, 18 * mm,
                                         16 * mm]))
    return doc.build(story)


# --------------------------------------------------------------------------- purchase order
def purchase_order_pdf(po: Dict[str, Any], meta: ReportMeta, project: Dict[str, Any]) -> bytes:
    doc = _Doc(meta, landscape_mode=True)
    W = doc.width
    cur = po["currency"]
    story: List[Any] = [
        Paragraph(f"Purchase order {escape(po['number'])}", H2),
        kv_table([("Project", f"{project.get('code')} — {project.get('name')}"), ("Site", project.get("site") or "-"),
                  ("Supplier", po["supplier"]), ("Category", po["category"]), ("Status", po["status"]),
                  ("Currency", cur), ("Based on calc runs", ", ".join(str(i) for i in po["calc_run_ids"]) or "-"),
                  ("Cutting jobs", ", ".join(str(i) for i in po.get("cutting_job_ids") or []) or "- (bar estimate)"),
                  ("Price basis", "Demo prices — not a commercial offer")], W),
        Paragraph("Lines", H2)]
    rows = [["#", "Type", "Code", "Description", "Unit", "Required", "In stock", "To order",
             f"Unit price ({cur})", f"Amount ({cur})", "Note"]]
    for ln in po["lines"]:
        rows.append([ln.get("line_no", ""), ln["item_type"], ln["code"], ln.get("description", ""), ln["unit"],
                     f"{ln.get('qty_required', 0):,.3f}".rstrip("0").rstrip("."),
                     f"{ln.get('qty_in_stock', 0):,.3f}".rstrip("0").rstrip("."),
                     f"{ln.get('qty_to_order', 0):,.3f}".rstrip("0").rstrip("."),
                     f"{ln.get('unit_price', 0):,.2f}", f"{ln.get('amount', 0):,.2f}", ln.get("note") or ""])
    story.append(table(rows, widths=[7 * mm, 15 * mm, 30 * mm, 55 * mm, 10 * mm, 17 * mm, 17 * mm, 17 * mm,
                                     22 * mm, 24 * mm, 59 * mm]))
    story.append(Spacer(1, 3 * mm))
    story.append(table([["TOTAL (excl. taxes)", f"{po['total']:,.2f} {cur}"]], widths=[60 * mm, 50 * mm],
                       header=False))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph("<b>Demo prices — not a commercial offer.</b> Quantities derive from PROVISIONAL demo "
                           "calculation rules and prices from the DEMO catalogue; bar quantities without a cutting "
                           "job are estimates. Do not send to suppliers without engineering and commercial review.",
                           BODY))
    if po.get("notes"):
        story.append(Paragraph("Notes", H2))
        story.append(P(po["notes"], BODY))
    return doc.build(story)
