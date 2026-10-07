'use strict';
// Prueba de seguridad de las consultas web: las cookies de la sesión solo viajan a
// https://steamcommunity.com, nunca a otro sitio ni sin cifrar.
const assert = require('assert');
const { EventEmitter } = require('events');
const { WebSteam, SesionWebVencida } = require('../programa/lib/web');

const HTML_OK = '<script>g_steamID = "76561198000000001";</script><div class="badge_title_stats_content"><span class="progress_info_bold">2 card drops remaining</span></div>';

function respuesta(status, { location, body = '' } = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (h) => (h.toLowerCase() === 'location' ? location || null : null) },
		text: async () => body,
		arrayBuffer: async () => new ArrayBuffer(0),
	};
}

/** fetch falso: responde según la URL y anota a dónde se mandó cada cookie */
function crearWeb(rutas) {
	const pedidos = [];
	const cliente = new EventEmitter();
	cliente.webLogOn = () => setImmediate(() => cliente.emit('webSession', 'sid', ['steamLoginSecure=NUEVA; Path=/; Secure']));
	const fetchImpl = async (url, opciones) => {
		const u = String(url);
		pedidos.push({ url: u, cookie: opciones.headers.Cookie, redirect: opciones.redirect });
		const r = rutas(u, pedidos.length);
		if (!r) throw new Error(`pedido inesperado a ${u}`);
		return r;
	};
	const web = new WebSteam({ cliente, log: {}, fetchImpl, esperar: async () => {} });
	cliente.emit('webSession', 'sid', ['sessionid=abc; Path=/', 'steamLoginSecure=SECRETO; Path=/; Secure; HttpOnly']);
	return { web, pedidos, cliente };
}

(async () => {
	// 1) Caso normal: la cookie va solo a steamcommunity.com por https, y sin seguir redirecciones solo
	{
		const { web, pedidos } = crearWeb((u) =>
			u.startsWith('https://steamcommunity.com/my/gamecards/620')
				? respuesta(302, { location: '/profiles/76561198000000001/gamecards/620/' })
				: u === 'https://steamcommunity.com/profiles/76561198000000001/gamecards/620/'
					? respuesta(200, { body: HTML_OK })
					: null
		);
		const info = await web.obtenerJuego(620);
		assert.strictEqual(info.restantes, 2);
		assert.ok(pedidos.every((p) => p.url.startsWith('https://steamcommunity.com/')));
		assert.ok(pedidos.every((p) => p.redirect === 'manual'), 'las redirecciones se revisan una por una');
		assert.strictEqual(pedidos[0].cookie, 'sessionid=abc; steamLoginSecure=SECRETO', 'solo nombre=valor, sin atributos');
	}

	// 2) Redirección a otro sitio: no se sigue (la cookie no sale de Steam)
	{
		const { web, pedidos } = crearWeb((u, n) => (n === 1 ? respuesta(302, { location: 'https://sitio-malo.example/robar' }) : null));
		await assert.rejects(web.obtenerJuego(620), /dirección no permitida \(https:\/\/sitio-malo\.example\)/);
		assert.strictEqual(pedidos.length, 1);
	}

	// 3) Redirección al mismo dominio pero sin cifrar (http): tampoco
	{
		const { web, pedidos } = crearWeb((u, n) => (n === 1 ? respuesta(302, { location: 'http://steamcommunity.com/my/gamecards/620' }) : null));
		await assert.rejects(web.obtenerJuego(620), /dirección no permitida \(http:\/\/steamcommunity\.com\)/);
		assert.strictEqual(pedidos.length, 1);
	}

	// 4) Subdominio parecido: tampoco
	{
		const { web, pedidos } = crearWeb((u, n) => (n === 1 ? respuesta(302, { location: 'https://steamcommunity.com.sitio-malo.example/' }) : null));
		await assert.rejects(web.obtenerJuego(620), /dirección no permitida/);
		assert.strictEqual(pedidos.length, 1);
	}

	// 5) Sesión web vencida (Steam manda al login): se pide una sesión nueva y se reintenta una vez
	{
		const { web, pedidos } = crearWeb((u, n) =>
			n === 1 ? respuesta(302, { location: 'https://steamcommunity.com/login/home/?goto=my' }) : respuesta(200, { body: HTML_OK })
		);
		const info = await web.obtenerJuego(620);
		assert.strictEqual(info.restantes, 2);
		assert.strictEqual(pedidos[1].cookie, 'steamLoginSecure=NUEVA', 'el reintento usa la sesión nueva');
	}

	// 6) Si tampoco sirve la sesión nueva, se rinde (no queda en un bucle)
	{
		const { web, pedidos } = crearWeb(() => respuesta(302, { location: '/login/home/' }));
		await assert.rejects(web.obtenerJuego(620), SesionWebVencida);
		assert.strictEqual(pedidos.length, 2);
	}

	console.log('probar-web: OK (todas las comprobaciones pasaron)');
})().catch((e) => {
	console.error('FALLÓ:', e);
	process.exit(1);
});
