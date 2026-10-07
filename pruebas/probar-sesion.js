'use strict';
// Prueba de la sesión guardada: dónde se guarda, con qué permisos, que no queden copias y la
// migración desde la versión 1.0 (que la guardaba dentro de la carpeta del programa).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sesion = require('../programa/lib/sesion');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farmeador-sesion-'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const llave = (datos) => `${b64({ alg: 'EdDSA' })}.${b64(datos)}.firma`;
const LLAVE_OK = llave({ iss: 'steam', sub: '76561198000000001', aud: ['client', 'web'], exp: Math.floor(Date.now() / 1000) + 86400 });

try {
	// 1) Carpeta privada del usuario, fuera de la carpeta del programa
	if (process.platform !== 'win32') {
		const antes = process.env.XDG_DATA_HOME;
		process.env.XDG_DATA_HOME = path.join(tmp, 'xdg');
		assert.strictEqual(sesion.carpetaDeDatos(), path.join(tmp, 'xdg', 'farmeador-cromos-steam'));
		process.env.XDG_DATA_HOME = 'relativa'; // una ruta relativa no se acepta
		assert.ok(path.isAbsolute(sesion.carpetaDeDatos()));
		if (antes === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = antes;
	}
	const programa = path.resolve(__dirname, '..', 'programa');
	assert.ok(!sesion.carpetaDeDatos().startsWith(programa), 'nunca dentro de la carpeta del programa');

	// 2) Guardar: permisos privados (en Linux/macOS) y sin archivo temporal
	const dir = path.join(tmp, 'datos');
	const ruta = path.join(dir, 'sesion.json');
	sesion.guardarSesion(ruta, { usuario: 'jugador', refreshToken: LLAVE_OK });
	assert.deepStrictEqual(sesion.leerSesion(ruta), { usuario: 'jugador', refreshToken: LLAVE_OK });
	assert.deepStrictEqual(fs.readdirSync(dir), ['sesion.json']);
	if (process.platform !== 'win32') {
		assert.strictEqual(fs.statSync(ruta).mode & 0o777, 0o600, 'solo tu usuario puede leer el archivo');
		assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, 'solo tu usuario puede entrar a la carpeta');
	}

	// 3) Si guardar falla a mitad, no queda una copia de la llave en el temporal
	const bloqueada = path.join(tmp, 'bloqueada');
	fs.mkdirSync(path.join(bloqueada, 'sesion.json', 'no-vacia'), { recursive: true }); // renombrar encima de esto falla
	assert.throws(() => sesion.guardarSesion(path.join(bloqueada, 'sesion.json'), { refreshToken: LLAVE_OK }));
	assert.ok(!fs.existsSync(path.join(bloqueada, 'sesion.json.tmp')), 'no queda el temporal');

	// 4) Migración desde la versión 1.0
	const viejo = path.join(tmp, 'programa-viejo', 'datos');
	const nuevo = path.join(tmp, 'privada');
	fs.mkdirSync(path.join(viejo, 'steam'), { recursive: true });
	fs.writeFileSync(path.join(viejo, 'sesion.json'), JSON.stringify({ usuario: 'jugador', refreshToken: LLAVE_OK }));
	fs.writeFileSync(path.join(viejo, 'steam', 'cellid-x.txt'), '25');
	assert.strictEqual(sesion.migrarSesionVieja(viejo, nuevo), true);
	assert.ok(!fs.existsSync(viejo), 'la carpeta vieja se borra');
	assert.strictEqual(sesion.leerSesion(path.join(nuevo, 'sesion.json')).refreshToken, LLAVE_OK);
	assert.strictEqual(sesion.migrarSesionVieja(viejo, nuevo), false, 'si no hay nada que mover, no hace nada');

	// Si ya hay una sesión en la carpeta nueva, no la pisa (pero igual borra la vieja)
	fs.mkdirSync(viejo, { recursive: true });
	fs.writeFileSync(path.join(viejo, 'sesion.json'), JSON.stringify({ usuario: 'otra', refreshToken: 'x.y.z' }));
	assert.strictEqual(sesion.migrarSesionVieja(viejo, nuevo), false);
	assert.strictEqual(sesion.leerSesion(path.join(nuevo, 'sesion.json')).usuario, 'jugador');
	assert.ok(!fs.existsSync(viejo));

	// 5) Solo se aceptan llaves de Steam para el cliente y vigentes
	assert.strictEqual(sesion.llaveUsable(LLAVE_OK), true);
	assert.strictEqual(sesion.llaveUsable(llave({ iss: 'otro', sub: '1', aud: ['client'] })), false);
	assert.strictEqual(sesion.llaveUsable(llave({ iss: 'steam', sub: '1', aud: ['web'] })), false);
	assert.strictEqual(sesion.llaveUsable(llave({ iss: 'steam', sub: '1', aud: ['client'], exp: 1 })), false);
	assert.strictEqual(sesion.llaveUsable('basura'), false);

	console.log('probar-sesion: OK (todas las comprobaciones pasaron)');
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
