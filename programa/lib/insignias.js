'use strict';
// Lee la página de insignias de Steam (steamcommunity.com/my/badges) y la página
// de cromos de un juego (/my/gamecards/<appid>).
// Usa los mismos selectores que ArchiSteamFarm, que se mantiene al día con Steam.

const { parseDocument } = require('htmlparser2');
const { selectAll, selectOne } = require('css-select');
const { textContent, getAttributeValue } = require('domutils');

// Caracteres de control e invisibles (incluidos los que invierten el sentido del texto): un nombre
// de juego con ellos podría alterar la ventana de la consola o disfrazarse de otro texto
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

function texto(nodo) {
	// \s también cubre el espacio duro (&nbsp;) que Steam usa mucho
	return nodo ? textContent(nodo).replace(/\s+/g, ' ').replace(INVISIBLES, '').trim() : '';
}

// "3 card drops remaining" -> 3 ; "No card drops remaining" -> 0
function entero(txt) {
	const m = /\d+/.exec(txt || '');
	return m ? parseInt(m[0], 10) : 0;
}

// "1,234.5 hrs on record" -> 1234.5 ; "" -> 0
function decimal(txt) {
	const m = /\d[\d,]*(?:\.\d+)?/.exec(txt || '');
	return m ? parseFloat(m[0].replace(/,/g, '')) : 0;
}

// 'dentro' si la página se cargó con la sesión iniciada, 'fuera' si no, 'desconocido' si no se sabe
function estadoSesion(html) {
	if (/g_steamID\s*=\s*false/.test(html)) return 'fuera';
	if (/g_steamID\s*=\s*"\d+"/.test(html)) return 'dentro';
	return 'desconocido';
}

function appidDeFila(fila, stats) {
	// Igual que ASF: <div class="card_drop_info_dialog" id="card_drop_info_gamebadge_440_1_0">
	const dialogo = selectOne('.card_drop_info_dialog[id]', stats);
	if (dialogo) {
		const n = Number((getAttributeValue(dialogo, 'id') || '').split('_')[4]);
		if (Number.isInteger(n) && n > 0) return n;
	}
	// Respaldo: el enlace de la fila apunta a .../gamecards/<appid>/
	const contenedor = fila.parent || fila;
	for (const enlace of selectAll('a[href*="/gamecards/"]', contenedor)) {
		const m = /\/gamecards\/(\d+)/.exec(getAttributeValue(enlace, 'href') || '');
		if (m) return parseInt(m[1], 10);
	}
	return 0;
}

function nombreDeFila(fila, stats) {
	const cuerpos = selectAll('.card_drop_info_body', stats);
	const t = texto(cuerpos[cuerpos.length - 1]);
	const m = / by playing (.+)\.$/.exec(t) || / drops remaining for (.+)\.$/.exec(t);
	if (m) return m[1].trim();
	const titulo = texto(selectOne('.badge_title', fila));
	return titulo.replace(/\s*View details\s*$/i, '').trim();
}

function numeroDePaginas(doc) {
	// Los números de página son <a class="pagelink">; la página actual puede no ser enlace
	let max = 1;
	for (const enlace of selectAll('.pagelink', doc)) {
		const n = parseInt(texto(enlace), 10);
		if (n > max) max = n;
	}
	return max;
}

/**
 * Devuelve { juegos: [{ appid, nombre, restantes, horas }], paginas, sesion }
 * Incluye también los juegos con 0 cromos restantes (el que llama decide).
 */
function parsearInsignias(html) {
	const doc = parseDocument(html);
	const juegos = [];
	const vistos = new Set();

	for (const fila of selectAll('.badge_row_inner', doc)) {
		const stats = selectOne('.badge_title_stats_content', fila);
		if (!stats) continue; // insignia que no es de un juego

		const appid = appidDeFila(fila, stats);
		if (!appid || vistos.has(appid)) continue;

		const progreso = selectOne('.progress_info_bold', stats);
		if (!progreso) continue; // sin información de cromos: no se puede decidir nada

		vistos.add(appid);
		juegos.push({
			appid,
			nombre: nombreDeFila(fila, stats) || `Juego ${appid}`,
			restantes: entero(texto(progreso)),
			horas: decimal(texto(selectOne('.badge_title_stats_playtime', stats))),
		});
	}

	return { juegos, paginas: numeroDePaginas(doc), sesion: estadoSesion(html) };
}

/**
 * Página de cromos de un juego. Devuelve { restantes, horas, nombre, sesion }
 * o null si la página no trae la información de cromos.
 */
function parsearJuego(html) {
	const doc = parseDocument(html);
	const progreso = selectOne('.progress_info_bold', doc);
	if (!progreso) return null;

	const cabeceras = selectAll('.profile_small_header_location', doc);
	return {
		restantes: entero(texto(progreso)),
		horas: decimal(texto(selectOne('.badge_title_stats_playtime', doc))),
		nombre: texto(cabeceras[cabeceras.length - 1]),
		sesion: estadoSesion(html),
	};
}

module.exports = { parsearInsignias, parsearJuego, estadoSesion };
