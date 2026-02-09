/**
 * RealtimeService
 * 
 * Manages Socket.io events for the Chat module.
 */

class RealtimeService {
    constructor() {
        this.io = null;
    }

    init(io) {
        this.io = io;
        console.log('[RealtimeService] Initialized with Socket.io');

        this.io.on('connection', (socket) => {
            console.log(`[Socket] Client connected: ${socket.id}`);

            // Join a specific conversation room
            socket.on('chat:join', (data) => {
                const { conversationId, tenantId } = data;
                if (!conversationId || !tenantId) return;

                const roomName = `chat:${tenantId}:${conversationId}`;
                socket.join(roomName);
                console.log(`[Socket] ${socket.id} joined room: ${roomName}`);
            });

            // Handle typing indicator
            socket.on('chat:typing', (data) => {
                const { conversationId, tenantId, userId, isTyping } = data;
                if (!conversationId || !tenantId) return;

                const roomName = `chat:${tenantId}:${conversationId}`;
                socket.to(roomName).emit('chat:typing_update', {
                    userId,
                    isTyping
                });
            });

            socket.on('disconnect', () => {
                console.log(`[Socket] Client disconnected: ${socket.id}`);
            });
        });
    }

    /**
     * Broadcast a new message to a conversation room
     */
    broadcastMessage(tenantId, conversationId, message) {
        if (!this.io) return;

        const roomName = `chat:${tenantId}:${conversationId}`;
        this.io.to(roomName).emit('chat:message', message);
        console.log(`[RealtimeService] Broadcasted message to room: ${roomName}`);
    }
}

module.exports = new RealtimeService();
