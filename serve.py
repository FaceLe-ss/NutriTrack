#!/usr/bin/env python3
"""
NutriTrack PWA — Local Development & Wi-Fi Server for iPhone
Includes built-in reverse proxy for Google Gemini API (/api/gemini/*)
"""
import http.server
import socketserver
import socket
import os
import sys
import urllib.request
import urllib.error

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS and disable aggressive caching for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, x-goog-api-key, x-goog-api-client')
        self.end_headers()

    def do_POST(self):
        if self.path.startswith('/api/gemini/'):
            subpath = self.path[len('/api/gemini/'):]
            target_url = f"https://generativelanguage.googleapis.com/{subpath}"
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else None

            headers = {'Content-Type': 'application/json'}
            if 'x-goog-api-key' in self.headers:
                headers['x-goog-api-key'] = self.headers['x-goog-api-key']

            req = urllib.request.Request(target_url, data=post_data, headers=headers, method='POST')
            try:
                with urllib.request.urlopen(req) as resp:
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(resp.read())
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(e.read())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(f'{{"error": "{str(e)}"}}'.encode('utf-8'))
            return

        super().do_POST()

def get_ip_addresses():
    ips = []
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith('127.'):
                ips.append(ip)
    except Exception:
        pass
    return ips

def main():
    os.chdir(DIRECTORY)
    ips = get_ip_addresses()
    
    wifi_ips = [ip for ip in ips if ip.startswith('192.168.')]
    other_ips = [ip for ip in ips if not ip.startswith('192.168.')]
    ordered_ips = wifi_ips + other_ips

    print("=" * 64)
    print("  🍏 NutriTrack PWA — Сервер для iPhone и ПК (Ключ установлен!)")
    print("=" * 64)
    print("\n1. Откройте Safari на вашем iPhone (в той же сети Wi-Fi):")
    for ip in ordered_ips:
        prefix = "👉 [Основной Wi-Fi]" if ip.startswith("192.168.") else "   [Другой адаптер]"
        print(f"   {prefix}: http://{ip}:{PORT}")
    print(f"   [Локально на ПК]: http://localhost:{PORT}")
    
    print("\n2. Как установить на домашний экран iPhone:")
    print("   • Откройте ссылку в браузере Safari")
    print("   • Нажмите кнопку «Поделиться» (квадрат со стрелочкой вверх)")
    print("   • Выберите «На экран Домой» (Add to Home Screen)")
    print("   • Запустите с рабочего стола как родное приложение!")
    print("\n3. Нажмите Ctrl+C для остановки сервера.\n" + "=" * 64 + "\n")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nСервер остановлен.")

if __name__ == '__main__':
    main()
