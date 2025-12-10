/**
 * @fileoverview WebRTC Signaling Server for AgoraX Audio
 * @module AgoraX_Audio
 * @description This module implements a Socket.IO-based signaling server
 * that enables real-time voice communication between multiple users via WebRTC.
 * It manages voice rooms with user limits, SDP offer/answer exchange,
 * and ICE candidates to establish peer-to-peer connections.
 * 
 * @requires socket.io - Library for real-time communication based on WebSockets
 * @requires dotenv - Environment variable management
 * 
 * @author AgoraX Team
 * @version 0.2.0
 */

import { Server } from "socket.io";
import "dotenv/config";

/**
 * Socket.IO server instance configured with CORS.
 * 
 * @constant {Server} io
 * @description Socket.IO server that handles all WebSocket connections.
 * CORS options are configured via the ORIGIN environment variable,
 * which can contain multiple origins separated by commas.
 * 
 * @example
 * // Expected environment variables:
 * // ORIGIN=http://localhost:3000,https://agorax.com
 */
const io = new Server({
  cors: {
    origin: process.env.ORIGIN?.split(",").map(s => s.trim())
  }
});

/**
 * Port on which the server listens.
 * 
 * @constant {number} port
 * @description Server port, configured via the PORT environment variable.
 * If not specified, defaults to port 4000.
 * 
 * @default 4000
 */
const port = Number(process.env.PORT) || 4000;

io.listen(port);

/**
 * Initialization block that logs the server configuration to console.
 * 
 * @description Displays a friendly message indicating the origin and port
 * where the audio service is running.
 */
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
 * Data structure that stores all active voice rooms.
 * 
 * @interface RoomData
 * @property {string[]} users - Array of socket identifiers (socket.id) of users in the room
 * 
 * @typedef {Record<string, RoomData>} Rooms
 * @description Object that maps each room ID to its associated data.
 * 
 * Structure:
 * ```typescript
 * {
 *   "room-123": {
 *     users: ["socketId1", "socketId2", "socketId3"]
 *   },
 *   "room-456": {
 *     users: ["socketId4", "socketId5"]
 *   }
 * }
 * ```
 * 
 * @constant {Rooms} rooms
 */
const rooms: Record<string, { users: string[] }> = {};

// ─────────────────────────────────────────────
//  CONNECTION MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Main Socket.IO connection event.
 * 
 * @event connection
 * @description Fires when a new client establishes a WebSocket connection to the server.
 * Sets up all specific event handlers for that socket.
 * 
 * @param {Socket} socket - Connected client socket instance
 * 
 * @listens connection - Socket.IO event when a new connection is established
 */
io.on("connection", socket => {
  // connection established

  // ─────────────────────────────────────────────
  // JOIN VOICE ROOM (LIMIT: 10 USERS)
  // ─────────────────────────────────────────────
  
  /**
   * Allows a user to join a voice room.
   * 
   * @event join-voice-room
   * @description Adds the user to the specified room if space is available.
   * Implements a maximum limit of 10 users per room to ensure
   * audio quality and performance.
   * 
   * @param {string} roomId - Unique identifier of the voice room to join
   * 
   * @emits room-full - Emitted to the client if the room has reached the limit of 10 users
   * @emits user-joined - Emitted to all users in the room (except the new one) to notify of arrival
   * 
   * @example
   * // Client joins room:
   * socket.emit("join-voice-room", "room-abc123");
   * 
   * @remarks
   * - If the room doesn't exist, it's created automatically
   * - Prevents duplicates: if the user is already in the room, they won't be added again
   * - Maximum limit: 10 users per room
   */
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
  // LEAVE VOICE ROOM (EXPLICIT)
  // ─────────────────────────────────────────────
  
  /**
   * Allows a user to explicitly leave a voice room.
   * 
   * @event leave-voice-room
   * @description Removes the user from the specified room and notifies others.
   * If the room becomes empty, it's deleted from the registry and triggers a call
   * to the summary service finalization endpoint (if configured).
   * 
   * @param {string} roomId - Unique identifier of the voice room to leave
   * 
   * @emits user-left - Notifies all remaining users that someone has left
   * 
   * @example
   * // Client leaves room:
   * socket.emit("leave-voice-room", "room-abc123");
   * 
   * @remarks
   * - If the room becomes empty, the `/api/audio/finalize` endpoint of RESUME_BASE service is called
   * - The finalization endpoint is invoked asynchronously and non-blocking
   * - If RESUME_BASE is not configured, no finalization call is made
   * 
   * @async
   */
  socket.on("leave-voice-room", (roomId: string) => {
    try {
      socket.leave(roomId);
      if (rooms[roomId]) {
        rooms[roomId].users = rooms[roomId].users.filter(u => u !== socket.id);
        io.to(roomId).emit("user-left", socket.id);

        if (rooms[roomId].users.length === 0) {
          /**
           * Asynchronous function that finalizes the audio session in the backend.
           * 
           * @async
           * @function finalizeRoom
           * @description Makes a POST call to the summary service to
           * process the audio from the room that just became empty.
           * 
           * @remarks
           * - Uses the RESUME_BASE environment variable as base URL
           * - Endpoint called: `${RESUME_BASE}/api/audio/finalize?roomId=${roomId}`
           * - Errors are caught silently to avoid affecting user experience
           */
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
  // WEBRTC: SDP OFFER EXCHANGE
  // ─────────────────────────────────────────────
  
  /**
   * Handles WebRTC SDP (Session Description Protocol) offer exchange.
   * 
   * @event voice-offer
   * @description Forwards an SDP offer from one peer to another to initiate
   * peer-to-peer WebRTC connection negotiation.
   * 
   * @param {Object} data - Offer data
   * @param {string} data.roomId - ID of the room where the offer is made
   * @param {RTCSessionDescriptionInit} data.offer - SDP offer object generated by RTCPeerConnection
   * @param {string} data.to - Socket ID of the offer recipient
   * 
   * @emits voice-offer - Forwards the offer to the specified recipient
   * 
   * @example
   * // Client A sends offer to Client B:
   * socket.emit("voice-offer", {
   *   roomId: "room-abc123",
   *   offer: peerConnection.localDescription,
   *   to: "clientBSocketId"
   * });
   * 
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/RTCSessionDescription|RTCSessionDescription}
   */
  socket.on("voice-offer", ({ roomId, offer, to }) => {
    io.to(to).emit("voice-offer", {
      from: socket.id,
      offer,
      roomId
    });
  });

  // ─────────────────────────────────────────────
  // WEBRTC: SDP ANSWER EXCHANGE
  // ─────────────────────────────────────────────
  
  /**
   * Handles WebRTC SDP (Session Description Protocol) answer exchange.
   * 
   * @event voice-answer
   * @description Forwards an SDP answer from one peer to another to complete
   * the peer-to-peer WebRTC connection negotiation initiated with the offer.
   * 
   * @param {Object} data - Answer data
   * @param {string} data.roomId - ID of the room where the answer is made
   * @param {RTCSessionDescriptionInit} data.answer - SDP answer object generated by RTCPeerConnection
   * @param {string} data.to - Socket ID of the answer recipient
   * 
   * @emits voice-answer - Forwards the answer to the specified recipient
   * 
   * @example
   * // Client B responds to Client A's offer:
   * socket.emit("voice-answer", {
   *   roomId: "room-abc123",
   *   answer: peerConnection.localDescription,
   *   to: "clientASocketId"
   * });
   * 
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/RTCSessionDescription|RTCSessionDescription}
   */
  socket.on("voice-answer", ({ roomId, answer, to }) => {
    io.to(to).emit("voice-answer", {
      from: socket.id,
      answer,
      roomId
    });
  });

  // ─────────────────────────────────────────────
  // WEBRTC: ICE CANDIDATE EXCHANGE
  // ─────────────────────────────────────────────
  
  /**
   * Handles ICE (Interactive Connectivity Establishment) candidate exchange.
   * 
   * @event ice-candidate
   * @description ICE candidates are potential network addresses that peers
   * can use to connect directly. This event forwards ICE candidates
   * between peers to establish the best possible connection route.
   * 
   * @param {Object} data - ICE candidate data
   * @param {RTCIceCandidate} data.candidate - ICE candidate generated by RTCPeerConnection
   * @param {string} data.to - Socket ID of the candidate recipient
   * 
   * @emits ice-candidate - Forwards the ICE candidate to the specified recipient
   * 
   * @example
   * // Client sends ICE candidate to another peer:
   * socket.emit("ice-candidate", {
   *   candidate: event.candidate,
   *   to: "otherPeerSocketId"
   * });
   * 
   * @remarks
   * - ICE candidates are exchanged after establishing the SDP offer/answer
   * - Multiple candidates can be exchanged during negotiation
   * - The process continues until the best connection route is found
   * 
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate|RTCIceCandidate}
   * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity|WebRTC Connectivity}
   */
  socket.on("ice-candidate", ({ candidate, to }) => {
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  // ─────────────────────────────────────────────
  // CLIENT DISCONNECTION
  // ─────────────────────────────────────────────
  
  /**
   * Handles client disconnection.
   * 
   * @event disconnect
   * @description Fires when a client disconnects from the server
   * (tab closure, connection loss, etc.). Cleans up the user from
   * all rooms they were participating in and notifies others.
   * 
   * @emits user-left - Notifies each affected room that the user has disconnected
   * 
   * @remarks
   * - The user is automatically removed from all rooms
   * - If any room becomes empty after disconnection, it's deleted and the finalization endpoint is called
   * - The finalization logic is identical to the `leave-voice-room` event
   * 
   * @async
   * 
   * @example
   * // Automatic when client disconnects:
   * // socket.disconnect() or connection closure
   */
  socket.on("disconnect", () => {
    // user disconnected

    // Eliminar de las rooms
    for (const roomId in rooms) {
      rooms[roomId].users = rooms[roomId].users.filter(u => u !== socket.id);
      io.to(roomId).emit("user-left", socket.id);

      if (rooms[roomId].users.length === 0) {
        /**
         * Asynchronous function that finalizes the audio session in the backend after disconnection.
         * 
         * @async
         * @function finalizeRoomOnDisconnect
         * @description Similar to finalization in `leave-voice-room`, processes
         * audio from rooms that become empty due to user disconnection.
         * 
         * @remarks
         * - Identical behavior to explicit room exit
         * - Ensures no session remains unprocessed
         */
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



