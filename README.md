# Farmeador de cromos de Steam

Consigue los cromos de tus juegos de Steam sin tener que jugarlos. Inicia sesión en tu cuenta, revisa qué juegos todavía sueltan cromos y le dice a Steam que los estás jugando, sin abrirlos de verdad (no gasta recursos de tu PC). Cuando un juego suelta todos sus cromos, pasa al siguiente.

> [!WARNING]
> El Acuerdo de Suscriptor de Steam (sección 4.C) prohíbe usar scripts o bots para inflar horas de juego u obtener recompensas sin jugar de verdad, y Valve puede restringir o cerrar cuentas por eso. Usar este programa va contra esas reglas: hazlo bajo tu propia responsabilidad.

Cada juego suelta más o menos la mitad de sus cromos, y cuáles te tocan es al azar. El resto se consigue intercambiando o en el Mercado de la Comunidad.

## Requisitos

- Windows 10 u 11.
- [Node.js](https://nodejs.org) (versión LTS). Si no lo tienes, el programa te ofrece instalarlo.
- Conexión a Internet. No hace falta tener Steam abierto.

## Cómo usarlo

1. Descarga el proyecto (botón verde **Code** → **Download ZIP**) y descomprímelo: clic derecho → **Extraer todo...**
2. Haz doble clic en **Iniciar farmeador.bat**.
   - Si Windows pregunta si quieres ejecutarlo, elige **Más información** → **Ejecutar de todas formas**.
   - La primera vez instala Node.js (si falta) y descarga las librerías que necesita. Tarda un minuto.
3. Escribe tu nombre de cuenta de Steam (el que usas para iniciar sesión, no tu apodo) y tu contraseña. Al escribirla verás asteriscos.
4. Si tienes Steam Guard, escribe el código de la app de Steam o el que te llega por correo.
5. Deja la ventana abierta (puedes minimizarla). Te avisa cada vez que cae un cromo, y el título de la ventana muestra qué está haciendo.

Para detenerlo, cierra la ventana. Puedes volver a abrirlo cuando quieras: sigue donde quedó, porque las horas y los cromos que faltan los guarda Steam. Si eliges recordar la sesión, la próxima vez entra solo, sin pedirte la contraseña.

## Cuánto tarda

Más o menos 30 minutos por cromo, porque los cromos solo caen jugando un juego a la vez. Al empezar te muestra un tiempo estimado. Solo avanza con la PC prendida: si la vas a dejar de noche, desactiva la suspensión en las opciones de energía de Windows.

## Puedes seguir usando Steam

Si abres un juego mientras farmea, el farmeador se pausa solo y sigue un minuto después de que lo cierres. Nunca te saca de un juego que estés jugando tú. Tus amigos no te ven "jugando" a lo que farmea (se puede cambiar abajo), pero las horas sí se suman a tu perfil.

## Las 3 horas

En muchas cuentas Steam no suelta cromos hasta que el juego tiene unas 3 horas jugadas. Por eso, a los juegos con menos horas primero les suma horas en grupo (hasta 32 a la vez, el máximo de Steam) y después los farmea de uno en uno.

Si tu cuenta suelta cromos desde el principio, pon `"horasMinimas": 0` en `config.json` y te ahorras ese tiempo. Para saberlo, prueba con 0 unos 40 minutos en un juego que nunca jugaste: si cae un cromo, déjalo en 0.

## Opciones (`config.json`)

Ábrelo con el Bloc de notas, cambia el valor, guarda y vuelve a abrir el farmeador.

| Opción | Por defecto | Qué hace |
|---|---|---|
| `horasMinimas` | `3` | Horas que suma a cada juego antes de esperar cromos (entre 0 y 24). |
| `minutosEntreRevisiones` | `15` | Cada cuánto revisa si cayó un cromo (entre 5 y 60). Además revisa al instante cuando Steam avisa que llegó algo a tu inventario. |
| `horasMaximasSinCromo` | `5` | Si un juego pasa este tiempo sin soltar ningún cromo, lo salta. Suele pasar con juegos marcados como privados en tu biblioteca. |
| `aparecerEnLinea` | `false` | Con `true`, tus amigos te ven en línea y jugando. |
| `excluir` | `[]` | Juegos que NO quieres farmear, por su número (AppID). Ejemplo: `[440, 730]` |
| `soloEstos` | `[]` | Si pones juegos aquí, farmea solo esos. Ejemplo: `[620]` |

El AppID es el número que aparece en la dirección del juego en la tienda: `store.steampowered.com/app/620/` → `620`.

### Ojo con los reembolsos

Steam te devuelve el dinero de un juego si lo pides dentro de los 14 días de comprarlo y lo jugaste menos de 2 horas. El farmeador suma horas, así que si acabas de comprar un juego que quizás quieras devolver, ponlo en `excluir` antes de empezar.

## Seguridad

- **Tu contraseña no se guarda.** Se usa solo para iniciar sesión y viaja cifrada a Steam.
- **La sesión guardada vive fuera de esta carpeta**, en `%LOCALAPPDATA%\farmeador-cromos-steam`, una carpeta privada de tu usuario de Windows. Compartir o subir la carpeta del programa nunca entrega tu cuenta. Aun así, esa sesión es como una contraseña: no copies esa carpeta a nadie.
- **Para cerrar la sesión guardada**, haz doble clic en **Borrar sesion guardada.bat**. Para quitarle el acceso también desde Steam, entra a [Dispositivos autorizados](https://store.steampowered.com/account/authorizeddevices) y quita el del farmeador.
- **Solo se conecta a Steam.** No abre puertos en tu PC, no envía datos a nadie más, no hace intercambios, compras ni nada en el Mercado, y no necesita permisos de administrador.
- **No trae ningún .exe.** Todo el programa es código que puedes leer, en la carpeta `programa`. Si una copia trae archivos `.exe` o `.dll`, no la uses.
- **Descárgalo solo del repositorio original.** Un programa que pide tu contraseña de Steam es justo lo que usan los estafadores: una copia modificada podría robarte la cuenta.
- Las librerías se descargan con las versiones exactas de `package-lock.json` (npm comprueba su huella) y sin ejecutar scripts de instalación.

## Problemas comunes

- **"Usuario o contraseña incorrectos"**: usa el nombre de cuenta, no tu apodo de perfil.
- **"Steam bloqueó los inicios de sesión"**: hubo demasiados intentos. Espera una hora.
- **"No pude conectar con Steam"**: revisa tu Internet, o tu antivirus o cortafuegos.
- **"Faltan librerías del programa"**: borra la carpeta `programa\node_modules` y vuelve a abrir **Iniciar farmeador.bat**.
- No abras el farmeador dos veces con la misma cuenta: el primero se cierra.

## Para desarrolladores

- `programa/farmeador.js`: punto de entrada (inicio de sesión y consola).
- `programa/lib/`: el farmeo (`farmeo.js`), la lectura de insignias (`insignias.js`), las consultas a steamcommunity.com (`web.js`), la sesión guardada (`sesion.js`), la configuración (`config.js`) y la consola (`consola.js`).
- `pruebas/`: pruebas con un Steam simulado. No usan ninguna cuenta real.

```
cd programa
npm ci --ignore-scripts
npm test
```

`pruebas/probar-consola.py` prueba la consola en una terminal de verdad y solo funciona en Linux o macOS.

Librerías: [steam-user](https://github.com/DoctorMcKay/node-steam-user) para la conexión con Steam, y htmlparser2, css-select y domutils para leer las páginas. El algoritmo de farmeo es el mismo que usa [ArchiSteamFarm](https://github.com/JustArchiNET/ArchiSteamFarm).
