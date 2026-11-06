"""Build a ZIP that can be extracted and loaded as an unpacked extension."""
from pathlib import Path
import json, zipfile

root = Path(__file__).resolve().parent
extension = root / 'extension'
manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
output = root / 'dist' / ('bili-together-extension-' + manifest['version'] + '.zip')
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(extension.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(extension).as_posix())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
    assert 'content.js' in archive.namelist()
    packed = json.loads(archive.read('manifest.json'))
    for entry in packed['content_scripts']:
        for filename in entry['js']:
            assert filename in archive.namelist()
print(output)
