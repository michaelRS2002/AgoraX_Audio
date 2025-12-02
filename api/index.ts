import { Server } from "socket.io";
import "dotenv/config";

const io = new Server({
  cors: {
    origin: process.env.ORIGIN?.split(",").map(s => s.trim())
  }
});

const port = Number(process.env.PORT) || 4000;

io.listen(port);
console.log(`Voice Signaling Server running on port ${port}`);

/**
 * Rooms structure:
 * rooms = {
 *   roomId: {
 *      users: [socketId1, socketId2, ...]
 *   }
 * }
 */
const rooms: Record<string, { users: string[] }> = {};

// ─────────────────────────────────────────────
//  CONNECTION
// ─────────────────────────────────────────────
io.on("connection", socket => {
  console.log(`User connected: ${socket.id}`);

  // ─────────────────────────────────────────────
  // JOIN ROOM
  // ─────────────────────────────────────────────
  socket.on("join-voice-room", (roomId: string) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [] };
    }

    rooms[roomId].users.push(socket.id);
    socket.join(roomId);

    console.log(`User ${socket.id} joined room ${roomId}`);

    // Notifica a los demás usuarios de la sala
    socket.to(roomId).emit("user-joined", socket.id);
  });

  // ─────────────────────────────────────────────
  // WEBRTC: OFFER
  // ─────────────────────────────────────────────
  socket.on("voice-offer", ({ roomId, offer, to }) => {
    io.to(to).emit("voice-offer", {
      from: socket.id,
      offer,
      roomId
    });
  });

  // ─────────────────────────────────────────────
  // WEBRTC: ANSWER
  // ─────────────────────────────────────────────
  socket.on("voice-answer", ({ roomId, answer, to }) => {
    io.to(to).emit("voice-answer", {
      from: socket.id,
      answer,
      roomId
    });
  });

  // ─────────────────────────────────────────────
  // ICE CANDIDATE
  // ─────────────────────────────────────────────
  socket.on("ice-candidate", ({ candidate, to }) => {
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  // ─────────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    // Eliminar de las rooms
    for (const roomId in rooms) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u !== socket.id);
      io.to(roomId).emit("user-left", socket.id);

      if (rooms[roomId].users.length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

