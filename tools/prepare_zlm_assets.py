"""Prepare supplied art only. Does not retouch faces or invent missing glass layers."""
from pathlib import Path
from PIL import Image
import xml.etree.ElementTree as ET
import hashlib, json, copy, sys
ET.register_namespace('', 'http://www.w3.org/2000/svg')

repo=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]).resolve()
out=repo/'docs/img/zlm'
out.mkdir(parents=True,exist_ok=True)
main=next(source.rglob('Zman_Main_Pack'))
yoav=next(source.rglob('02_Yoav_Bonus__contents'))
shoot=next(source.rglob('Matvach_Bonus_Final'))
balls=next(source.rglob('04_Balls_Bonus'))
manifest=[]
def convert(p,name,limit):
    with Image.open(p) as src:
        im=src.convert('RGBA')
        im.thumbnail((limit,limit),Image.Resampling.LANCZOS)
        im.save(out/(name+'.webp'),format='WEBP',quality=91,method=6)
    manifest.append({'source':str(p.relative_to(source)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'asset':name+'.webp'})
convert(main/'assets/studio_background.png','studio',1400)
convert(main/'assets/game_mockup.png','poster',1000)
convert(main/'assets/betting_board.png','board',1902)
convert(main/'assets/pointer.png','pointer',200)
convert(yoav/'bar_background.png','bar',1300)
convert(yoav/'yoav.png','yoav',1000)
for p in (shoot/'assets').glob('*.png'): convert(p,'range-'+p.stem,1100)
for p in (balls/'assets').glob('*.png'):
    if p.stem!='machine': convert(p,'balls-'+p.stem,1300)

# Split by source SVG element identity, preserving the original common coordinates.
tree=ET.parse(main/'assets/wheel_editable.svg'); root=tree.getroot(); elements=list(root)
assert elements[164].tag.endswith('image') and elements[164].get('x')=='780'
assert elements[165].tag.endswith('image') and elements[165].get('x')=='-50'
for name,selected in [('wheel-turn', [0]+list(range(2,110))+list(range(166,len(elements)))),('wheel-fixed',[164,165])]:
    layer=ET.Element(root.tag,dict(root.attrib))
    for i in selected: layer.append(copy.deepcopy(elements[i]))
    # Temporary SVG is local preparation input, not served or checked in.
    ET.ElementTree(layer).write(source/(name+'.svg'),encoding='utf-8',xml_declaration=True)
    manifest.append({'source':str((main/'assets/wheel_editable.svg').relative_to(source)),'sha256':hashlib.sha256((main/'assets/wheel_editable.svg').read_bytes()).hexdigest(),'asset':name+'.webp'})
(repo/'test/zlm_asset_sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared',len(manifest),'WebP assets; two SVG layers ready for raster export.')
