"""Generates the synthetic DICOM fixtures in test/fixtures/dicom/.

No public, clearly licensed files exist for these object types, so we make our own.
Everything is fixed (UIDs, dates, names), so the output is byte-for-byte reproducible
with the pydicom version below. No real person or patient data is involved.

    python3 -I scripts/make-synthetic-fixtures.py   # requires pydicom 2.4.x

Writes:
- synthetic_encapsulated_pdf.dcm  Encapsulated PDF Storage with a tiny hand-written PDF.
- synthetic_gsps.dcm              Grayscale Softcopy Presentation State that annotates
                                  MR_small.dcm (text, an ROI polyline, a VOI window).
"""

import sys
from pathlib import Path

import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian

OUT = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "dicom"
# 2.25 + a fixed integer: a valid UID root that needs no registration (PS3.5 B.2).
ROOT = "2.25.302910716843521877230612394171239845"
DATE, TIME = "20261115", "120000"


def uid(n: int) -> str:
    return f"{ROOT}.{n}"


def common(ds: Dataset, sop_class: str, sop_instance: str, modality: str) -> None:
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = sop_instance
    ds.StudyDate = ds.SeriesDate = ds.ContentDate = DATE
    ds.StudyTime = ds.SeriesTime = ds.ContentTime = TIME
    ds.AccessionNumber = ""
    ds.Modality = modality
    ds.Manufacturer = "DicomTrace test fixtures"
    ds.ReferringPhysicianName = ""
    ds.PatientName = "Synthetic^Fixture"
    ds.PatientID = "SYNTHETIC-0001"
    ds.PatientBirthDate = ""
    ds.PatientSex = "O"
    ds.StudyInstanceUID = uid(1)
    ds.StudyID = "1"
    ds.InstanceNumber = 1


def save(ds: Dataset, sop_class: str, name: str) -> None:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = sop_class
    meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = uid(99)
    meta.ImplementationVersionName = "DT_FIXTURES_1"
    file_ds = FileDataset(str(OUT / name), ds, file_meta=meta, preamble=b"\0" * 128)
    file_ds.is_little_endian = True
    file_ds.is_implicit_VR = False
    file_ds.save_as(OUT / name, write_like_original=False)
    print(f"wrote {name} ({(OUT / name).stat().st_size} bytes)")


def tiny_pdf() -> bytes:
    """A valid one-page PDF, written by hand so its bytes are fixed."""
    text = b"BT /F1 18 Tf 36 96 Td (Synthetic test document) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 144] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def encapsulated_pdf() -> None:
    sop_class = "1.2.840.10008.5.1.4.1.1.104.1"  # Encapsulated PDF Storage
    ds = Dataset()
    common(ds, sop_class, uid(10), "DOC")
    ds.SeriesInstanceUID = uid(11)
    ds.SeriesNumber = 1
    ds.ConversionType = "WSD"
    ds.BurnedInAnnotation = "NO"
    ds.DocumentTitle = "Synthetic test document"
    ds.ConceptNameCodeSequence = Sequence()
    ds.MIMETypeOfEncapsulatedDocument = "application/pdf"
    pdf = tiny_pdf()
    # OB values must have even length; the length field records the padded size.
    ds.EncapsulatedDocument = pdf + (b"\0" if len(pdf) % 2 else b"")
    ds.EncapsulatedDocumentLength = len(pdf)
    save(ds, sop_class, "synthetic_encapsulated_pdf.dcm")


def gsps() -> None:
    sop_class = "1.2.840.10008.5.1.4.1.1.11.1"  # Grayscale Softcopy Presentation State
    image = pydicom.dcmread(OUT / "MR_small.dcm")
    ds = Dataset()
    common(ds, sop_class, uid(20), "PR")
    ds.SeriesInstanceUID = uid(21)
    ds.SeriesNumber = 2
    ds.ContentLabel = "ROI"
    ds.ContentDescription = "Synthetic annotation of MR_small"
    ds.PresentationCreationDate = DATE
    ds.PresentationCreationTime = TIME
    ds.ContentCreatorName = ""

    ref_image = Dataset()
    ref_image.ReferencedSOPClassUID = image.SOPClassUID
    ref_image.ReferencedSOPInstanceUID = image.SOPInstanceUID
    ref_series = Dataset()
    ref_series.SeriesInstanceUID = image.SeriesInstanceUID
    ref_series.ReferencedImageSequence = Sequence([ref_image])
    ds.ReferencedSeriesSequence = Sequence([ref_series])

    layer = Dataset()
    layer.GraphicLayer = "ROI"
    layer.GraphicLayerOrder = 1
    ds.GraphicLayerSequence = Sequence([layer])

    text = Dataset()
    text.BoundingBoxAnnotationUnits = "PIXEL"
    text.UnformattedTextValue = "Lesion?"
    text.BoundingBoxTopLeftHandCorner = [10.0, 10.0]
    text.BoundingBoxBottomRightHandCorner = [40.0, 18.0]
    text.BoundingBoxTextHorizontalJustification = "LEFT"
    polyline = Dataset()
    polyline.GraphicAnnotationUnits = "PIXEL"
    polyline.GraphicDimensions = 2
    polyline.NumberOfGraphicPoints = 5
    polyline.GraphicData = [20.0, 20.0, 44.0, 20.0, 44.0, 40.0, 20.0, 40.0, 20.0, 20.0]
    polyline.GraphicType = "POLYLINE"
    polyline.GraphicFilled = "N"
    annotation = Dataset()
    annotation.ReferencedImageSequence = Sequence([ref_image])
    annotation.GraphicLayer = "ROI"
    annotation.TextObjectSequence = Sequence([text])
    annotation.GraphicObjectSequence = Sequence([polyline])
    ds.GraphicAnnotationSequence = Sequence([annotation])

    area = Dataset()
    area.ReferencedImageSequence = Sequence([ref_image])
    area.DisplayedAreaTopLeftHandCorner = [1, 1]
    area.DisplayedAreaBottomRightHandCorner = [int(image.Columns), int(image.Rows)]
    area.PresentationSizeMode = "SCALE TO FIT"
    area.PresentationPixelSpacing = [float(v) for v in image.PixelSpacing]
    ds.DisplayedAreaSelectionSequence = Sequence([area])

    voi = Dataset()
    voi.ReferencedImageSequence = Sequence([ref_image])
    voi.WindowCenter = 600
    voi.WindowWidth = 1200
    ds.SoftcopyVOILUTSequence = Sequence([voi])
    ds.PresentationLUTShape = "IDENTITY"
    save(ds, sop_class, "synthetic_gsps.dcm")


if __name__ == "__main__":
    if not pydicom.__version__.startswith("2.4."):
        sys.exit(f"pydicom 2.4.x expected for byte-identical output, found {pydicom.__version__}")
    encapsulated_pdf()
    gsps()
