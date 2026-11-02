"""Export the supplied blank board and separate approved glyphs, without changing their artwork."""
from pathlib import Path
from PIL import Image
import sys
source=Path(sys.argv[1]);main=next(source.rglob('Zman_Main_Pack'))
dest=Path(__file__).resolve().parents[1]/'docs/img/zlm'
items=[(main/'assets/betting_board_blank.png','board-large',1902)]
items += [(p,'bet-'+p.stem,180) for folder in ('glyphs','symbols') for p in (main/folder).glob('*.png')]
for p,name,size in items:
 with Image.open(p) as src:
  im=src.convert('RGBA');im.thumbnail((size,size),Image.Resampling.LANCZOS);im.save(dest/(name+'.webp'),quality=93,method=6)
print('Exported',len(items),'existing board/glyph assets.')
