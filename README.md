# AgoraX Audio - Servidor de Señalización WebRTC

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-ISC-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8.1-black)

## 📋 Descripción

**AgoraX Audio** es un servidor de señalización basado en Socket.IO que permite la comunicación de voz en tiempo real entre múltiples usuarios mediante tecnología WebRTC. Este servicio gestiona salas de voz con límite de participantes, intercambio de ofertas/respuestas SDP, y candidatos ICE para establecer conexiones peer-to-peer directas.

### 🎯 Características Principales

- ✅ **Comunicación en Tiempo Real**: Basado en WebSockets mediante Socket.IO
- ✅ **Señalización WebRTC**: Intercambio de ofertas, respuestas y candidatos ICE
- ✅ **Gestión de Salas**: Creación y administración automática de salas de voz
- ✅ **Límite de Usuarios**: Máximo 10 usuarios por sala para garantizar calidad
- ✅ **CORS Configurable**: Soporte para múltiples orígenes mediante variables de entorno
- ✅ **Integración con Backend**: Llamadas automáticas al servicio de resumen al finalizar sesiones
- ✅ **Manejo Robusto de Desconexiones**: Limpieza automática de salas vacías

---

## 🚀 Instalación

### Prerrequisitos

- Node.js >= 16.x
- npm o yarn
- TypeScript 5.x

### Pasos de Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/michaelRS2002/AgoraX_Audio.git
cd AgoraX_Audio

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno (ver sección de Configuración)
cp .env.example .env

# 4. Ejecutar en modo desarrollo
npm run dev

# O compilar y ejecutar en producción
npm run build
npm start
```

---

## ⚙️ Configuración

### Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```env
# Puerto del servidor (opcional, por defecto: 4000)
PORT=4000

# Orígenes permitidos para CORS (separados por comas)
ORIGIN=http://localhost:3000,https://agorax.com,https://app.agorax.com

# URL del servicio de resumen para finalización de sesiones (opcional)
RESUME_BASE=https://api-resume.agorax.com

# URL base para logs (opcional)
DIR=http://localhost:3000
```

### Ejemplo de `.env.example`

```env
PORT=4000
ORIGIN=http://localhost:3000
RESUME_BASE=
DIR=http://localhost:3000
```

---

## 📡 API de Eventos (Socket.IO)

### Eventos del Cliente → Servidor

#### `join-voice-room`

Permite a un usuario unirse a una sala de voz.

**Parámetros:**
- `roomId` (string): Identificador único de la sala

**Respuestas:**
- `room-full`: Se emite si la sala tiene 10 usuarios
- `user-joined`: Se emite a todos los usuarios de la sala (broadcast)

**Ejemplo:**
```javascript
socket.emit("join-voice-room", "room-abc123");

socket.on("room-full", ({ roomId, max }) => {
  console.log(`La sala ${roomId} está llena (máx: ${max} usuarios)`);
});

socket.on("user-joined", (socketId) => {
  console.log(`Usuario ${socketId} se unió a la sala`);
});
```

---

#### `leave-voice-room`

Permite a un usuario salir explícitamente de una sala.

**Parámetros:**
- `roomId` (string): Identificador de la sala

**Respuestas:**
- `user-left`: Se emite a todos los usuarios restantes

**Ejemplo:**
```javascript
socket.emit("leave-voice-room", "room-abc123");

socket.on("user-left", (socketId) => {
  console.log(`Usuario ${socketId} salió de la sala`);
});
```

---

#### `voice-offer`

Envía una oferta SDP de WebRTC a otro peer.

**Parámetros:**
- `roomId` (string): ID de la sala
- `offer` (RTCSessionDescriptionInit): Oferta SDP
- `to` (string): Socket ID del destinatario

**Respuestas:**
- El destinatario recibe el evento `voice-offer` con los datos

**Ejemplo:**
```javascript
const offer = await peerConnection.createOffer();
await peerConnection.setLocalDescription(offer);

socket.emit("voice-offer", {
  roomId: "room-abc123",
  offer: peerConnection.localDescription,
  to: targetSocketId
});

// En el receptor:
socket.on("voice-offer", async ({ from, offer, roomId }) => {
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  // ... enviar respuesta
});
```

---

#### `voice-answer`

Envía una respuesta SDP de WebRTC a otro peer.

**Parámetros:**
- `roomId` (string): ID de la sala
- `answer` (RTCSessionDescriptionInit): Respuesta SDP
- `to` (string): Socket ID del destinatario

**Ejemplo:**
```javascript
socket.emit("voice-answer", {
  roomId: "room-abc123",
  answer: peerConnection.localDescription,
  to: targetSocketId
});
```

---

#### `ice-candidate`

Envía un candidato ICE a otro peer.

**Parámetros:**
- `candidate` (RTCIceCandidate): Candidato ICE
- `to` (string): Socket ID del destinatario

**Ejemplo:**
```javascript
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    socket.emit("ice-candidate", {
      candidate: event.candidate,
      to: targetSocketId
    });
  }
};

// En el receptor:
socket.on("ice-candidate", async ({ from, candidate }) => {
  await peerConnection.addIceCandidate(candidate);
});
```

---

### Eventos del Servidor → Cliente

| Evento | Descripción | Datos |
|--------|-------------|-------|
| `room-full` | La sala ha alcanzado el límite de usuarios | `{ roomId: string, max: number }` |
| `user-joined` | Un nuevo usuario se unió a la sala | `socketId: string` |
| `user-left` | Un usuario salió o se desconectó | `socketId: string` |
| `voice-offer` | Oferta SDP recibida | `{ from: string, offer: RTCSessionDescriptionInit, roomId: string }` |
| `voice-answer` | Respuesta SDP recibida | `{ from: string, answer: RTCSessionDescriptionInit, roomId: string }` |
| `ice-candidate` | Candidato ICE recibido | `{ from: string, candidate: RTCIceCandidate }` |

---

## 🏗️ Arquitectura

### Flujo de Conexión WebRTC

```
Cliente A                    Servidor                    Cliente B
   |                            |                            |
   |--- join-voice-room ------->|                            |
   |<-------- OK ----------------|                            |
   |                            |<---- join-voice-room -------|
   |<------ user-joined ---------|                            |
   |                            |--------- OK --------------->|
   |                            |                            |
   |--- voice-offer (to B) ---->|                            |
   |                            |------ voice-offer --------->|
   |                            |<---- voice-answer ----------|
   |<---- voice-answer ---------|                            |
   |                            |                            |
   |--- ice-candidate (to B) -->|                            |
   |                            |---- ice-candidate --------->|
   |<---- ice-candidate --------|<--- ice-candidate ----------|
   |                            |                            |
   |========= CONEXIÓN P2P ESTABLECIDA ====================>|
```

### Estructura de Datos

#### Salas (`rooms`)

```typescript
{
  "room-123": {
    users: ["socketId1", "socketId2", "socketId3"]
  },
  "room-456": {
    users: ["socketId4", "socketId5"]
  }
}
```

---

## 🧪 Testing

### Ejemplo de Cliente de Prueba

```javascript
import io from "socket.io-client";

const socket = io("http://localhost:4000");

socket.on("connect", () => {
  console.log("Conectado:", socket.id);
  
  // Unirse a sala
  socket.emit("join-voice-room", "test-room");
});

socket.on("user-joined", (userId) => {
  console.log("Nuevo usuario:", userId);
});

socket.on("room-full", ({ roomId, max }) => {
  console.log(`Sala ${roomId} llena (máx: ${max})`);
});
```

---

## 📦 Dependencias

### Producción

- **socket.io** (^4.8.1): Comunicación en tiempo real mediante WebSockets
- **dotenv** (^17.2.2): Gestión de variables de entorno
- **cors** (^2.8.5): Configuración de CORS
- **simple-peer** (^9.11.1): Biblioteca auxiliar para WebRTC

### Desarrollo

- **typescript** (^5.9.3): Lenguaje tipado
- **tsx** (^4.20.6): Ejecución de TypeScript
- **@types/cors** (^2.8.19): Tipos para CORS

---

## 📜 Scripts Disponibles

```bash
# Ejecutar en modo desarrollo con hot-reload
npm run dev

# Compilar TypeScript a JavaScript
npm run build

# Ejecutar versión compilada
npm start
```

---

## 🔒 Seguridad

### Consideraciones

1. **CORS**: Configura correctamente `ORIGIN` para permitir solo dominios autorizados
2. **Rate Limiting**: Considera implementar limitación de tasa en producción
3. **Autenticación**: Este servidor NO incluye autenticación. Implementa un middleware si es necesario
4. **Validación**: Los datos de entrada son básicos. Considera validación adicional con bibliotecas como Zod o Joi

### Recomendaciones para Producción

```typescript
// Ejemplo de middleware de autenticación
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (isValidToken(token)) {
    next();
  } else {
    next(new Error("Authentication error"));
  }
});
```

---

## 🐛 Resolución de Problemas

### El servidor no inicia

**Problema**: Error de puerto en uso

**Solución**:
```bash
# Windows
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :4000
kill -9 <PID>
```

---

### CORS bloqueado

**Problema**: Error de CORS en el navegador

**Solución**: Verifica que `ORIGIN` en `.env` incluya el dominio del cliente:
```env
ORIGIN=http://localhost:3000,https://mi-app.com
```

---

### Sala siempre llena

**Problema**: No se puede unir a sala que debería tener espacio

**Solución**: Los usuarios desconectados pueden quedar registrados. Reinicia el servidor o implementa limpieza periódica:
```typescript
setInterval(() => {
  for (const roomId in rooms) {
    rooms[roomId].users = rooms[roomId].users.filter(socketId => 
      io.sockets.sockets.has(socketId)
    );
  }
}, 60000); // Cada minuto
```

---

## 🤝 Contribución

Las contribuciones son bienvenidas. Por favor:

1. Fork el repositorio
2. Crea una rama: `git checkout -b feature/nueva-caracteristica`
3. Commit: `git commit -m 'Agregar nueva característica'`
4. Push: `git push origin feature/nueva-caracteristica`
5. Abre un Pull Request

---

## 📄 Licencia

Este proyecto está bajo la licencia ISC. Ver archivo `LICENSE` para más detalles.

---

## 👥 Autores

**Equipo AgoraX**
- GitHub: [@michaelRS2002](https://github.com/michaelRS2002)

---

## 📞 Soporte

Para reportar problemas o solicitar características:
- **Issues**: [GitHub Issues](https://github.com/michaelRS2002/AgoraX_Audio/issues)
- **Discusiones**: [GitHub Discussions](https://github.com/michaelRS2002/AgoraX_Audio/discussions)

---

## 🗺️ Roadmap

- [ ] Implementar autenticación JWT
- [ ] Agregar métricas y monitoring
- [ ] Soporte para compartir pantalla
- [ ] Grabación de audio en servidor
- [ ] Sistema de moderadores por sala
- [ ] API REST para gestión de salas
- [ ] Tests unitarios y de integración
- [ ] Documentación de API con Swagger/OpenAPI

---

## 📚 Referencias

- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [WebRTC MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

**Desarrollado con ❤️ por el equipo AgoraX**
