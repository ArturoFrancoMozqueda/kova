# Video de la landing

`public/film/kova-demo-{horizontal,vertical}.mp4` se generan con este flujo. No hay narración: el mensaje va como texto animado dentro del video y la pista de audio sólo tiene efectos de sonido sintetizados por `sfx.py` (sin muestras de terceros).

- `composition.html`: escenas, textos, movimiento y cues de sonido. `render(t)` dibuja el cuadro en el segundo `t`; `?o=h` es 16:9 y `?o=v` es 9:16.
- Capturas: usa `public/showcase/` (escritorio e historias) y `public/showcase/mobile/` (teléfono). `sources/` guarda sólo las capturas que no usa la landing (Panel y catálogo público).
- `render.mjs`: renderiza los cuadros con Playwright en `workspace/film/` (ignorado por git) y exporta los cues de sonido.
- `sfx.py`: convierte los cues en un WAV estéreo de 48 kHz.

Desde la raíz del repo, con Docker (esta Mac no tiene Node):

```sh
docker run --rm -v "$PWD":/repo -v kova_fe_node_modules:/repo/frontend/node_modules:ro -w /repo/frontend \
  mcr.microsoft.com/playwright:v1.59.1-noble sh -c "node scripts/film/render.mjs h && node scripts/film/render.mjs v"
```

Para revisar una escena antes del render completo: `node scripts/film/render.mjs h --stills 6.2,13.5`.

Audio y codificación (cualquier Python 3 y ffmpeg):

```sh
python3 frontend/scripts/film/sfx.py workspace/film/sfx-h.json workspace/film/sfx-h.wav 45
ffmpeg -framerate 30 -i workspace/film/frames-h/f%05d.jpg -i workspace/film/sfx-h.wav \
  -c:v libx264 -preset slow -crf 28 -tune stillimage -pix_fmt yuv420p -profile:v high \
  -movflags +faststart -c:a aac -b:a 96k -shortest frontend/public/film/kova-demo-horizontal.mp4
```

La versión vertical usa `sfx-v`, `frames-v`, `-vf scale=720:1280:flags=lanczos` y `-crf 26`. Los pósters `.webp` salen del cuadro 283 (momento de «Venta registrada»).

Reglas: sólo capturas reales del tenant de prueba, sin correos ni nombres de personas, y sólo funciones disponibles hoy (nada de canales o IA que aún no estén activos).
