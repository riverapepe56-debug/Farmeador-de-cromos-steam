'use strict';
// Ejecuta el farmeador real (farmeador.js) conectado a Steam simulado, para probar la consola.
// Variables: DIR_PRUEBA (carpeta temporal), CORREO=1 (Steam Guard por correo), SIN_GUARD=1

const fs = require('fs');
const path = require('path');
const { main } = require('../programa/farmeador');
const { SteamFalso, servidorWeb, crearCuenta, relojRapido } = require('./steam-simulado');

(async () => {
	const dir = process.env.DIR_PRUEBA;
	const archivoLlave = path.join(dir, 'llave-valida-simulador.txt');
	const cuenta = crearCuenta({
		velocidad: 3600,
		usuario: 'jugador_pe',
		contrasena: 'Contraseña*Secreta1',
		codigoGuard: process.env.SIN_GUARD === '1' ? null : 'K7Q2X',
		guardPorCorreo: process.env.CORREO === '1',
		juegos: [
			{ appid: 620, nombre: 'Portal 2', restantes: 2, horas: 3.5 },
			{ appid: 1145360, nombre: 'Hades', restantes: 1, horas: 0 },
		],
	});
	if (fs.existsSync(archivoLlave)) cuenta.llaveValida = fs.readFileSync(archivoLlave, 'utf8');
	if (process.env.LLAVE_INVALIDA === '1') cuenta.llaveValida = 'revocada'; // Steam ya no acepta la llave guardada

	const reloj = relojRapido(cuenta.velocidad);
	const cliente = new SteamFalso(cuenta, reloj);
	cliente.on('refreshToken', (llave) => fs.writeFileSync(archivoLlave, llave));
	const logOffOriginal = cliente.logOff.bind(cliente);
	cliente.logOff = () => {
		console.log('[simulador] logOff recibido');
		logOffOriginal();
	};
	if (process.env.ERROR_TRAS_ENTRAR) {
		// Simula que Steam corta la sesión con un error al rato de haber entrado
		cliente.once('loggedOn', () =>
			reloj.programar(() => {
				cliente.steamID = null;
				cliente.jugando = [];
				const e = new Error('simulado');
				e.eresult = Number(process.env.ERROR_TRAS_ENTRAR);
				cliente.emit('error', e);
			}, 0.2 * 3600000)
		);
	}
	if (process.env.FALLA_RED_AL_ENTRAR) {
		// Los primeros intentos fallan como sin Internet (error sin código de Steam)
		let fallos = Number(process.env.FALLA_RED_AL_ENTRAR);
		const original = cliente._logOn.bind(cliente);
		cliente._logOn = (d) => (fallos-- > 0 ? cliente.emit('error', new Error('HTTP error 403')) : original(d));
	}
	const servidor = await servidorWeb(cuenta, cliente);
	servidor.unref();

	const codigo = await main({
		crearCliente: () => cliente,
		baseWeb: `http://127.0.0.1:${servidor.address().port}`,
		reloj,
		esperar: reloj.dormir,
		esperarWeb: reloj.dormir,
		rutaConfig: path.join(dir, 'config.json'),
		dirDatos: path.join(dir, 'datos'),
		// nunca la carpeta real del programa: las pruebas no deben tocar una sesión de verdad
		dirLegado: process.env.DIR_LEGADO || path.join(dir, 'legado-no-existe'),
		args: process.argv.slice(2),
	});
	console.log(`[simulador] dataDirectory=${JSON.stringify(cliente.opciones.dataDirectory ?? null)}`);
	console.log(`[simulador] juegos jugados: ${JSON.stringify(cliente.llamadas.map((l) => l.apps))}`);
	console.log(`[simulador] SALIDA=${codigo}`);
	cliente.destruir();
	process.exit(codigo);
})();
