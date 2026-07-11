# ⬡ NEXUS ARENA

Shooter cooperativo 3D de supervivencia por oleadas para navegador. Resiste junto a tu
escuadrón (1-6 jugadores) a hordas de robots hostiles en una arena industrial.

![Motor](https://img.shields.io/badge/motor-three.js-orange) ![Red](https://img.shields.io/badge/red-Socket.IO-blue) ![Node](https://img.shields.io/badge/node-%E2%89%A518-green)

## Características

- **Primera y tercera persona** — cambia al vuelo con `V`.
- **Multijugador cooperativo hasta 6 jugadores** — salas públicas/privadas con código de 4 letras y partida rápida.
- **Un jugador** — el mismo modo de oleadas, en solitario.
- **Servidor autoritativo** — la IA de los enemigos, el daño, las oleadas y los pickups se
  calculan en el servidor (validación de distancia, límite de cadencia y de daño por arma).
- **Gráficos realistas** — iluminación HDRI (Poly Haven), materiales PBR con mapas de
  difuso/normales/rugosidad, sombras suaves, tone mapping ACES, niebla atmosférica.
- **Assets reales** — soldado y robot animados (GLB con esqueleto y clips), texturas y cielo de Poly Haven (CC0).
- **4 armas desbloqueables** — pistola, rifle de asalto, escopeta (50 bajas), subfusil (150 bajas).
- **Progreso guardado** — perfil, récords, bajas acumuladas y desbloqueos persisten en `localStorage`.
- **Ajustes completos** — sensibilidad, FOV, volúmenes, 4 niveles de calidad gráfica, invertir Y, contador FPS.
- **Sistema de revivir** — mantén `E` junto a un aliado caído para reanimarlo.
- **Audio procedural** — disparos, impactos, música ambiental y avisos generados con WebAudio (0 KB de descargas).
- Chat de equipo, tabla de puntuaciones (`Tab`), kill feed, marcadores de impacto y headshots con bonus.

## Ejecutar

```bash
cd nexus-arena
npm install
npm start          # servidor en http://localhost:3000
```

Abre `http://localhost:3000` en Chrome/Edge/Firefox. Para jugar en LAN, comparte
`http://TU_IP:3000`. Puerto configurable con la variable `PORT`.

## Controles

| Tecla | Acción |
|---|---|
| `W A S D` | Moverse |
| `Shift` | Correr |
| `Espacio` | Saltar |
| Ratón | Apuntar / disparar |
| `R` | Recargar |
| `1-4` / rueda | Cambiar arma |
| `V` | Primera ⇄ tercera persona |
| `E` (mantener) | Revivir aliado |
| `Tab` | Puntuaciones |
| `T` | Chat |
| `Esc` | Pausa |

## Cómo se juega

Elimina todas las oleadas que puedas. Cada oleada trae más enemigos y más duros:

- **Centinela** (gris) — equilibrado. 100 pts.
- **Acechador** (verde) — rápido y frágil. 150 pts.
- **Devastador** (rojo) — lento, enorme y letal. 400 pts.

Los enemigos sueltan **botiquines** y **munición** al morir. Los disparos a la cabeza hacen
×1.6 de daño y dan ×1.5 de puntos. Si todo el equipo cae, la partida termina; los caídos
reaparecen al empezar cada oleada o al ser revividos.

## Arquitectura

```
nexus-arena/
├── server/server.js         # Express + Socket.IO: salas, IA, oleadas, validación
├── public/
│   ├── index.html            # Pantallas: menú, multijugador, lobby, ajustes, HUD…
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js           # Controlador de pantallas y flujo de partida
│   │   ├── game.js           # Motor: bucle, jugador, cámara, armas, red en juego
│   │   ├── world.js          # Construcción de la arena (luces, PBR, muros)
│   │   ├── assets.js         # Carga GLB/HDRI/texturas y fábricas de modelos
│   │   ├── weapons.js        # Definición de armas
│   │   ├── effects.js        # Trazadoras, chispas, fogonazos
│   │   ├── audio.js          # SFX y música procedurales (WebAudio)
│   │   ├── net.js            # Envoltura de Socket.IO
│   │   ├── settings.js       # Ajustes, perfil y guardado (localStorage)
│   │   └── shared/map.js     # Mapa y colisiones compartidos cliente/servidor
│   └── assets/               # Modelos GLB, HDRI y texturas descargadas
└── package.json
```

El servidor es dueño del estado de los enemigos (tick de 10 Hz) y valida cada impacto
(distancia máxima, tope de daño por arma, límite de disparos por segundo). Los clientes
interpolan enemigos y jugadores remotos para un movimiento fluido.

## Jugar online con amigos

El juego necesita su servidor Node ejecutándose (GitHub solo aloja el código). La forma
más rápida y gratuita:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/S-BlackDragon/nexus-arena)

1. Pulsa el botón (crea una cuenta gratis en Render si no tienes).
2. Acepta los valores por defecto (`render.yaml` ya lo configura todo) y espera ~2 min.
3. Render te da una URL tipo `https://nexus-arena-xxxx.onrender.com` — compártela con tus
   amigos, cread una sala y a jugar.

> Nota del plan gratuito: el servidor se "duerme" tras 15 min sin uso; la primera visita
> tarda ~30 s en despertarlo.

## Despliegue en producción

Cualquier host de Node.js sirve (Railway, Render, Fly.io, VPS):

```bash
PORT=8080 node server/server.js
```

Un solo proceso sirve los estáticos y los WebSockets. Detrás de un proxy (nginx/Caddy),
habilita el upgrade de WebSocket. Para escalar a varios procesos se necesitaría el adaptador
Redis de Socket.IO (no incluido).

## Créditos de assets

- **Soldier.glb** y **RobotExpressive.glb** — ejemplos oficiales de [three.js](https://github.com/mrdoob/three.js) (MIT / CC).
- **HDRI** `industrial_sunset_puresky` y **texturas PBR** (`rocky_terrain_02`, `metal_plate`, `concrete_wall_008`) — [Poly Haven](https://polyhaven.com), licencia CC0.
- Sonidos y música — sintetizados en tiempo real con WebAudio.
