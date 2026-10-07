'use strict';
// Prueba del lector de insignias con HTML igual al de steamcommunity.com
const assert = require('assert');
const { parsearInsignias, parsearJuego, estadoSesion } = require('../programa/lib/insignias');
const { crearCuenta, paginaInsignias, paginaJuego } = require('./steam-simulado');

const cuenta = crearCuenta({
	juegosPorPagina: 3,
	juegos: [
		{ appid: 620, nombre: 'Portal 2', restantes: 3, horas: 4.3 },
		{ appid: 105600, nombre: 'Terraria', restantes: 0, horas: 120.2 },
		{ appid: 1145360, nombre: 'Hades', restantes: 1, horas: 1234.5 },
		{ appid: 504230, nombre: 'Celeste', restantes: 2, horas: 0 },
		{ appid: 367520, nombre: 'Hollow Knight: "Voidheart" & Co.', restantes: 4, horas: 0.6 },
	],
});

// Página 1: insignia normal (sin juego) + 3 juegos, y enlaces a 2 páginas
const p1 = parsearInsignias(paginaInsignias(cuenta, 1, true));
assert.strictEqual(p1.sesion, 'dentro');
assert.strictEqual(p1.paginas, 2);
assert.deepStrictEqual(p1.juegos, [
	{ appid: 620, nombre: 'Portal 2', restantes: 3, horas: 4.3 },
	{ appid: 105600, nombre: 'Terraria', restantes: 0, horas: 120.2 },
	{ appid: 1145360, nombre: 'Hades', restantes: 1, horas: 1234.5 },
]);

const p2 = parsearInsignias(paginaInsignias(cuenta, 2, true));
assert.strictEqual(p2.paginas, 2, 'la página actual (span) también cuenta');
assert.deepStrictEqual(p2.juegos, [
	{ appid: 504230, nombre: 'Celeste', restantes: 2, horas: 0 },
	{ appid: 367520, nombre: 'Hollow Knight: "Voidheart" & Co.', restantes: 4, horas: 0.6 },
]);

// Sin sesión iniciada
assert.strictEqual(parsearInsignias(paginaInsignias(cuenta, 1, false)).sesion, 'fuera');
assert.strictEqual(estadoSesion('<html>nada</html>'), 'desconocido');

// Página de cromos de un juego
assert.deepStrictEqual(parsearJuego(paginaJuego(cuenta, 620)), { restantes: 3, horas: 4.3, nombre: 'Portal 2', sesion: 'dentro' });
assert.deepStrictEqual(parsearJuego(paginaJuego(cuenta, 105600)), { restantes: 0, horas: 120.2, nombre: 'Terraria', sesion: 'dentro' });
assert.strictEqual(parsearJuego('<html><body>Error</body></html>'), null, 'si no hay datos de cromos devuelve null, no 0');

// Fila sin el diálogo de cromos pero con enlace a /gamecards/ (respaldo) y nombre solo en el título
const rara = `<script>g_steamID = "76561198000000001";</script>
<div class="badge_row is_link"><a class="badge_row_overlay" href="https://steamcommunity.com/id/alguien/gamecards/4000/"></a>
<div class="badge_row_inner"><div class="badge_title_row"><div class="badge_title_stats"><div class="badge_title_stats_content">
<div class="badge_title_stats_playtime">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2.5 hrs on record</div>
<div class="badge_title_stats_drops"><span class="progress_info_bold">1 card drop remaining</span></div>
</div></div><div class="badge_title">Garry's Mod&nbsp;<span class="badge_view_details">View details</span></div></div></div></div>`;
assert.deepStrictEqual(parsearInsignias(rara).juegos, [{ appid: 4000, nombre: "Garry's Mod", restantes: 1, horas: 2.5 }]);

// Fila de juego sin información de progreso: se ignora (no se inventa un 0)
const sinProgreso = rara.replace(/<span class="progress_info_bold">.*?<\/span>/, '');
assert.deepStrictEqual(parsearInsignias(sinProgreso).juegos, []);

// Nombres con caracteres de control (secuencias de escape de la consola, también escritas como
// entidades HTML) o que invierten el sentido del texto: se limpian antes de mostrarlos
const malicioso = crearCuenta({
	juegos: [{ appid: 777, nombre: 'Juego\u001b]0;titulo falso\u0007 &#27;[2J‮gnp.exe‬ Bueno​', restantes: 1, horas: 1 }],
});
const nombreLimpio = parsearInsignias(paginaInsignias(malicioso, 1, true)).juegos[0].nombre;
assert.strictEqual(nombreLimpio, 'Juego]0;titulo falso [2Jgnp.exe Bueno');
assert.ok(!/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/.test(nombreLimpio));

console.log('probar-insignias: OK (todas las comprobaciones pasaron)');
