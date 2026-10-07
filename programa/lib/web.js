'use strict';
// Consultas a steamcommunity.com con la sesión web que entrega steam-user.

const { parsearInsignias, parsearJuego, estadoSesion } = require('./insignias');

const BASE = 'https://steamcommunity.com';
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

class SesionWebVencida extends Error {}

class WebSteam {
	constructor({ cliente, log, base = BASE, fetchImpl = globalThis.fetch, esperar = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
		this.cliente = cliente;
		this.log = log;
		this.base = new URL(base);
		this.fetch = fetchImpl;
		this.esperar = esperar;
		this.cookies = '';
		this._esperando = new Set();

		cliente.on('webSession', (_sessionID, cookies) => {
			this.cookies = (cookies || []).map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
			for (const listo of this._esperando) listo();
			this._esperando.clear();
		});
	}

	_esperarSesionNueva(ms) {
		return new Promise((resolve, reject) => {
			const listo = () => {
				clearTimeout(t);
				resolve();
			};
			const t = setTimeout(() => {
				this._esperando.delete(listo);
				reject(new Error('Steam no entregó la sesión web a tiempo'));
			}, ms);
			this._esperando.add(listo);
		});
	}

	async _pedirHtml(ruta) {
		let url = new URL(ruta, this.base);
		for (let saltos = 0; saltos < 6; saltos++) {
			const res = await this.fetch(url, {
				redirect: 'manual', // así se ve si Steam nos manda a la página de inicio de sesión
				headers: { Cookie: this.cookies, 'User-Agent': AGENTE, Accept: 'text/html' },
				signal: AbortSignal.timeout(30000),
			});

			if (res.status >= 300 && res.status < 400) {
				const destino = res.headers.get('location');
				await res.arrayBuffer().catch(() => {});
				if (!destino) throw new Error(`Steam respondió HTTP ${res.status} sin destino`);
				url = new URL(destino, url);
				if (/\/login(\/|$)/.test(url.pathname)) throw new SesionWebVencida('la sesión web venció');
				// Las cookies de la sesión solo viajan a Steam y siempre cifradas: nada de otros sitios ni de http
				if (url.host !== this.base.host || url.protocol !== this.base.protocol) {
					const e = new Error(`Steam redirigió a una dirección no permitida (${url.protocol}//${url.host})`);
					e.sinReintento = true; // no es un fallo pasajero: reintentar no sirve
					throw e;
				}
				continue;
			}
			if (res.status === 429) {
				const e = new Error('Steam pidió bajar el ritmo de consultas');
				e.esperaLarga = true;
				throw e;
			}
			if (!res.ok) throw new Error(`Steam respondió HTTP ${res.status}`);

			const html = await res.text();
			if (estadoSesion(html) === 'fuera') throw new SesionWebVencida('la sesión web venció');
			return html;
		}
		throw new Error('demasiadas redirecciones');
	}

	async _pedir(ruta) {
		let renovada = false;
		for (let intento = 1; ; intento++) {
			try {
				if (!this.cookies) await this._esperarSesionNueva(90000);
				return await this._pedirHtml(ruta);
			} catch (e) {
				if (e instanceof SesionWebVencida && !renovada) {
					renovada = true;
					const nueva = this._esperarSesionNueva(60000);
					try {
						this.cliente.webLogOn();
					} catch {
						// si no hay conexión con Steam, el intento de abajo fallará y se reintentará más tarde
					}
					await nueva;
					continue;
				}
				if (e instanceof SesionWebVencida || e.sinReintento || intento >= 3) throw e;
				await this.esperar(e.esperaLarga ? 60000 : 5000 * intento);
			}
		}
	}

	/** Todos los juegos de todas las páginas de insignias. */
	async obtenerInsignias() {
		const primera = parsearInsignias(await this._pedir('/my/badges?l=english&p=1'));
		const porAppid = new Map(primera.juegos.map((j) => [j.appid, j]));
		for (let p = 2; p <= primera.paginas; p++) {
			const pagina = parsearInsignias(await this._pedir(`/my/badges?l=english&p=${p}`));
			for (const j of pagina.juegos) if (!porAppid.has(j.appid)) porAppid.set(j.appid, j);
		}
		return [...porAppid.values()];
	}

	/** Cromos que le quedan por soltar a un juego: { restantes, horas, nombre } */
	async obtenerJuego(appid) {
		const info = parsearJuego(await this._pedir(`/my/gamecards/${appid}?l=english`));
		if (!info) throw new Error('la página del juego no muestra sus cromos');
		return info;
	}
}

module.exports = { WebSteam, SesionWebVencida };
