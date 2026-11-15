"""Records nibabel's reading of each NIfTI fixture header as ground truth.

The golden test (test/golden/nifti.test.ts) checks our parser's field values against
these files, the way go-dicom recordings back the DICOM offsets.

    python3 -I scripts/record-nibabel-headers.py   # requires nibabel 5.x
"""

import gzip
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np

ROOT = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "nifti"
OUT = ROOT / "nibabel"


def plain(value):
    """numpy values → JSON: arrays to lists, bytes to latin-1 text without trailing NULs."""
    if isinstance(value, np.ndarray):
        if value.dtype.kind == "S":
            return value.tobytes().split(b"\0", 1)[0].decode("latin-1")
        return [plain(v) for v in value.tolist()] if value.ndim else plain(value.item())
    if isinstance(value, bytes):
        return value.split(b"\0", 1)[0].decode("latin-1")
    if isinstance(value, float) and not np.isfinite(value):
        return str(value)
    return value


def slice_stats(img):
    """Ground truth for the voxel decoder: the middle z slice of the first volume,
    scaled as nibabel scales it (get_fdata applies scl_slope and scl_inter)."""
    data = np.asarray(img.dataobj)
    scaled = img.get_fdata(dtype=np.float64)
    shape = data.shape
    z = shape[2] // 2 if len(shape) > 2 else 0
    plane = scaled[:, :, z, 0] if len(shape) > 3 else (scaled[:, :, z] if len(shape) > 2 else scaled)
    probes = [(0, 0), (shape[0] // 2, shape[1] // 2), (shape[0] - 1, shape[1] - 1)]
    return {
        "z": z,
        "min": float(plane.min()),
        "max": float(plane.max()),
        "mean": float(plane.mean()),
        "probes": [{"x": x, "y": y, "value": float(plane[x, y])} for x, y in probes],
    }


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for path in sorted(ROOT.glob("*.nii*")):
        img = nib.load(path)
        # img.header is post-processed (scaling moved to the data object, vox_offset
        # reset). Read the raw header from the file instead: that is what is on disk.
        header_class = nib.Nifti2Header if isinstance(img.header, nib.Nifti2Header) else nib.Nifti1Header
        opener = gzip.open if path.name.endswith(".gz") else open
        with opener(path, "rb") as fileobj:
            header = header_class.from_fileobj(fileobj)
        fields = {name: plain(header[name]) for name in header.keys()}
        record = {
            "nibabel": nib.__version__,
            "version": 2 if isinstance(header, nib.Nifti2Header) else 1,
            "littleEndian": header.endianness == "<",
            "shape": list(img.shape),
            "extensions": [{"code": int(e.get_code()), "size": int(e.get_sizeondisk())} for e in header.extensions],
            "slice": slice_stats(img),
            "fields": fields,
        }
        name = path.name.replace(".nii.gz", ".nii").replace(".nii", "")
        (OUT / f"{name}{'.gz' if path.name.endswith('.gz') else ''}.json").write_text(
            json.dumps(record, indent=2, sort_keys=True) + "\n"
        )
        print(f"{path.name}: v{record['version']} shape {record['shape']}")


if __name__ == "__main__":
    if not nib.__version__.startswith("5."):
        sys.exit(f"nibabel 5.x expected, found {nib.__version__}")
    main()
