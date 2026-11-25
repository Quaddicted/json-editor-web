#!/usr/bin/env python3
"""Generates deterministic test fixtures and Python-produced expected outputs.

Run from anywhere: fixtures are written next to this script in ./fixtures/.
The expected outputs are produced with exactly the canonicalization used by
Quaddicted/quaddicted-data: json.dump(obj, f, indent=1, sort_keys=True) + "\n".
"""
import base64
import hashlib
import io
import json
import os
import struct
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iso(dt) -> str:
    return "%04d-%02d-%02dT%02d:%02d:%02d.000Z" % dt


def dump_canonical(obj) -> str:
    return json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def write(name: str, data: bytes):
    with open(os.path.join(FIXTURES, name), "wb") as f:
        f.write(data)


def make_pak(entries):
    """Quake pak: PACK header, file data, then 64-byte directory entries."""
    data_blob = b"".join(data for _, data in entries)
    dir_offset = 12 + len(data_blob)
    directory = b""
    offset = 12
    for name, data in entries:
        directory += name.encode("ascii")[:56].ljust(56, b"\x00")
        directory += struct.pack("<II", offset, len(data))
        offset += len(data)
    return b"PACK" + struct.pack("<II", dir_offset, len(directory)) + data_blob + directory


def expected_files_for_zip_entries(entries):
    files = {}
    for name, dt, data, nested in entries:
        entry = {
            "bytes": len(data),
            "timestamp": iso(dt),
            "sha256": sha256_hex(data),
        }
        if nested is not None:
            entry["files"] = nested
        files[name] = entry
    return files


def main():
    os.makedirs(FIXTURES, exist_ok=True)

    # --- inner.zip --------------------------------------------------------
    inner = io.BytesIO()
    with zipfile.ZipFile(inner, "w") as z:
        zi = zipfile.ZipInfo("inner.txt", (2021, 3, 4, 5, 6, 8))
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, "inner content\n")
        zi2 = zipfile.ZipInfo("data/", (2021, 3, 4, 5, 6, 8))
        zi2.compress_type = zipfile.ZIP_STORED
        z.writestr(zi2, b"")
    inner_bytes = inner.getvalue()

    inner_entries = [
        ("inner.txt", (2021, 3, 4, 5, 6, 8), b"inner content\n", None),
        ("data/", (2021, 3, 4, 5, 6, 8), b"", None),
    ]
    expected_inner_files = expected_files_for_zip_entries(inner_entries)

    # --- pak0.pak ---------------------------------------------------------
    pak_entries = [
        ("maps/test.bsp", b"fake bsp bytes " * 3),
        ("progs.dat", b"progs data here"),
    ]
    pak_bytes = make_pak(pak_entries)
    expected_pak_files = {}
    for name, data in pak_entries:
        expected_pak_files[name] = {"bytes": len(data), "sha256": sha256_hex(data)}

    # --- test.zip ---------------------------------------------------------
    readme = b"Hello Quake!\nSecond line.\n"
    stored = bytes(range(256))
    entries = [
        ("readme.txt", (2021, 7, 12, 17, 54, 58), readme, None, zipfile.ZIP_DEFLATED),
        ("stored.bin", (2019, 11, 30, 23, 59, 58), stored, None, zipfile.ZIP_STORED),
        ("inner.zip", (2020, 5, 6, 7, 8, 10), inner_bytes, expected_inner_files, zipfile.ZIP_DEFLATED),
        ("pak0.pak", (2020, 5, 6, 7, 8, 12), pak_bytes, expected_pak_files, zipfile.ZIP_DEFLATED),
        ("dir/", (2021, 1, 1, 0, 0, 2), b"", None, zipfile.ZIP_STORED),
    ]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, dt, data, _nested, comp in entries:
            zi = zipfile.ZipInfo(name, dt)
            zi.compress_type = comp
            z.writestr(zi, data)
    test_zip = buf.getvalue()

    write("test.zip", test_zip)
    write("notarchive.bin", b"this is not an archive, not even close\n")

    expected_scan = expected_files_for_zip_entries(
        [(name, dt, data, nested) for name, dt, data, nested, _ in entries]
    )
    write("expected_scan.json", dump_canonical(expected_scan).encode("utf-8"))

    # --- expected full pipeline package -----------------------------------
    zip_sha = sha256_hex(test_zip)
    pkg = {
        "bytes": len(test_zip),
        "files": expected_scan,
        "json_version": "2025.09.27",
        "sha256": zip_sha,
        "tags": ["filename=test.zip"],
        "urls": [
            "https://www.quaddicted.com/files/by-sha256/%s/%s/test.zip"
            % (zip_sha[:2], zip_sha)
        ],
    }
    write("expected_pipeline.json", dump_canonical(pkg).encode("utf-8"))

    # --- misc expected info -----------------------------------------------
    b64_sample = "quaddicted \u00e9\u00fc \U0001f600"
    expected_info = {
        "bytes": len(test_zip),
        "sha256": zip_sha,
        "b64_sample": b64_sample,
        "b64_expected": base64.b64encode(b64_sample.encode("utf-8")).decode("ascii"),
    }
    write(
        "expected_info.json",
        (json.dumps(expected_info, indent=1, sort_keys=True) + "\n").encode("utf-8"),
    )

    # --- serializer samples -------------------------------------------------
    serializer_samples = [
        {
            "name": "nested",
            "input": {"b": 1, "a": [1, 2, {"z": None, "y": True}], "empty_obj": {}, "empty_arr": []},
        },
        {
            "name": "escapes",
            "input": {
                "ctrl": "\x01\t\n\"\\\b\f\r",
                "del": "\x7f",
                "uni": "caf\u00e9 r\u00e9sum\u00e9",
                "emoji": "\U0001f600\U0001f44d",
                "zwj": "\u2764\ufe0f",
            },
        },
        {
            "name": "sorted_keys",
            "input": {"\u00e9": 1, "e": 1, "z": 1, "A": 1, "a": 1, "1": 1, "": 2, "_x": 3},
        },
        {
            "name": "numbers",
            "input": {"int": 123, "neg": -45, "float": 1.5, "quarter": 0.25, "zero": 0},
        },
        {
            "name": "deep",
            "input": {"l1": {"l2": {"l3": [{"l4": [{"x": "y"}]}]}}},
        },
    ]
    for sample in serializer_samples:
        sample["expected"] = dump_canonical(sample["input"])
    write(
        "expected_serialize.json",
        (json.dumps(serializer_samples, indent=1, sort_keys=True) + "\n").encode("utf-8"),
    )

    print("Fixtures written to", FIXTURES)


if __name__ == "__main__":
    main()
