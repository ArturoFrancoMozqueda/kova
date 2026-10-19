"""Text-only PDF canvas for the existing accountant summary in Workers.

The summary uses only Helvetica, fixed coordinates and metadata. pypdf writes
those same PDF primitives without an image decoder or a native extension.
"""

from types import SimpleNamespace

from pypdf import PdfWriter
from pypdf.generic import (
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
)

LETTER = (612, 792)


class Canvas:
    def __init__(self, output, *, pagesize=LETTER, invariant=1):
        if invariant != 1:
            raise ValueError("Only deterministic accountant summaries are supported")
        self.output = output
        self.pagesize = pagesize
        self.writer = PdfWriter()
        self.font = "Helvetica"
        self.font_size = 10
        self.commands = []
        self.metadata = {}
        self.fonts = DictionaryObject()
        for index, name in enumerate(("Helvetica", "Helvetica-Bold")):
            font = DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/" + name),
                    NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
                }
            )
            self.fonts[NameObject(f"/F{index}")] = self.writer._add_object(font)

    def setFont(self, name, size):
        if name not in {"Helvetica", "Helvetica-Bold"}:
            raise ValueError("Unsupported accountant summary font")
        self.font, self.font_size = name, size

    def drawString(self, x, y, text):
        # Hex strings prevent business names/warnings from injecting PDF syntax.
        encoded = text.encode("cp1252", errors="replace").hex()
        font = 1 if self.font == "Helvetica-Bold" else 0
        self.commands.append(
            f"BT /F{font} {self.font_size} Tf 1 0 0 1 {x} {y} Tm <{encoded}> Tj ET\n"
        )

    def showPage(self):
        page = self.writer.add_blank_page(width=self.pagesize[0], height=self.pagesize[1])
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): self.fonts})
        content = DecodedStreamObject()
        content.set_data("".join(self.commands).encode("ascii"))
        page[NameObject("/Contents")] = self.writer._add_object(content)
        self.commands = []

    def setTitle(self, value):
        self.metadata["/Title"] = value

    def setAuthor(self, value):
        self.metadata["/Author"] = value

    def setSubject(self, value):
        self.metadata["/Subject"] = value

    def save(self):
        if self.commands:
            self.showPage()
        self.writer.add_metadata(self.metadata)
        self.writer.write(self.output)


canvas = SimpleNamespace(Canvas=Canvas)
