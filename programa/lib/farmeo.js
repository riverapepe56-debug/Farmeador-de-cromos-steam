'use strict';
// Lógica del farmeo. No toca la consola ni la red directamente: recibe el
// cliente de Steam, la web y el log, así se puede probar con un Steam simulado.
//
// Algoritmo (el mismo que usa ArchiSteamFarm):
//  - Los cromos solo caen jugando UN juego a la vez (cada ~30 min).
//  - En muchas cuentas Steam no suelta cromos hasta que el juego tiene
//    "horasMinimas" horas (normalmente 3). Esos juegos se juegan en grupo
//    (hasta 32 a la vez) solo para sumarles horas, y luego se farmean de a uno.

const MAX_JUEGOS_A_LA_VEZ = 32;
const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const MINUTOS_POR_CROMO = 30; // promedio, solo para el tiempo estimado

const relojReal = {
	ahora: () => Date.now(),
	programar: (fn, ms) => setTimeout(fn, ms),
	cancelar: (t) => clearTimeout(t),
};

function plural(n, uno, varios) {
	return `${n} ${n === 1 ? uno : varios}`;
}

function leQuedan(n) {
	return n === 1 ? 'le queda 1 cromo' : `le quedan ${n} cromos`;
}

function duracion(ms) {
	const min = Math.round(ms / MINUTO);
	if (min < 1) return 'menos de 1 min';
	const h = Math.floor(min / 60);
	const m = min % 60;
	if (!h) return `${m} min`;
	return m ? `${h} h ${m} min` : `${h} h`;
}

function horasTexto(h) {
	return `${(Math.floor(h * 10) / 10).toLocaleString('es')} h`;
}

class Farmeador {
	constructor({ cliente, web, config, log, reloj = relojReal }) {
		this.cliente = cliente;
		this.web = web;
		this.config = config;
		this.log = log;
		this.reloj = reloj;

		this.conectado = false;
		this.bloqueado = false;
		this.detenido = false;
		this.juegosDeseados = [];
		this.juegosAplicados = null;
		this._despertador = null;
		this._retomarTrasJuego = false; // hay que esperar un minuto antes de volver a jugar
		this._retomarEn = 0;
		this._grupoExplicado = false;

		this.horasLocales = new Map(); // appid -> horas contadas por nosotros
		this.postergados = new Map(); // appid -> nombre (juegos que no sueltan cromos)
		this.terminados = new Map(); // appid -> veces que Steam dijo "sin cromos"
		this.cromosConseguidos = 0;

		// El ciclo principal es el único que le dice a Steam qué jugar; los eventos solo lo despiertan.
		cliente.on('loggedOn', () => {
			this.conectado = true;
			this.bloqueado = false; // si sigues jugando, Steam lo avisa justo después
			this.juegosAplicados = null;
			this._despertar('conexion');
		});
		cliente.on('disconnected', () => this._perderConexion());
		cliente.on('error', () => this._perderConexion());
		cliente.on('playingState', (bloqueado) => {
			bloqueado = Boolean(bloqueado);
			if (bloqueado === this.bloqueado) return;
			this.bloqueado = bloqueado;
			this.juegosAplicados = null;
			if (!this.detenido) {
				if (bloqueado) {
					this._retomarTrasJuego = true;
					this._retomarEn = 0;
					this.log.aviso('Estás jugando en Steam. El farmeo queda en pausa hasta que cierres el juego.');
					this.log.titulo('En pausa (estás jugando)');
				} else if (this._retomarTrasJuego) {
					// Como ASF: un minuto de margen por si solo estás cambiando de juego
					this._retomarEn = this.reloj.ahora() + this.config.segundosTrasJugar * SEGUNDO;
					this.log.info('Cerraste el juego. Retomo el farmeo en 1 minuto.');
				}
			}
			this._despertar('bloqueo');
		});
		cliente.on('newItems', (cantidad) => {
			if (cantidad > 0) this._despertar('items');
		});
	}

	_perderConexion() {
		this.conectado = false;
		this.juegosAplicados = null;
		this._despertar('conexion');
	}

	// ---- control de lo que Steam cree que estamos jugando ----

	_aplicarJuegos() {
		if (!this.conectado || this.bloqueado) return;
		const clave = this.juegosDeseados.join(',');
		if (clave === this.juegosAplicados) return;
		// null = sesión nueva o recién desbloqueada: Steam ya cree que no jugamos nada
		if (this.juegosAplicados === null && clave === '') {
			this.juegosAplicados = '';
			return;
		}
		// Nunca se usa "force": jamás te saca de un juego que estés jugando tú.
		this.cliente.gamesPlayed(this.juegosDeseados.slice());
		this.juegosAplicados = clave;
	}

	_jugar(appids) {
		this.juegosDeseados = appids;
		this._aplicarJuegos();
	}

	// ---- esperas que se pueden interrumpir ----

	_dormir(ms) {
		return new Promise((resolve) => {
			const t = this.reloj.programar(() => {
				this._despertador = null;
				resolve('tiempo');
			}, Math.max(0, ms));
			this._despertador = (motivo) => {
				this.reloj.cancelar(t);
				this._despertador = null;
				resolve(motivo);
			};
		});
	}

	_despertar(motivo) {
		if (this._despertador) this._despertador(motivo);
	}

	/** Espera a estar conectado y sin que estés jugando en otro lado. false = se detuvo. */
	async _esperarDisponible() {
		while (!this.detenido) {
			if (!this.conectado || this.bloqueado) {
				await this._dormir(HORA); // lo despierta la reconexión o el aviso de Steam
				continue;
			}
			if (this._retomarTrasJuego) {
				if (!this._retomarEn) this._retomarEn = this.reloj.ahora() + this.config.segundosTrasJugar * SEGUNDO;
				const falta = this._retomarEn - this.reloj.ahora();
				if (falta > 0) {
					await this._dormir(falta);
					continue;
				}
				this._retomarTrasJuego = false;
				this._retomarEn = 0;
				continue;
			}
			return true;
		}
		return false;
	}

	detener() {
		this.detenido = true;
		this.juegosDeseados = [];
		if (this.conectado && !this.bloqueado) {
			try {
				this.cliente.gamesPlayed([]);
			} catch {
				// da igual: al cerrar la sesión Steam deja de contarlo como jugando
			}
		}
		this._despertar('detener');
	}

	// ---- lista de juegos ----

	_filtrar(juegos) {
		const excluir = new Set(this.config.excluir);
		const soloEstos = new Set(this.config.soloEstos);
		const lista = [];
		for (const j of juegos) {
			if (j.restantes <= 0 || excluir.has(j.appid)) continue;
			if (soloEstos.size && !soloEstos.has(j.appid)) continue;
			if (this.postergados.has(j.appid)) continue;
			if ((this.terminados.get(j.appid) || 0) >= 2) {
				// Steam dice que le quedan cromos en un lado y que no en otro: no insistir
				this.postergados.set(j.appid, j.nombre);
				continue;
			}
			lista.push({ ...j, horas: Math.max(j.horas, this.horasLocales.get(j.appid) || 0) });
		}
		return lista;
	}

	async _escanear() {
		while (!this.detenido) {
			try {
				this.log.info('Revisando tus insignias de Steam...');
				return this._filtrar(await this.web.obtenerInsignias());
			} catch (e) {
				this.log.aviso(`No pude revisar tus insignias (${e.message}). Reintento en 5 minutos.`);
				await this._dormir(5 * MINUTO);
			}
		}
		return null;
	}

	_estimado(lista) {
		const min = this.config.horasMinimas;
		let ms = lista.reduce((s, j) => s + j.restantes, 0) * MINUTOS_POR_CROMO * MINUTO;
		const bajas = lista.filter((j) => j.horas < min).map((j) => j.horas).sort((a, b) => a - b);
		for (let i = 0; i < bajas.length; i += MAX_JUEGOS_A_LA_VEZ) ms += (min - bajas[i]) * HORA;
		return ms;
	}

	_anunciar(lista) {
		const cromos = lista.reduce((s, j) => s + j.restantes, 0);
		this.log.ok(`Tienes ${plural(lista.length, 'juego', 'juegos')} con ${plural(cromos, 'cromo', 'cromos')} por conseguir (tiempo estimado: ${duracion(this._estimado(lista))} aprox.).`);
		const muestra = lista.slice().sort((a, b) => b.restantes - a.restantes).slice(0, 8);
		const resto = lista.length - muestra.length;
		this.log.info(`  ${muestra.map((j) => `${j.nombre} (${j.restantes})`).join(', ')}${resto > 0 ? ` y ${resto} más` : ''}`);
		const min = this.config.horasMinimas;
		const bajas = lista.filter((j) => j.horas < min);
		if (min > 0 && bajas.length === 1) {
			this.log.info(`  ${bajas[0].nombre} tiene menos de ${horasTexto(min)} de juego: primero le sumo horas, porque en muchas cuentas Steam no suelta cromos antes.`);
		} else if (min > 0 && bajas.length > 1) {
			this.log.info(`  ${bajas.length} juegos tienen menos de ${horasTexto(min)} de juego: primero les sumo horas en grupo (hasta 32 a la vez), porque en muchas cuentas Steam no suelta cromos antes.`);
		}
	}

	_elegir(listos) {
		// Primero los que están a punto de terminar: así ves resultados antes
		return listos.slice().sort((a, b) => a.restantes - b.restantes || b.horas - a.horas)[0];
	}

	// ---- farmeo ----

	async _consultar(juego) {
		try {
			return await this.web.obtenerJuego(juego.appid);
		} catch (e) {
			this.log.aviso(`No pude revisar los cromos de ${juego.nombre} (${e.message}). Sigo y reviso más tarde.`);
			return null;
		}
	}

	async _farmearSolo(juego) {
		const intervalo = this.config.minutosEntreRevisiones * MINUTO;
		const limite = this.config.horasMaximasSinCromo * HORA;
		let sinCromo = 0;
		let anunciado = false;

		while (!this.detenido) {
			if (!(await this._esperarDisponible())) break;
			if (!anunciado) {
				this.log.juego(`Jugando: ${juego.nombre} (${leQuedan(juego.restantes)})`);
				anunciado = true;
			}
			this.log.titulo(`${juego.nombre} - ${leQuedan(juego.restantes)}`);
			this._jugar([juego.appid]);

			const inicio = this.reloj.ahora();
			let motivo = await this._dormir(intervalo);
			const jugado = this.reloj.ahora() - inicio;
			juego.horas += jugado / HORA;
			sinCromo += jugado;
			this.horasLocales.set(juego.appid, juego.horas);

			if (this.detenido) break;
			if (motivo === 'bloqueo' || motivo === 'conexion') continue;
			if (motivo === 'items') {
				// Llegó algo nuevo al inventario: esperar unos segundos a que Steam actualice la página
				motivo = await this._dormir(5 * SEGUNDO);
				if (motivo === 'bloqueo' || motivo === 'conexion' || motivo === 'detener') continue;
			}

			const info = await this._consultar(juego);
			if (info) {
				if (info.restantes < juego.restantes) {
					const caidos = juego.restantes - info.restantes;
					this.cromosConseguidos += caidos;
					sinCromo = 0;
					const quedan = info.restantes ? ` L${leQuedan(info.restantes).slice(1)}.` : '';
					this.log.cromo(`¡${caidos === 1 ? 'Cayó un cromo' : `Cayeron ${caidos} cromos`} de ${juego.nombre}!${quedan}`);
				}
				juego.restantes = info.restantes;
				if (info.horas > juego.horas) {
					juego.horas = info.horas;
					this.horasLocales.set(juego.appid, juego.horas);
				}
				if (juego.restantes === 0) {
					this.log.ok(`${juego.nombre}: listo, ya soltó todos sus cromos.`);
					return 'terminado';
				}
			}
			if (sinCromo >= limite) {
				this.log.aviso(`${juego.nombre} lleva ${duracion(sinCromo)} sin soltar cromos. Lo salto por ahora.`);
				return 'postergado';
			}
		}
		return 'detenido';
	}

	async _farmearGrupo(juegos) {
		const min = this.config.horasMinimas;
		const intervalo = this.config.minutosEntreRevisiones * MINUTO;
		let anunciado = false;

		while (!this.detenido) {
			const maxHoras = Math.max(...juegos.map((j) => j.horas));
			if (maxHoras >= min) return 'listo';
			if (!(await this._esperarDisponible())) break;

			const falta = (min - maxHoras) * HORA;
			if (!anunciado) {
				if (juegos.length === 1) {
					this.log.juego(`Sumando horas a ${juegos[0].nombre} hasta las ${horasTexto(min)} de juego (faltan unos ${duracion(falta)}); ahí empieza a soltar cromos.`);
				} else if (!this._grupoExplicado) {
					const nombres = juegos.slice(0, 4).map((j) => j.nombre).join(', ');
					const resto = juegos.length > 4 ? ` y ${juegos.length - 4} más` : '';
					this.log.juego(`Sumando horas a ${juegos.length} juegos a la vez hasta las ${horasTexto(min)} de juego: ${nombres}${resto}.`);
					this.log.info(`  El primero llega en unos ${duracion(falta)}; ahí empiezan los cromos.`);
					this._grupoExplicado = true;
				} else {
					this.log.juego(`Sumando horas a ${juegos.length} juegos a la vez; el siguiente llega a las ${horasTexto(min)} en unos ${duracion(falta)}.`);
				}
				anunciado = true;
			}
			this.log.titulo(`Sumando horas a ${juegos.length} juegos - faltan ${duracion(falta)}`);
			this._jugar(juegos.map((j) => j.appid));

			const inicio = this.reloj.ahora();
			await this._dormir(Math.min(intervalo, falta) + 15 * SEGUNDO);
			const jugado = (this.reloj.ahora() - inicio) / HORA;
			for (const j of juegos) {
				j.horas += jugado;
				this.horasLocales.set(j.appid, j.horas);
			}
		}
		return 'detenido';
	}

	/** Farmea hasta que no queden cromos. Devuelve 'completo' o 'detenido'. */
	async ejecutar() {
		while (!this.detenido) {
			const lista = await this._escanear();
			if (!lista) break;
			if (lista.length === 0) {
				this._jugar([]);
				this._resumen();
				return 'completo';
			}
			this._anunciar(lista);

			while (lista.length && !this.detenido) {
				const listos = lista.filter((j) => j.horas >= this.config.horasMinimas);
				if (listos.length) {
					const juego = this._elegir(listos);
					const resultado = await this._farmearSolo(juego);
					if (resultado === 'detenido') break;
					lista.splice(lista.indexOf(juego), 1);
					if (resultado === 'postergado') this.postergados.set(juego.appid, juego.nombre);
					if (resultado === 'terminado') this.terminados.set(juego.appid, (this.terminados.get(juego.appid) || 0) + 1);
				} else {
					const grupo = lista.slice().sort((a, b) => b.horas - a.horas).slice(0, MAX_JUEGOS_A_LA_VEZ);
					if ((await this._farmearGrupo(grupo)) === 'detenido') break;
				}
			}
		}
		this._jugar([]);
		return 'detenido';
	}

	_resumen() {
		this.log.titulo('Terminado');
		if (this.cromosConseguidos) {
			this.log.ok(`¡Listo! Conseguiste ${plural(this.cromosConseguidos, 'cromo', 'cromos')} en esta sesión. Están en tu inventario de Steam.`);
		} else {
			this.log.ok('¡Listo! No te quedan cromos por conseguir en tus juegos.');
		}
		if (this.postergados.size) {
			this.log.aviso(`Estos juegos no soltaron cromos y los salté: ${[...this.postergados.values()].join(', ')}.`);
			this.log.aviso('Suele pasar con juegos marcados como privados en tu biblioteca. Puedes volver a intentarlo más tarde.');
		}
	}
}

module.exports = { Farmeador, duracion, plural, MAX_JUEGOS_A_LA_VEZ };
