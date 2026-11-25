import hashlib
import io
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")
os.makedirs(FIX, exist_ok=True)

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


def canon(obj):
    return json.dumps(obj, indent=1, sort_keys=True) + "\n"


def write(name, data):
    mode = "wb" if isinstance(data, (bytes, bytearray)) else "w"
    with open(os.path.join(FIX, name), mode) as f:
        f.write(data)


def zip_ts(dt):
    return "%04d-%02d-%02dT%02d:%02d:%02d.000Z" % dt


def insert(files, path, entry):
    files[path] = entry
    parts = path.split("/")
    for i in range(1, len(parts)):
        d = "/".join(parts[:i]) + "/"
        if d not in files:
            files[d] = {"bytes": 0, "sha256": EMPTY_SHA256}


def is_archive_magic(b):
    return b[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PACK")


def scan_zip_bytes(data, depth=0):
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.filelist:
            name = info.filename.replace("\\", "/")
            content = z.read(info)
            if name.endswith("/"):
                insert(files, name, {"bytes": 0, "timestamp": zip_ts(info.date_time), "sha256": EMPTY_SHA256})
                continue
            entry = {
                "bytes": info.file_size,
                "timestamp": zip_ts(info.date_time),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
            if is_archive_magic(content) and depth < 4:
                if content[:4] == b"PACK":
                    entry["files"] = scan_pak_bytes(content, depth + 1)
                else:
                    entry["files"] = scan_zip_bytes(content, depth + 1)
            insert(files, name, entry)
    return files


def scan_pak_bytes(data, depth=0):
    files = {}
    dir_ofs = int.from_bytes(data[4:8], "little")
    dir_len = int.from_bytes(data[8:12], "little")
    for i in range(dir_len // 64):
        ent = data[dir_ofs + i * 64 : dir_ofs + (i + 1) * 64]
        name = ent[:56].split(b"\0")[0].decode("latin1").replace("\\", "/")
        pos = int.from_bytes(ent[56:60], "little")
        ln = int.from_bytes(ent[60:64], "little")
        if not name:
            continue
        content = data[pos : pos + ln]
        entry = {"bytes": ln, "sha256": hashlib.sha256(content).hexdigest()}
        if is_archive_magic(content) and depth < 4:
            if content[:4] == b"PACK":
                entry["files"] = scan_pak_bytes(content, depth + 1)
            else:
                entry["files"] = scan_zip_bytes(content, depth + 1)
        insert(files, name, entry)
    return files


def build_inner_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        zi = zipfile.ZipInfo("deep.txt", date_time=(2020, 1, 2, 3, 4, 6))
        zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, b"deep content\n")
        zi2 = zipfile.ZipInfo("sub/inner2.txt", date_time=(2022, 12, 31, 23, 59, 58))
        zi2.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi2, b"nested deflated payload " * 10)
    return buf.getvalue()


def build_test_zip():
    inner = build_inner_zip()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        zi = zipfile.ZipInfo("readme.txt", date_time=(1997, 10, 25, 18, 51, 44))
        zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, b"hello quaddicted\n")
        zid = zipfile.ZipInfo("maps/", date_time=(2021, 3, 14, 15, 9, 26))
        zid.compress_type = zipfile.ZIP_STORED
        z.writestr(zid, b"")
        zi2 = zipfile.ZipInfo("maps/e1m1.bsp", date_time=(1998, 1, 22, 7, 54, 52))
        zi2.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi2, b"BSP29 fake data " * 100)
        zi3 = zipfile.ZipInfo("gfx/palette.lmp", date_time=(1999, 6, 1, 12, 0, 0))
        zi3.compress_type = zipfile.ZIP_STORED
        z.writestr(zi3, bytes(range(256)))
        zi4 = zipfile.ZipInfo("inner.zip", date_time=(2023, 5, 5, 5, 5, 4))
        zi4.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi4, inner)
    return buf.getvalue()


def build_test_pak():
    inner = build_inner_zip()
    files = [
        ("maps/start.bsp", b"pak bsp payload" * 20),
        ("gfx/palette.lmp", bytes(range(128))),
        ("inner.zip", inner),
    ]
    header_len = 12
    data = b""
    entries = []
    for name, content in files:
        pos = header_len + len(data)
        data += content
        entries.append((name, pos, len(content)))
    dir_ofs = header_len + len(data)
    directory = b""
    for name, pos, ln in entries:
        nb = name.encode("latin1")
        assert len(nb) < 56
        directory += nb + b"\0" * (56 - len(nb)) + pos.to_bytes(4, "little") + ln.to_bytes(4, "little")
    return b"PACK" + dir_ofs.to_bytes(4, "little") + len(directory).to_bytes(4, "little") + data + directory


def main():
    test_zip = build_test_zip()
    test_pak = build_test_pak()
    write("test.zip", test_zip)
    write("test.pak", test_pak)
    write("notarchive.bin", b"this is not an archive at all, just some bytes \x00\x01\x02" * 5)

    zip_files = scan_zip_bytes(test_zip)
    pak_files = scan_pak_bytes(test_pak)
    write("expected_zip_files.json", canon(zip_files))
    write("expected_pak_files.json", canon(pak_files))

    sha = hashlib.sha256(test_zip).hexdigest()
    pkg = {
        "bytes": len(test_zip),
        "files": zip_files,
        "json_version": "2025.09.27",
        "sha256": sha,
        "tags": ["filename=test.zip"],
        "urls": ["https://www.quaddicted.com/files/by-sha256/%s/%s/test.zip" % (sha[:2], sha)],
    }
    write("expected_package.json", canon(pkg))
    write("test.zip.sha256", sha)

    print("fixtures written to", FIX)
    print("test.zip sha256:", sha)


if __name__ == "__main__":
    main()
