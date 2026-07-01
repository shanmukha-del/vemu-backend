import socket

ip = '192.168.0.112'
ports = [80, 554, 8554, 8899, 8000, 8080, 5000, 5540, 1935, 5050]
print(f"Scanning ports on {ip}...")
for port in ports:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.5)
    result = sock.connect_ex((ip, port))
    if result == 0:
        print(f"Port {port} is OPEN")
    sock.close()
print("Done scanning.")
