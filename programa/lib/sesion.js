'use strict';
// Sesión guardada: la "llave" (refresh token) que da Steam para no pedir la contraseña cada vez.
// La contraseña nunca se guarda. La llave se guarda FUERA de la carpeta del programa, en una
// carpeta privada de tu usuario, para que compartir o subir el programa nunca la incluya.

const fs = require('fs');
const os = require('os');
const path = require('path');

const NOMBRE_CARPETA = 'farmeador-cromos-steam';

/**
 * Carpeta privada del usuario para la sesión y los datos de conexión:
 * Windows: %LOCALAPPDATA%\farmeador-cromos-steam (solo la pueden leer tu usuario y los administradores)
 */
function carpetaDeDatos() {
	const inicio = os.homedir();
	let base;
	if (process.platform === 'win32') base = process.env.LOCALAPPDATA || path.join(inicio, 'AppData', 'Local');
	else if (process.platform === 'darwin') base = path.join(inicio, 'Library', 'Application Support');
	else base = process.env.XDG_DATA_HOME || path.join(inicio, '.local', 'share');
	if (!path.isAbsolute(base)) base = inicio;
	return path.join(base, NOMBRE_CARPETA);
}

function leerSesion(ruta) {
	try {
		const s = JSON.parse(fs.readFileSync(ruta, 'utf8'));
		if (s && typeof s.refreshToken === 'string' && s.refreshToken) return s;
	} catch {
		// no hay sesión guardada o el archivo está dañado
	}
	return null;
}

function guardarSesion(ruta, datos) {
	fs.mkdirSync(path.dirname(ruta), { recursive: true, mode: 0o700 });
	const temporal = `${ruta}.tmp`;
	try {
		fs.writeFileSync(temporal, JSON.stringify(datos, null, 2), { mode: 0o600 });
		fs.renameSync(temporal, ruta);
	} catch (e) {
		// que no quede una copia de la llave en el archivo temporal
		try {
			fs.unlinkSync(temporal);
		} catch {
			// no se llegó a crear
		}
		throw e;
	}
}

function borrarSesion(ruta) {
	try {
		fs.unlinkSync(ruta);
	} catch {
		// ya no existía
	}
}

/**
 * La versión 1.0 guardaba la sesión dentro de la carpeta del programa (programa/datos).
 * Si existe, la pasa a la carpeta privada y borra la carpeta vieja. Devuelve true si movió la sesión.
 */
function migrarSesionVieja(dirViejo, dirNuevo) {
	if (!fs.existsSync(dirViejo)) return false;
	const vieja = leerSesion(path.join(dirViejo, 'sesion.json'));
	const rutaNueva = path.join(dirNuevo, 'sesion.json');
	let movida = false;
	if (vieja && !leerSesion(rutaNueva)) {
		guardarSesion(rutaNueva, vieja);
		movida = true;
	}
	fs.rmSync(dirViejo, { recursive: true, force: true });
	return movida;
}

/**
 * true si la llave sirve para iniciar sesión: es de Steam, es para el cliente y no venció.
 * (steam-user cierra el programa de golpe si le pasas una llave que no cumple esto)
 */
function llaveUsable(refreshToken) {
	try {
		const partes = String(refreshToken).split('.');
		if (partes.length !== 3) return false;
		const datos = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
		const audiencias = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
		if (datos.iss !== 'steam' || !audiencias.includes('client') || !datos.sub) return false;
		return !(typeof datos.exp === 'number' && datos.exp * 1000 < Date.now() + 60000);
	} catch {
		return false;
	}
}

module.exports = { carpetaDeDatos, leerSesion, guardarSesion, borrarSesion, migrarSesionVieja, llaveUsable, NOMBRE_CARPETA };
