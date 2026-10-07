#!/usr/bin/env node
'use strict';
// Farmeador de cromos de Steam
// Inicia sesión en tu cuenta, revisa qué juegos todavía sueltan cromos y los "juega"
// (sin abrirlos de verdad) hasta conseguirlos todos. Ábrelo con "Iniciar farmeador.bat".

const fs = require('fs');
const path = require('path');
const sesion = require('./lib/sesion');

const RAIZ = path.resolve(__dirname, '..');
const NOMBRE_EQUIPO = 'Farmeador de cromos'; // nombre del dispositivo que se le informa a Steam al entrar
const LOGON_ID = 0x464d4352; // identificador propio para no chocar con otros programas de Steam

/** true si las librerías (programa/node_modules) están completas y son las versiones de package-lock.json */
function libreriasInstaladas() {
	let lock = null;
	try {
		lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8'));
	} catch {
		// sin package-lock.json solo se puede comprobar que carguen
	}
	try {
		for (const [ruta, info] of Object.entries((lock && lock.packages) || {})) {
			if (!ruta || info.dev || info.optional) continue;
			const instalada = JSON.parse(fs.readFileSync(path.join(__dirname, ruta, 'package.json'), 'utf8'));
			// (npm guarda "1.2.2" aunque el paquete diga "v1.2.2")
			if (String(instalada.version).trim().replace(/^[=v]+/i, '') !== info.version) return false; // p. ej., las de la versión 1.0
		}
		require('steam-user');
		require('./lib/insignias'); // htmlparser2, css-select y domutils
		return true;
	} catch {
		return false;
	}
}

async function main(opciones = {}) {
	const args = opciones.args || process.argv.slice(2);
	if (args.includes('--revisar-librerias')) return libreriasInstaladas() ? 0 : 3; // lo usa Iniciar farmeador.bat

	const consola = opciones.consola || require('./lib/consola');
	const { log, color } = consola;
	const rutaConfig = opciones.rutaConfig || path.join(RAIZ, 'config.json');
	// La sesión se guarda en una carpeta privada de tu usuario, nunca dentro de la carpeta del programa
	const dirDatos = opciones.dirDatos || sesion.carpetaDeDatos();
	const dirLegado = opciones.dirLegado || path.join(__dirname, 'datos'); // donde la guardaba la versión 1.0
	const rutaSesion = path.join(dirDatos, 'sesion.json');

	console.log('');
	console.log(color.negrita('  ======================================'));
	console.log(color.negrita('      Farmeador de cromos de Steam'));
	console.log(color.negrita('  ======================================'));
	console.log('');

	if (args.includes('--olvidar')) {
		fs.rmSync(dirDatos, { recursive: true, force: true });
		fs.rmSync(dirLegado, { recursive: true, force: true });
		log.ok('Listo: borré la sesión guardada. La próxima vez te pediré usuario y contraseña.');
		log.info('Para quitarle el acceso también desde Steam, entra a store.steampowered.com/account/authorizeddevices y quita el del farmeador.');
		return 0;
	}

	if (typeof globalThis.fetch !== 'function' || typeof AbortSignal.timeout !== 'function') {
		log.error(`Tu Node.js (${process.version}) es muy antiguo. Instala la versión LTS desde https://nodejs.org y vuelve a intentarlo.`);
		return 1;
	}

	if (!libreriasInstaladas()) {
		log.error('Faltan librerías del programa o están desactualizadas. Ábrelo con "Iniciar farmeador.bat", que las descarga solo.');
		log.error('Si ya lo hiciste y sigue fallando, borra la carpeta programa\\node_modules y vuelve a abrirlo.');
		return 1;
	}

	try {
		if (sesion.migrarSesionVieja(dirLegado, dirDatos)) {
			log.info('Pasé tu sesión guardada a una carpeta privada de tu usuario, fuera de la carpeta del programa.');
		}
	} catch (e) {
		log.aviso(`No pude mover la sesión guardada de la versión anterior (${e.message}).`);
	}

	const { cargarConfig, ErrorDeConfig } = require('./lib/config');
	let config;
	try {
		config = cargarConfig(rutaConfig);
	} catch (e) {
		if (!(e instanceof ErrorDeConfig)) throw e;
		log.error(e.message);
		return 1;
	}

	const SteamUser = require('steam-user');
	const { EResult } = SteamUser;
	const { WebSteam } = require('./lib/web');
	const { Farmeador } = require('./lib/farmeo');

	// Sin carpeta de datos hasta saber si quieres recordar la sesión: así, si dices que no, no se guarda nada
	const cliente = opciones.crearCliente
		? opciones.crearCliente()
		: new SteamUser({ dataDirectory: null, renewRefreshTokens: true, autoRelogin: true });
	const web = new WebSteam({ cliente, log, base: opciones.baseWeb, esperar: opciones.esperarWeb });
	const farmeador = new Farmeador({ cliente, web, config, log, reloj: opciones.reloj });
	const esperar = opciones.esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));

	const estado = { usuario: '', recordar: false, llave: '', dentro: false, saliendo: false, reconectando: false, pedidosCorreo: 0 };

	const nombreError = (e) => (e && e.eresult ? EResult[e.eresult] || `código ${e.eresult}` : (e && e.message) || String(e));
	const ERRORES_DE_RED = new Set([EResult.Fail, EResult.NoConnection, EResult.Busy, EResult.Timeout, EResult.ServiceUnavailable, EResult.TryAnotherCM]);
	const ERRORES_DE_ACCESO = new Set([EResult.AccessDenied, EResult.Expired, EResult.Revoked, EResult.InvalidPassword, EResult.InvalidSignature]);
	const ERRORES_DE_LIMITE = new Set([EResult.RateLimitExceeded, EResult.AccountLoginDeniedThrottle]);
	// Sin código de Steam (sin Internet, cortafuegos, Steam caído...) también es un problema de conexión
	const esDeConexion = (e) => !e || e.eresult === undefined || e.eresult === null || ERRORES_DE_RED.has(e.eresult);

	function recordarEnEstaPC() {
		estado.recordar = true;
		// datos de conexión de la librería (y, con Steam Guard por correo, el aviso de "equipo de confianza")
		if (typeof cliente.setOption === 'function') cliente.setOption('dataDirectory', path.join(dirDatos, 'steam'));
	}

	// ---- eventos de Steam ----

	cliente.on('refreshToken', (llave) => {
		estado.llave = llave;
		if (!estado.recordar) return;
		try {
			sesion.guardarSesion(rutaSesion, { usuario: estado.usuario, refreshToken: llave });
		} catch (e) {
			log.aviso(`No pude guardar la sesión (${e.message}). La próxima vez te pediré la contraseña.`);
		}
	});

	cliente.on('steamGuard', async (dominio, enviarCodigo, codigoAnteriorMalo) => {
		let pregunta;
		if (dominio) {
			estado.pedidosCorreo++;
			pregunta = estado.pedidosCorreo > 1
				? `Ese código no sirvió. Revisa el último correo de Steam (${dominio}) y escríbelo: `
				: `Steam te envió un código a tu correo (${dominio}). Escríbelo aquí: `;
		} else {
			pregunta = codigoAnteriorMalo
				? 'Ese código no sirvió. Espera a que la app muestre uno nuevo (cambia cada 30 segundos) y escríbelo: '
				: 'Abre la app de Steam en tu celular, entra a Steam Guard (el escudo) y escribe el código que aparece: ';
		}
		const codigo = await consola.preguntar(pregunta);
		log.info('Conectando con Steam...');
		enviarCodigo(codigo.replace(/\s+/g, '').toUpperCase());
	});

	cliente.on('loggedOn', () => {
		if (config.aparecerEnLinea) cliente.setPersona(SteamUser.EPersonaState.Online);
		if (estado.dentro && !estado.saliendo) log.ok('Conectado de nuevo a Steam.');
	});

	cliente.on('disconnected', (eresult) => {
		if (estado.dentro && !estado.saliendo) log.aviso(`Se cortó la conexión con Steam (${EResult[eresult] || eresult}). Reconectando...`);
	});

	cliente.on('error', (e) => {
		if (!estado.dentro || estado.saliendo || estado.reconectando) return; // los errores al iniciar sesión se manejan aparte
		if (e.eresult === EResult.LogonSessionReplaced || e.eresult === EResult.LoggedInElsewhere) {
			log.error('Se abrió otro farmeador con esta misma cuenta, así que este se cierra.');
			salir(1);
			return;
		}
		if (ERRORES_DE_ACCESO.has(e.eresult)) {
			log.error('Steam cerró la sesión (¿cambiaste la contraseña o quitaste el acceso?). Vuelve a abrir el farmeador para entrar de nuevo.');
			sesion.borrarSesion(rutaSesion);
			salir(1);
			return;
		}
		log.aviso(`Steam desconectó la sesión (${nombreError(e)}). Vuelvo a entrar en 1 minuto.`);
		reconectarLuego();
	});

	async function reconectarLuego() {
		estado.reconectando = true;
		try {
			while (!estado.saliendo) {
				await esperar(60000);
				if (estado.saliendo) return;
				try {
					await iniciarSesion({ refreshToken: estado.llave });
					return;
				} catch (e) {
					if (ERRORES_DE_ACCESO.has(e.eresult)) {
						log.error('Steam ya no acepta esta sesión. Vuelve a abrir el farmeador para entrar de nuevo.');
						sesion.borrarSesion(rutaSesion);
						salir(1);
						return;
					}
					log.aviso(`Todavía no puedo volver a entrar (${nombreError(e)}). Reintento en 1 minuto.`);
				}
			}
		} finally {
			estado.reconectando = false;
		}
	}

	function iniciarSesion(datos) {
		return new Promise((resolve, reject) => {
			const lento = setTimeout(() => log.aviso('Steam está tardando en responder. Sigo intentando (revisa tu conexión a Internet).'), 30000);
			const limpiar = () => {
				clearTimeout(lento);
				cliente.removeListener('loggedOn', alEntrar);
				cliente.removeListener('error', alFallar);
				cliente.removeListener('steamGuard', alPedirCodigo);
			};
			const alEntrar = () => {
				limpiar();
				resolve();
			};
			const alFallar = (e) => {
				limpiar();
				reject(e);
			};
			const alPedirCodigo = () => clearTimeout(lento);
			cliente.on('loggedOn', alEntrar);
			cliente.on('error', alFallar);
			cliente.on('steamGuard', alPedirCodigo);
			try {
				cliente.logOn({ ...datos, machineName: NOMBRE_EQUIPO, logonID: LOGON_ID });
			} catch (e) {
				limpiar();
				reject(e);
			}
		});
	}

	// ---- salir con Ctrl+C o al cerrar la ventana ----

	function cerrarSteam() {
		return new Promise((resolve) => {
			if (!cliente.steamID) return resolve();
			const t = setTimeout(resolve, 3000);
			cliente.once('disconnected', () => {
				clearTimeout(t);
				resolve();
			});
			try {
				cliente.logOff();
			} catch {
				clearTimeout(t);
				resolve();
			}
		});
	}

	async function salir(codigo) {
		if (estado.saliendo) process.exit(codigo);
		estado.saliendo = true;
		console.log('');
		log.info('Cerrando el farmeador...');
		farmeador.detener();
		await cerrarSteam();
		process.exit(codigo);
	}
	consola.manejarCtrlC(() => salir(0));
	for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(senal, () => salir(0));

	// ---- iniciar sesión ----

	async function entrarConLlave(guardada) {
		estado.usuario = guardada.usuario || '';
		recordarEnEstaPC();
		estado.llave = guardada.refreshToken;
		log.info(`Entrando con la sesión guardada${estado.usuario ? ` de ${estado.usuario}` : ''}...`);
		for (;;) {
			try {
				await iniciarSesion({ refreshToken: guardada.refreshToken });
				return 'ok';
			} catch (e) {
				if (ERRORES_DE_ACCESO.has(e.eresult)) {
					log.aviso('La sesión guardada ya no sirve (venció o se cerró desde Steam). Vuelve a iniciar sesión.');
					sesion.borrarSesion(rutaSesion);
					return 'pedirContrasena';
				}
				if (!esDeConexion(e)) {
					log.error(`Steam no permitió iniciar sesión (${nombreError(e)}).`);
					return 'salir';
				}
				log.aviso(`No pude conectar con Steam (${nombreError(e)}). Revisa tu conexión a Internet; reintento en 1 minuto.`);
				await esperar(60000);
			}
		}
	}

	async function entrarConContrasena() {
		log.info('Tu contraseña solo se usa para iniciar sesión; nunca se guarda.');
		for (let intento = 1; intento <= 3; intento++) {
			let usuario = '';
			while (!usuario) usuario = await consola.preguntar('Nombre de cuenta de Steam (el que usas para iniciar sesión): ');
			const contrasena = await consola.preguntarOculto('Contraseña: ');
			estado.usuario = usuario;
			if (intento === 1 && (await consola.preguntarSiNo('¿Recordar la sesión en esta PC para no escribir la contraseña la próxima vez?', true))) {
				recordarEnEstaPC();
			}
			estado.pedidosCorreo = 0;
			log.info('Conectando con Steam...');
			try {
				await iniciarSesion({ accountName: usuario, password: contrasena });
				return true;
			} catch (e) {
				if (e.eresult === EResult.InvalidPassword) {
					log.error('Usuario o contraseña incorrectos. Inténtalo de nuevo.');
					continue;
				}
				if (ERRORES_DE_LIMITE.has(e.eresult)) {
					log.error('Steam bloqueó los inicios de sesión desde tu conexión por demasiados intentos. Espera una hora y vuelve a intentarlo.');
				} else if (esDeConexion(e)) {
					log.error(`No pude conectar con Steam (${nombreError(e)}). Revisa tu conexión a Internet y vuelve a intentarlo.`);
				} else {
					log.error(`Steam no permitió iniciar sesión (${nombreError(e)}).`);
				}
				return false;
			}
		}
		log.error('Demasiados intentos fallidos. Espera un rato antes de volver a intentarlo, para que Steam no te bloquee.');
		return false;
	}

	const guardada = sesion.leerSesion(rutaSesion);
	let dentro = false;
	if (guardada && sesion.llaveUsable(guardada.refreshToken)) {
		const resultado = await entrarConLlave(guardada);
		if (resultado === 'salir') {
			await cerrarSteam();
			return 1;
		}
		dentro = resultado === 'ok';
	} else if (guardada) {
		log.aviso('La sesión guardada venció. Vuelve a iniciar sesión.');
		sesion.borrarSesion(rutaSesion);
	}
	if (!dentro) dentro = await entrarConContrasena();
	if (!dentro) {
		await cerrarSteam();
		return 1;
	}

	estado.dentro = true;
	log.ok(`Sesión iniciada${estado.usuario ? ` en la cuenta ${estado.usuario}` : ''}.`);
	if (estado.recordar) log.info('La sesión quedó guardada en esta PC. Para borrarla usa "Borrar sesion guardada.bat".');
	log.info('Deja esta ventana abierta (puedes minimizarla). Para detener el farmeo, ciérrala.');

	const resultado = await farmeador.ejecutar();
	estado.saliendo = true;
	await cerrarSteam();
	if (resultado === 'completo') log.info('Ya puedes cerrar esta ventana.');
	return 0;
}

module.exports = { main };

if (require.main === module) {
	process.on('unhandledRejection', (e) => {
		console.error('Error inesperado:', e && e.stack ? e.stack : e);
	});
	main().then(
		(codigo) => process.exit(codigo),
		(e) => {
			console.error('Error inesperado:', e && e.stack ? e.stack : e);
			process.exit(1);
		}
	);
}
