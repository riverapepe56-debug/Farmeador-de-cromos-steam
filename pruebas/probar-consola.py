#!/usr/bin/env python3
"""Prueba la consola del farmeador en una terminal real (pseudo-terminal):
contraseña con asteriscos, Steam Guard, sesión guardada, Ctrl+C, --olvidar y config.json con errores."""

import json
import os
import pty
import re
import select
import shutil
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
CLAVE = 'Contraseña*Secreta1'


def correr(dir_prueba, pasos, args=(), env_extra=None, timeout=90):
    env = dict(os.environ, DIR_PRUEBA=dir_prueba, **(env_extra or {}))
    env.pop('NO_COLOR', None)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(AQUI)
        os.execvpe('node', ['node', 'cli-simulado.js', *args], env)
    salida = b''
    paso = 0
    visto = 0
    fin = time.time() + timeout
    while time.time() < fin:
        listo, _, _ = select.select([fd], [], [], 0.05)
        if listo:
            try:
                datos = os.read(fd, 65536)
            except OSError:
                break
            if not datos:
                break
            salida += datos
        texto = salida.decode('utf-8', 'replace')
        if paso < len(pasos):
            patron, escribir = pasos[paso]
            m = re.search(patron, texto[visto:])
            if m:
                visto += m.end()
                time.sleep(0.1)
                for letra in escribir:  # se escribe letra por letra, como una persona
                    os.write(fd, letra.encode('utf-8'))
                    time.sleep(0.01)
                paso += 1
    else:
        os.kill(pid, 9)
        raise AssertionError('se colgó; salida:\n' + salida.decode('utf-8', 'replace'))
    _, estado = os.waitpid(pid, 0)
    texto = salida.decode('utf-8', 'replace')
    limpio = re.sub(r'\x1b\[[0-9;]*m', '', texto)
    assert paso == len(pasos), f'solo se completaron {paso}/{len(pasos)} pasos; salida:\n{limpio}'
    return limpio, os.waitstatus_to_exitcode(estado)


def contiene(texto, *frases):
    for f in frases:
        assert f in texto, f'no aparece {f!r} en:\n{texto}'


def ok(nombre):
    print(f'OK  {nombre}')


def main():
    d = tempfile.mkdtemp(prefix='farmeador-prueba-')
    try:
        # 1) primera vez: contraseña (con un borrado), recordar sesión, código 2FA incorrecto y luego correcto
        salida, codigo = correr(d, [
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', 'X\x7f' + CLAVE + '\r'),
            (r'Recordar la sesión', 's\r'),
            (r'Abre la app de Steam en tu celular', 'AAAAA\r'),
            (r'Ese código no sirvió\. Espera', 'k7q2x\r'),
        ])
        assert codigo == 0, salida
        assert CLAVE not in salida, 'la contraseña se ve en pantalla'
        eco = salida.split('Contraseña: ', 1)[1].split('\n', 1)[0]
        assert eco.replace('\r', '') == '*\b \b' + '*' * len(CLAVE), repr(eco)
        contiene(salida, 'Sesión iniciada en la cuenta jugador_pe', 'Tienes 2 juegos con 3 cromos',
                 '¡Listo! Conseguiste 3 cromos', '[simulador] SALIDA=0')
        sesion = json.load(open(os.path.join(d, 'datos', 'sesion.json')))
        assert sesion['usuario'] == 'jugador_pe' and sesion['refreshToken'].count('.') == 2
        contiene(salida, '[simulador] dataDirectory=' + json.dumps(os.path.join(d, 'datos', 'steam')))
        config = json.load(open(os.path.join(d, 'config.json')))
        assert config['horasMinimas'] == 3 and '_ayuda' in config
        for raiz, _, archivos in os.walk(d):
            for a in archivos:
                assert CLAVE.encode() not in open(os.path.join(raiz, a), 'rb').read(), f'contraseña guardada en {a}'
        ok('primera vez: contraseña con asteriscos, Steam Guard (2FA), sesión guardada, config creado')

        # 2) segunda vez: entra solo con la sesión guardada
        salida, codigo = correr(d, [])
        assert codigo == 0, salida
        contiene(salida, 'Entrando con la sesión guardada de jugador_pe', '¡Listo!')
        assert 'Nombre de cuenta' not in salida
        ok('segunda vez: entra con la sesión guardada sin pedir nada')

        # 3) Ctrl+C mientras farmea: deja de jugar y cierra la sesión
        salida, codigo = correr(d, [(r'Jugando: ', '\x03')])
        assert codigo == 0, salida
        contiene(salida, 'Cerrando el farmeador', '[simulador] logOff recibido')
        ok('Ctrl+C: cierra ordenadamente')

        # 4) --olvidar borra la sesión guardada
        salida, codigo = correr(d, [], args=['--olvidar'])
        assert codigo == 0, salida
        contiene(salida, 'borré la sesión guardada')
        assert not os.path.exists(os.path.join(d, 'datos'))
        ok('--olvidar: borra la sesión')

        # 5) Steam Guard por correo, contraseña incorrecta primero, sin recordar
        salida, codigo = correr(d, [
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', 'malaclave\r'),
            (r'Recordar la sesión', 'n\r'),
            (r'Usuario o contraseña incorrectos', ''),
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', CLAVE + '\r'),
            (r'Steam te envió un código a tu correo \(gmail\.com\)', ' K7Q2X \r'),
        ], env_extra={'CORREO': '1'})
        assert codigo == 0, salida
        assert not os.path.exists(os.path.join(d, 'datos')), 'no debía guardar nada'
        contiene(salida, '¡Listo!', '[simulador] dataDirectory=null')
        ok('código por correo, contraseña incorrecta y reintento, sin guardar sesión')

        # 5b) versión 1.0: la sesión estaba dentro de la carpeta del programa -> se pasa a la carpeta privada
        salida, codigo = correr(d, [
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', CLAVE + '\r'),
            (r'Recordar la sesión', 's\r'),
        ], env_extra={'SIN_GUARD': '1'})
        assert codigo == 0, salida
        legado = os.path.join(d, 'programa-viejo-datos')
        os.makedirs(os.path.join(legado, 'steam'))
        shutil.move(os.path.join(d, 'datos', 'sesion.json'), os.path.join(legado, 'sesion.json'))
        shutil.rmtree(os.path.join(d, 'datos'))
        salida, codigo = correr(d, [], env_extra={'DIR_LEGADO': legado})
        assert codigo == 0, salida
        contiene(salida, 'Pasé tu sesión guardada a una carpeta privada', 'Entrando con la sesión guardada de jugador_pe', '¡Listo!')
        assert not os.path.exists(legado), 'la carpeta vieja debía borrarse'
        assert os.path.exists(os.path.join(d, 'datos', 'sesion.json'))
        os.makedirs(legado)
        salida, codigo = correr(d, [], args=['--olvidar'], env_extra={'DIR_LEGADO': legado})
        assert codigo == 0 and not os.path.exists(legado) and not os.path.exists(os.path.join(d, 'datos')), salida
        ok('sesión de la versión 1.0: se mueve a la carpeta privada y --olvidar borra ambas')

        # 6) config.json con un error de escritura
        with open(os.path.join(d, 'config.json'), 'w', encoding='utf-8-sig') as f:
            f.write('{\n  "horasMinimas": 3,\n  "excluir": [440 730]\n}\n')
        salida, codigo = correr(d, [])
        assert codigo == 1, salida
        contiene(salida, 'config.json tiene un error de escritura (cerca de la línea 3)')
        ok('config.json roto: mensaje claro con la línea')

        # 7) config.json con BOM (Bloc de notas) y valores válidos, y un valor fuera de rango
        with open(os.path.join(d, 'config.json'), 'w', encoding='utf-8-sig') as f:
            f.write('{"horasMinimas": 0, "minutosEntreRevisiones": 2}')
        salida, codigo = correr(d, [])
        assert codigo == 1, salida
        contiene(salida, '"minutosEntreRevisiones" debe ser un número entre 5 y 60')
        ok('config.json con BOM y valor fuera de rango')
    finally:
        shutil.rmtree(d, ignore_errors=True)

    d = tempfile.mkdtemp(prefix='farmeador-prueba-')
    try:
        salida, codigo = correr(d, [
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', CLAVE + '\r'),
            (r'Recordar la sesión', '\r'),
        ], env_extra={'SIN_GUARD': '1'})
        assert codigo == 0, salida
        ok('cuenta sin Steam Guard')

        # 8) Steam corta la sesión con un error: vuelve a entrar solo y termina
        salida, codigo = correr(d, [], env_extra={'ERROR_TRAS_ENTRAR': str(3)})
        assert codigo == 0, salida
        contiene(salida, 'Steam desconectó la sesión (NoConnection). Vuelvo a entrar en 1 minuto.', 'Conectado de nuevo a Steam.', '¡Listo!')
        ok('corte con error: vuelve a entrar solo')

        # 8b) sin Internet al abrir con sesión guardada: reintenta y NO borra la sesión
        salida, codigo = correr(d, [], env_extra={'FALLA_RED_AL_ENTRAR': '2'})
        assert codigo == 0, salida
        assert salida.count('No pude conectar con Steam (HTTP error 403). Revisa tu conexión a Internet; reintento en 1 minuto.') == 2, salida
        contiene(salida, 'Sesión iniciada en la cuenta jugador_pe', '¡Listo!')
        assert os.path.exists(os.path.join(d, 'datos', 'sesion.json'))
        ok('sin Internet al abrir: reintenta y conserva la sesión')

        # 9) otra sesión con el mismo identificador (farmeador abierto dos veces)
        salida, codigo = correr(d, [], env_extra={'ERROR_TRAS_ENTRAR': str(34)})
        assert codigo == 1, salida
        contiene(salida, 'Se abrió otro farmeador con esta misma cuenta', 'Cerrando el farmeador')
        ok('farmeador abierto dos veces: el anterior se cierra')

        # 10) Steam revoca la sesión (cambio de contraseña): se borra la sesión guardada
        salida, codigo = correr(d, [], env_extra={'ERROR_TRAS_ENTRAR': str(15)})
        assert codigo == 1, salida
        contiene(salida, 'Steam cerró la sesión')
        assert not os.path.exists(os.path.join(d, 'datos', 'sesion.json'))
        ok('sesión revocada: se borra y pide entrar de nuevo')

        # 11) la sesión guardada ya no sirve al abrir: vuelve a pedir la contraseña
        with open(os.path.join(d, 'llave-valida-simulador.txt'), 'w') as f:
            f.write('otra')
        salida, codigo = correr(d, [
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', CLAVE + '\r'),
            (r'Recordar la sesión', 's\r'),
        ], env_extra={'SIN_GUARD': '1'})
        assert codigo == 0, salida
        salida, codigo = correr(d, [
            (r'Nombre de cuenta de Steam', 'jugador_pe\r'),
            (r'Contraseña: ', CLAVE + '\r'),
            (r'Recordar la sesión', 's\r'),
        ], env_extra={'SIN_GUARD': '1', 'LLAVE_INVALIDA': '1'})
        assert codigo == 0, salida
        contiene(salida, 'La sesión guardada ya no sirve')
        ok('sesión guardada inválida: vuelve a pedir la contraseña')
    finally:
        shutil.rmtree(d, ignore_errors=True)
    print('\nprobar-consola: todas las pruebas pasaron')


if __name__ == '__main__':
    try:
        main()
    except AssertionError as e:
        print('FALLÓ:', e)
        sys.exit(1)
