'use strict';
// Prueba completa del farmeo contra un Steam simulado (tiempo acelerado).
// Uso: node probar-farmeo.js        (VERBOSE=1 para ver los mensajes del farmeador)

const assert = require('assert');
const { Farmeador } = require('../programa/lib/farmeo');
const { WebSteam } = require('../programa/lib/web');
const { SteamFalso, servidorWeb, crearCuenta, relojRapido } = require('./steam-simulado');

const H = 3600000;

function logCapturado(prefijo) {
	const lineas = [];
	const tipo = (t) => (texto) => {
		lineas.push(`${t}: ${texto}`);
		if (process.env.VERBOSE) console.log(`   [${prefijo}] ${t}: ${texto}`);
	};
	return { lineas, info: tipo('info'), ok: tipo('ok'), cromo: tipo('cromo'), juego: tipo('juego'), aviso: tipo('aviso'), error: tipo('error'), titulo: () => {} };
}

async function escenario(nombre, { cuenta: datos, config = {}, acciones = [], bloqueadoAlEntrar = false, limiteHoras = 60 }) {
	const cuenta = crearCuenta(datos);
	const reloj = relojRapido(cuenta.velocidad);
	const cliente = new SteamFalso(cuenta, reloj);
	const servidor = await servidorWeb(cuenta, cliente);
	const log = logCapturado(nombre);
	const web = new WebSteam({ cliente, log, base: `http://127.0.0.1:${servidor.address().port}`, esperar: reloj.dormir });
	const farmeador = new Farmeador({
		cliente,
		web,
		log,
		reloj,
		config: { horasMinimas: 0, minutosEntreRevisiones: 15, horasMaximasSinCromo: 5, aparecerEnLinea: false, excluir: [], soloEstos: [], segundosTrasJugar: 60, ...config },
	});

	cliente.bloqueado = bloqueadoAlEntrar;
	cuenta.llaveValida = 'llave-de-prueba';
	const entrada = new Promise((r) => cliente.once('loggedOn', r));
	cliente.logOn({ refreshToken: 'llave-de-prueba', machineName: 'x', logonID: 1 });
	await entrada;

	const inicio = reloj.ahora();
	const marcas = {};
	for (const a of acciones) {
		reloj.programar(() => {
			marcas[a.nombre] = reloj.ahora() - inicio;
			a.hacer(cliente, cuenta);
		}, a.enHoras * H);
	}

	let limite;
	const resultado = await Promise.race([
		farmeador.ejecutar(),
		new Promise((_, rechazar) => {
			limite = reloj.programar(() => rechazar(new Error(`${nombre}: no terminó en ${limiteHoras} h simuladas`)), limiteHoras * H);
		}),
	]).finally(() => {
		reloj.cancelar(limite);
		farmeador.detener();
		cliente.destruir();
		servidor.close();
	});

	const horas = (reloj.ahora() - inicio) / H;
	const llamadas = cliente.llamadas.map((l) => ({ ...l, t: (l.t - inicio) / H }));
	return { cuenta, cliente, log, resultado, horas, llamadas, marcas: Object.fromEntries(Object.entries(marcas).map(([k, v]) => [k, v / H])), farmeador };
}

function comun(r) {
	assert.ok(r.llamadas.every((l) => !l.force), 'nunca usa "force" (no te saca de tus juegos)');
	assert.ok(r.llamadas.every((l) => l.conectado), 'no manda juegos sin conexión');
	assert.ok(r.llamadas.every((l) => !l.bloqueado), 'no manda juegos mientras juegas en otro lado');
	assert.ok(r.cliente.maxJugandoALaVez <= 32, 'nunca más de 32 juegos a la vez');
	assert.ok(r.cuenta.caidas.every((c) => c.jugandoALaVez === 1));
}

async function probar(nombre, fn) {
	const t = Date.now();
	await fn();
	console.log(`OK  ${nombre} (${((Date.now() - t) / 1000).toFixed(1)} s reales)`);
}

(async () => {
	await probar('A: cuenta normal, de a un juego, salta los que no tienen cromos', async () => {
		const r = await escenario('A', {
			cuenta: {
				juegos: [
					{ appid: 10, nombre: 'Portal 2', restantes: 2, horas: 5 },
					{ appid: 20, nombre: 'Celeste', restantes: 3, horas: 0 },
					{ appid: 30, nombre: 'Hades', restantes: 1, horas: 0.5 },
					{ appid: 40, nombre: 'Terraria', restantes: 0, horas: 50 },
					{ appid: 50, nombre: 'Stardew Valley', restantes: 2, horas: 0 },
				],
			},
		});
		comun(r);
		assert.strictEqual(r.resultado, 'completo');
		for (const j of r.cuenta.juegos.values()) assert.strictEqual(j.restantes, 0, `${j.nombre} terminó`);
		assert.strictEqual(r.cuenta.caidas.length, 8);
		assert.ok(r.llamadas.every((l) => l.apps.length <= 1), 'en modo simple juega de a uno');
		assert.ok(!r.llamadas.some((l) => l.apps.includes(40)), 'no juega Terraria (sin cromos)');
		assert.ok(r.horas < 8 * 0.5 + 1, `tiempo razonable (${r.horas.toFixed(2)} h)`);
		assert.deepStrictEqual(r.llamadas[r.llamadas.length - 1].apps, [], 'al final deja de "jugar"');
		assert.ok(r.log.lineas.some((l) => l.startsWith('ok: ¡Listo! Conseguiste 8 cromos')));
	});

	await probar('B: cuenta restringida (3 h), 37 juegos: suma horas en grupos de 32 y luego farmea', async () => {
		const juegos = [{ appid: 2000, nombre: 'Ya jugado', restantes: 2, horas: 10 }];
		for (let i = 1; i <= 36; i++) juegos.push({ appid: 1000 + i, nombre: `Juego ${i}`, restantes: 1, horas: (i % 7) * 0.4 });
		const r = await escenario('B', { cuenta: { juegos, horasRestriccion: 3, velocidad: 7200 }, config: { horasMinimas: 3 } });
		comun(r);
		assert.strictEqual(r.resultado, 'completo');
		for (const j of r.cuenta.juegos.values()) assert.strictEqual(j.restantes, 0, `${j.nombre} terminó`);
		assert.deepStrictEqual(r.llamadas.find((l) => l.apps.length).apps, [2000], 'primero el que ya pasó las 3 h');
		assert.strictEqual(r.cliente.maxJugandoALaVez, 32, 'usa grupos de 32');
		// sin el modo grupo serían 36 juegos x ~3 h de espera cada uno
		assert.ok(r.horas < 26, `tiempo razonable (${r.horas.toFixed(1)} h; de a uno serían más de 120 h)`);
	});

	await probar('C: pausa si juegas, sesión web vencida, corte de conexión y errores del servidor', async () => {
		const r = await escenario('C', {
			cuenta: {
				juegos: [
					{ appid: 10, nombre: 'Portal 2', restantes: 4, horas: 1 },
					{ appid: 20, nombre: 'Celeste', restantes: 3, horas: 0 },
					{ appid: 30, nombre: 'Hades', restantes: 2, horas: 0 },
				],
			},
			acciones: [
				{ nombre: 'juega', enHoras: 0.6, hacer: (c) => c.usuarioEmpiezaAJugar() },
				{ nombre: 'deja', enHoras: 1.5, hacer: (c) => c.usuarioDejaDeJugar() },
				{ nombre: 'venceWeb', enHoras: 2.2, hacer: (c, cu) => (cu.cookie = 'otra-cookie') },
				{ nombre: 'corte', enHoras: 3.0, hacer: (c) => c.cortarConexion(10 * 60000) },
				{ nombre: 'fallos', enHoras: 3.6, hacer: (c, cu) => (cu.fallarProximas = 2) },
			],
		});
		comun(r);
		assert.strictEqual(r.resultado, 'completo');
		for (const j of r.cuenta.juegos.values()) assert.strictEqual(j.restantes, 0, `${j.nombre} terminó`);
		const durantePausa = r.llamadas.filter((l) => l.t > r.marcas.juega && l.t < r.marcas.deja);
		assert.strictEqual(durantePausa.length, 0, 'no toca nada mientras juegas');
		const retoma = r.llamadas.find((l) => l.t > r.marcas.deja && l.apps.length);
		const espera = (retoma.t - r.marcas.deja) * 3600;
		// margen por la imprecisión de los temporizadores con el tiempo acelerado 3600x (1 ms real = 3,6 s)
		assert.ok(espera >= 50 && espera < 120, `retoma ~1 min después de que dejas de jugar (${espera.toFixed(0)} s)`);
		assert.ok(r.cuenta.renovacionesWeb >= 1, 'renovó la sesión web');
		assert.strictEqual(r.cuenta.fallosServidos, 2, 'se recuperó de los errores del servidor');
		const trasCorte = r.llamadas.filter((l) => l.t > r.marcas.corte - 0.1 && l.t < r.marcas.corte + 1).map((l) => `${((l.t - r.marcas.corte) * 60).toFixed(2)}min:${l.apps}`);
		assert.ok(r.llamadas.some((l) => l.t > r.marcas.corte + 9.5 / 60 && l.t < r.marcas.corte + 15 / 60 && l.apps.length), `vuelve a jugar al reconectar ${trasCorte.join(' ')} | ${r.log.lineas.slice(-12).join(' / ')}`);
		assert.ok(r.log.lineas.some((l) => l.includes('Estás jugando en Steam')));
		assert.ok(r.log.lineas.some((l) => l.includes('Cerraste el juego')));
		assert.ok(!r.log.lineas.some((l) => l.startsWith('error:')), 'sin errores en el log');
	});

	await probar('D: juego que no suelta cromos y juego con datos contradictorios de Steam', async () => {
		const r = await escenario('D', {
			cuenta: {
				juegos: [
					{ appid: 50, nombre: 'Privado', restantes: 2, privado: true },
					{ appid: 60, nombre: 'Contradictorio', restantes: 0, restantesEnInsignias: 2 },
					{ appid: 70, nombre: 'Normal', restantes: 1 },
				],
			},
			config: { horasMaximasSinCromo: 2 },
		});
		comun(r);
		assert.strictEqual(r.resultado, 'completo');
		assert.strictEqual(r.cuenta.juegos.get(70).restantes, 0);
		assert.deepStrictEqual([...r.farmeador.postergados.keys()].sort(), [50, 60]);
		const privado = r.llamadas.filter((l) => l.apps[0] === 50);
		assert.ok(privado.length >= 1);
		assert.ok(r.log.lineas.some((l) => l.includes('Privado lleva 2 h') && l.includes('sin soltar cromos')));
		assert.ok(r.log.lineas.some((l) => l.includes('los salté: Privado, Contradictorio') || l.includes('los salté: Contradictorio, Privado')));
		assert.ok(r.horas < 5, `no se queda pegado (${r.horas.toFixed(1)} h)`);
	});

	await probar('E: respeta "excluir" y "soloEstos" de config.json', async () => {
		const juegos = () => [
			{ appid: 10, nombre: 'Uno', restantes: 1 },
			{ appid: 20, nombre: 'Dos', restantes: 1 },
			{ appid: 30, nombre: 'Tres', restantes: 1 },
		];
		const excl = await escenario('E1', { cuenta: { juegos: juegos() }, config: { excluir: [20] } });
		comun(excl);
		assert.ok(!excl.llamadas.some((l) => l.apps.includes(20)));
		assert.strictEqual(excl.cuenta.juegos.get(20).restantes, 1);
		const solo = await escenario('E2', { cuenta: { juegos: juegos() }, config: { soloEstos: [30] } });
		comun(solo);
		assert.ok(solo.llamadas.every((l) => l.apps.length === 0 || l.apps[0] === 30));
		assert.strictEqual(solo.cuenta.juegos.get(30).restantes, 0);
	});

	await probar('F: ya estabas jugando cuando se abrió el farmeador', async () => {
		const r = await escenario('F', {
			cuenta: { juegos: [{ appid: 10, nombre: 'Uno', restantes: 1 }] },
			bloqueadoAlEntrar: true,
			acciones: [{ nombre: 'deja', enHoras: 0.5, hacer: (c) => c.usuarioDejaDeJugar() }],
		});
		comun(r);
		assert.strictEqual(r.resultado, 'completo');
		const primera = r.llamadas.find((l) => l.apps.length);
		assert.ok(primera.t >= 0.5 + 50 / 3600, "espera a que termines de jugar");
	});

	await probar('G: se corta la conexión mientras juegas: no retoma hasta que cierres el juego', async () => {
		const r = await escenario('G', {
			cuenta: { juegos: [{ appid: 10, nombre: 'Uno', restantes: 2 }] },
			acciones: [
				{ nombre: 'juega', enHoras: 0.3, hacer: (c) => c.usuarioEmpiezaAJugar() },
				{ nombre: 'corte', enHoras: 0.5, hacer: (c) => c.cortarConexion(10 * 60000) },
				{ nombre: 'deja', enHoras: 1.2, hacer: (c) => c.usuarioDejaDeJugar() },
			],
		});
		comun(r);
		assert.strictEqual(r.resultado, 'completo');
		assert.strictEqual(r.llamadas.filter((l) => l.t > r.marcas.juega && l.t < r.marcas.deja).length, 0, 'no juega mientras juegas');
		assert.strictEqual(r.log.lineas.filter((l) => l.includes('Cerraste el juego')).length, 1, 'avisa una sola vez, al cerrar el juego');
	});

	console.log('\nprobar-farmeo: todas las pruebas pasaron');
	process.exit(0);
})().catch((e) => {
	console.error('FALLÓ:', e);
	process.exit(1);
});
