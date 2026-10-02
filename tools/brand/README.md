# tools/brand

Logogeneratoren for `public/brand/`. Hakens form styres av varianten «A tail-hake» i `tune.py`.

```
curl -L -o SG.ttf 'https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/SchibstedGrotesk%5Bwght%5D.ttf'
pip install fonttools uharfbuzz cairosvg skia-pathops
python3 final.py
```

Fonten (`SG.ttf`) og utdata (`out/`) er gitignorert.
