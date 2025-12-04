import { Server } from "socket.io";
import "dotenv/config";

const io = new Server({
  cors: {
    origin: process.env.ORIGIN?.split(",").map(s => s.trim())
  }
});

const port = Number(process.env.PORT) || 4000;

io.listen(port);
// Signaling server (console output removed)

// Friendly startup log: show configured origin and port
{
  const rawOrigin = process.env.DIR || '';
  const origin = (rawOrigin.split && rawOrigin.split(',')[0]) ? String(rawOrigin.split(',')[0]).trim() : rawOrigin || 'http://localhost';
  if (port == 0) {
    console.log(`Servicio de audio funcionando en ${origin}`);
  } else {
    console.log(`Servicio de audio funcionando en ${origin}:${port}`);
  }
}


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
  // connection established

  // ─────────────────────────────────────────────
  // JOIN ROOM (LIMIT 10 USERS)
  // ─────────────────────────────────────────────
  socket.on("join-voice-room", (roomId: string) => {

    if (!rooms[roomId]) {
      rooms[roomId] = { users: [] };
    }

    // ⛔ LIMIT 10 USERS
    if (rooms[roomId].users.length >= 10) {
      socket.emit("room-full", { roomId, max: 10 });
      return;
    }

    // Only add if not already present (avoid duplicate entries if client fires join multiple times)
    let added = false;
    if (!rooms[roomId].users.includes(socket.id)) {
      rooms[roomId].users.push(socket.id);
      added = true;
    } else {
      // duplicate join ignored
    }

    socket.join(roomId);

    // Notify others only if this was a new entry
    if (added) {
      socket.to(roomId).emit("user-joined", socket.id);
    }
  });

  // ─────────────────────────────────────────────
  // LEAVE ROOM (explicit)
  // ─────────────────────────────────────────────
  socket.on("leave-voice-room", (roomId: string) => {
    try {
      socket.leave(roomId);
      if (rooms[roomId]) {
        rooms[roomId].users = rooms[roomId].users.filter(u => u !== socket.id);
        io.to(roomId).emit("user-left", socket.id);

        if (rooms[roomId].users.length === 0) {
          // room now empty: trigger backend finalize for this room
          (async () => {
            try {
                // Prefer an explicit RESUME service if configured (new migrated summary service).
                const resume = process.env.RESUME_BASE;
                const tryFinalize = async (base: string) => {
                  const url = `${base.replace(/\/+$/,'')}/api/audio/finalize?roomId=${encodeURIComponent(roomId)}`;
                  const resp = await fetch(url, { method: 'POST' as any });
                  try {
                    await resp.json();
                  } catch (e) {
                    await resp.text();
                  }
                  return resp;
                };

                // If RESUME_BASE is set, call it; otherwise skip finalize (we no longer call legacy backend)
                if (resume) {
                  try {
                    await tryFinalize(resume);
                  } catch (e) {
                    // resume finalize failed; nothing else to do
                  }
                } else {
                  // no RESUME_BASE configured; skipping finalize
                }
              } catch (err) {
                // finalize failed
              }
          })();

          delete rooms[roomId];
        }
      }
    } catch (e) {
      // leave error
    }
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
    // user disconnected

    // Eliminar de las rooms
    for (const roomId in rooms) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u !== socket.id);
      io.to(roomId).emit("user-left", socket.id);

      if (rooms[roomId].users.length === 0) {
        // room now empty: trigger backend finalize for this room
        (async () => {
          try {
            const resume = process.env.RESUME_BASE;
            if (resume) {
              try {
                const url = `${resume.replace(/\/+$/,'')}/api/audio/finalize?roomId=${encodeURIComponent(roomId)}`;
                const resp = await fetch(url, { method: 'POST' as any });
                try {
                  await resp.json();
                } catch (e) {
                  await resp.text();
                }
              } catch (e) {
                // resume finalize failed
              }
            } else {
              // RESUME_BASE not configured; skipping finalize
            }
          } catch (err) {
            // failed to call backend finalize
          }
        })();

        delete rooms[roomId];
      }
    }
  });
});



